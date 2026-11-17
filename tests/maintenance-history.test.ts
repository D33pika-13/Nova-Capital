import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { TestDatabase, testAuth, ids } from "./fixtures/database";
import {
  MaintenanceService,
  type MaintenanceRepository,
  type MaintenanceStatusRecord,
} from "@/server/modules/offers/maintenance-service";
import { PostgresMaintenanceRepository } from "@/server/providers/postgres-maintenance";
import { ConfigurationService } from "@/server/configuration-service";
const db = new TestDatabase();
const secret = "synthetic-scheduler-history-token";
const repository = new PostgresMaintenanceRepository(db);
const service = new MaintenanceService(testAuth(db), repository, {
  provider: "external",
  environment: "test",
  secret,
  staleAfterSeconds: 900,
});
beforeAll(() => db.initialize(), 20000);
afterAll(() => db.close());
it("reports absent scheduled evidence and keeps successful manual work separate", async () => {
  expect(await service.status()).toMatchObject({
    state: "never",
    lastScheduledSuccessAt: null,
  });
  await service.runAsAdmin();
  expect(await service.status()).toMatchObject({
    state: "never",
    lastScheduledSuccessAt: null,
    lastAdminFinishedAt: expect.any(String),
  });
  const row = (
    await db.engine.query<{
      origin: string;
      actor_id: string;
      expired_offers: number;
    }>("select origin,actor_id,expired_offers from private.maintenance_runs")
  ).rows[0];
  expect(row).toEqual({
    origin: "admin",
    actor_id: ids.admin,
    expired_offers: 0,
  });
});
it("records a committed zero-work scheduled batch and denies private history/status to other users", async () => {
  await service.runScheduled(`Bearer ${secret}`);
  expect(await service.status()).toMatchObject({
    state: "current",
    lastScheduledOutcome: "completed",
    lastScheduledExpiredOffers: 0,
    lastScheduledSuccessAt: expect.any(String),
  });
  for (const auth of [testAuth(db, "a"), testAuth(db, "admin", "aal1")]) {
    await expect(
      new MaintenanceService(auth, repository, {
        provider: "local",
        environment: "test",
      }).status(),
    ).rejects.toMatchObject({ status: 403 });
  }
  for (const identity of [
    null,
    {
      provider: "supabase",
      subject: "synthetic-a",
      assurance: "aal2" as const,
    },
  ]) {
    await expect(
      db.withIdentity(identity, (sql) =>
        sql.query("select * from private.maintenance_status()"),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.withIdentity(identity, (sql) =>
        sql.query("select * from private.maintenance_runs"),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  }
  const before = (
    await db.engine.query<{ count: number }>(
      "select count(*)::int count from private.maintenance_runs",
    )
  ).rows[0].count;
  await expect(service.runScheduled("Bearer invalid")).rejects.toMatchObject({
    status: 401,
  });
  await expect(
    db.withIdentity(
      { provider: "supabase", subject: "synthetic-a", assurance: "aal2" },
      (sql) => sql.query("select * from private.run_maintenance_batch()"),
    ),
  ).rejects.toMatchObject({ code: "42501" });
  expect(
    (
      await db.engine.query<{ count: number }>(
        "select count(*)::int count from private.maintenance_runs",
      )
    ).rows[0].count,
  ).toBe(before);
});
it("commits a safe failed outcome while rolling back partial maintenance writes and audits", async () => {
  const definition = (
    await db.engine.query<{ definition: string }>(
      "select pg_get_functiondef('private.expire_offers()'::regprocedure) definition",
    )
  ).rows[0].definition;
  const offer = (
    await db.engine.query<{ id: string }>(
      "insert into offers(title,description,category,eligibility,terms,status,starts_at,ends_at,created_by) values('SYNTHETIC failed batch','test','member','test','test','published',now()-interval '2 days',now()-interval '1 day',$1) returning id",
      [ids.admin],
    )
  ).rows[0].id;
  const audit = (
    await db.engine.query<{ count: number }>(
      "select count(*)::int count from audit_logs",
    )
  ).rows[0].count;
  try {
    await db.engine.exec(
      "create or replace function private.expire_offers() returns integer language plpgsql security definer set search_path='' as $$ begin update public.offers set status='expired' where title='SYNTHETIC failed batch';raise exception 'private-sql-token-must-not-escape';end $$;",
    );
    await expect(
      service.runScheduled(`Bearer ${secret}`),
    ).rejects.toMatchObject({
      code: "MAINTENANCE_FAILED",
      status: 503,
      message: "Maintenance could not be completed.",
    });
    expect(
      (
        await db.engine.query<{ status: string }>(
          "select status from offers where id=$1",
          [offer],
        )
      ).rows[0].status,
    ).toBe("published");
    expect(
      (
        await db.engine.query<{ count: number }>(
          "select count(*)::int count from audit_logs",
        )
      ).rows[0].count,
    ).toBe(audit);
    const status = await service.status();
    expect(status).toMatchObject({
      state: "failed",
      lastScheduledOutcome: "failed",
      lastScheduledExpiredOffers: null,
      lastScheduledSuccessAt: expect.any(String),
    });
    expect(JSON.stringify(status)).not.toContain("private-sql-token");
    expect(
      (
        await db.engine.query<{ count: number }>(
          "select count(*)::int count from private.maintenance_runs where outcome='failed'",
        )
      ).rows[0].count,
    ).toBe(1);
  } finally {
    await db.engine.exec(definition);
  }
  await service.runScheduled(`Bearer ${secret}`);
  expect(await service.status()).toMatchObject({
    state: "current",
    lastScheduledOutcome: "completed",
  });
});
it("uses database observation time for recency and exposes pending offers separately", async () => {
  await db.engine.exec(
    "update private.maintenance_runs set started_at=clock_timestamp()-interval '20 minutes',finished_at=clock_timestamp()-interval '20 minutes',outcome='completed',expired_offers=0 where origin='scheduler';",
  );
  expect(await service.status()).toMatchObject({ state: "stale" });
  await db.engine.exec(
    "update private.maintenance_runs set started_at=clock_timestamp()-interval '1 minute',finished_at=clock_timestamp()-interval '1 minute',outcome='completed',expired_offers=500 where origin='scheduler';",
  );
  expect(await service.status()).toMatchObject({
    state: "backlog",
    lastScheduledExpiredOffers: 500,
  });
});
it("prunes old history in bounded batches while retaining recent failure evidence", async () => {
  await db.engine.exec(
    "insert into private.maintenance_runs(origin,started_at,finished_at,outcome,expired_offers) select 'scheduler',now()-interval '31 days',now()-interval '31 days','completed',0 from generate_series(1,501);",
  );
  await service.runScheduled(`Bearer ${secret}`);
  expect(
    (
      await db.engine.query<{ count: number }>(
        "select count(*)::int count from private.maintenance_runs where finished_at<now()-interval '30 days'",
      )
    ).rows[0].count,
  ).toBe(1);
  await service.runScheduled(`Bearer ${secret}`);
  expect(
    (
      await db.engine.query<{ count: number }>(
        "select count(*)::int count from private.maintenance_runs where finished_at<now()-interval '30 days'",
      )
    ).rows[0].count,
  ).toBe(0);
});
it.each([59, 86401, 1.5])(
  "rejects an invalid freshness configuration %s",
  (value) => {
    expect(
      () =>
        new ConfigurationService({
          MAINTENANCE_STALE_AFTER_SECONDS: String(value),
        }),
    ).toThrow("MAINTENANCE_STALE_AFTER_SECONDS");
  },
);
const observed = "2026-11-11T12:00:00.000Z",
  recent = "2026-11-11T11:59:00.000Z";
const record = (): MaintenanceStatusRecord => ({
  observedAt: observed,
  recoveryBoundaryAt: null,
  lastScheduledSuccessAt: recent,
  lastScheduledFinishedAt: recent,
  lastScheduledOutcome: "completed",
  lastScheduledExpiredOffers: 0,
  lastAdminFinishedAt: null,
});
it.each([
  { observedAt: "invalid" },
  { lastAdminFinishedAt: "2026-11-12T12:00:00Z" },
  { lastScheduledOutcome: null },
  { lastScheduledExpiredOffers: 501 },
  { lastScheduledFinishedAt: null },
  { lastScheduledSuccessAt: null },
])(
  "rejects inconsistent/future evidence rather than reporting current",
  async (override) => {
    const fake: MaintenanceRepository = {
      expireOffers: vi.fn(),
      status: vi.fn(async () => ({ ...record(), ...override })),
    };
    await expect(
      new MaintenanceService(testAuth(db), fake, {
        provider: "external",
        environment: "test",
      }).status(),
    ).rejects.toMatchObject({ code: "MAINTENANCE_STATUS_UNAVAILABLE" });
  },
);
it("does not retry committed batches after telemetry failure and labels connection uncertainty separately", async () => {
  const events = {
    event: vi.fn(() => {
      throw Error("private-telemetry-error");
    }),
  };
  const fake: MaintenanceRepository = {
    expireOffers: vi.fn(async () => 0),
    status: vi.fn(async () => record()),
  };
  const current = new MaintenanceService(
    testAuth(db),
    fake,
    { provider: "external", environment: "test", secret },
    events,
  );
  await expect(current.runScheduled(`Bearer ${secret}`)).resolves.toMatchObject(
    { expiredOffers: 0 },
  );
  expect(fake.expireOffers).toHaveBeenCalledOnce();
  vi.mocked(fake.expireOffers).mockRejectedValueOnce(
    Error("private-connection-error"),
  );
  await expect(current.runScheduled(`Bearer ${secret}`)).rejects.toThrow(
    "private-connection-error",
  );
  expect(events.event).toHaveBeenLastCalledWith(
    "maintenance.batch_unconfirmed",
    {
      provider: "postgres",
      status: "unavailable",
      maintenanceOrigin: "scheduler",
    },
  );
});

it("requires new scheduled evidence after a recorded recovery boundary, retaining earlier history", async () => {
  const before = (
    await db.engine.query<{ count: number }>(
      "select count(*)::int count from private.maintenance_runs",
    )
  ).rows[0].count;
  await db.engine.exec(
    "insert into audit_logs(action,entity,entity_id) values('AUTH_QUARANTINE','restore',gen_random_uuid());",
  );
  expect(await service.status()).toMatchObject({
    state: "never",
    lastScheduledSuccessAt: null,
    recoveryBoundaryAt: expect.any(String),
  });
  await service.runAsAdmin();
  expect(await service.status()).toMatchObject({
    state: "never",
    lastScheduledSuccessAt: null,
  });
  await service.runScheduled(`Bearer ${secret}`);
  expect(await service.status()).toMatchObject({
    state: "current",
    lastScheduledOutcome: "completed",
  });
  expect(
    (
      await db.engine.query<{ count: number }>(
        "select count(*)::int count from private.maintenance_runs",
      )
    ).rows[0].count,
  ).toBe(before + 2);
});
it("records confirmed database failure distinctly from unconfirmed connection loss", async () => {
  const { AppError } = await import("@/server/errors");
  const telemetry = { event: vi.fn() };
  const fake: MaintenanceRepository = {
    expireOffers: vi.fn(async () => {
      throw new AppError("MAINTENANCE_FAILED", "safe failure", 503);
    }),
    status: vi.fn(async () => record()),
  };
  await expect(
    new MaintenanceService(
      testAuth(db),
      fake,
      { provider: "external", environment: "test", secret },
      telemetry,
    ).runScheduled(`Bearer ${secret}`),
  ).rejects.toMatchObject({ code: "MAINTENANCE_FAILED" });
  expect(telemetry.event).toHaveBeenCalledExactlyOnceWith(
    "maintenance.batch_failed",
    { provider: "postgres", status: "failed", maintenanceOrigin: "scheduler" },
  );
});
it("does not expose unexpected repository fields in admin status", async () => {
  const fake: MaintenanceRepository = {
    expireOffers: vi.fn(),
    status: vi.fn(async () => ({
      ...record(),
      privateToken: "synthetic-private-history-token",
      actorEmail: "private@example.test",
    })),
  };
  const value = await new MaintenanceService(testAuth(db), fake, {
    provider: "external",
    environment: "test",
  }).status();
  expect(JSON.stringify(value)).not.toMatch(
    /synthetic-private-history-token|private@example/,
  );
});
it.each([
  ["2026-11-11T11:45:00.000Z", "stale"],
  ["2026-11-11T11:45:00.001Z", "current"],
])(
  "uses the configured inclusive stale boundary for %s",
  async (finished, state) => {
    const fake: MaintenanceRepository = {
      expireOffers: vi.fn(),
      status: vi.fn(async () => ({
        ...record(),
        lastScheduledFinishedAt: finished,
        lastScheduledSuccessAt: finished,
      })),
    };
    expect(
      await new MaintenanceService(testAuth(db), fake, {
        provider: "external",
        environment: "test",
        staleAfterSeconds: 900,
      }).status(),
    ).toMatchObject({ state });
  },
);

it("labels only authorized scheduled and admin outcomes with server-derived origin", async () => {
  const telemetry = { event: vi.fn() };
  const fake: MaintenanceRepository = {
    expireOffers: vi.fn(async () => 0),
    status: vi.fn(async () => record()),
  };
  const monitored = new MaintenanceService(
    testAuth(db),
    fake,
    {
      provider: "external",
      environment: "test",
      secret,
    },
    telemetry,
  );
  await expect(monitored.runScheduled("Bearer invalid")).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  expect(telemetry.event).not.toHaveBeenCalled();
  expect(fake.expireOffers).not.toHaveBeenCalled();
  await monitored.runAsAdmin();
  expect(telemetry.event).toHaveBeenLastCalledWith(
    "maintenance.batch_completed",
    {
      provider: "postgres",
      status: "ok",
      maintenanceOrigin: "admin",
    },
  );
  await monitored.runScheduled(`Bearer ${secret}`);
  expect(telemetry.event).toHaveBeenLastCalledWith(
    "maintenance.batch_completed",
    {
      provider: "postgres",
      status: "ok",
      maintenanceOrigin: "scheduler",
    },
  );
  const forbidden = new MaintenanceService(
    testAuth(db, "a"),
    fake,
    {
      provider: "external",
      environment: "test",
      secret,
    },
    telemetry,
  );
  telemetry.event.mockClear();
  await expect(forbidden.runAsAdmin()).rejects.toMatchObject({ status: 403 });
  expect(telemetry.event).not.toHaveBeenCalled();
});
