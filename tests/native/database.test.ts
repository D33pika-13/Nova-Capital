import { NativeRestoreRehearsal } from "./restore-rehearsal";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { EntraSessionService } from "@/server/modules/identity/entra-session-service";
import { PostgresEntraSessions } from "@/server/providers/postgres-entra-sessions";
import { PostgresLoginTransactions } from "@/server/providers/postgres-login-transactions";
import { Pool } from "pg";
import { PostgresEntraProvisioning } from "@/server/providers/postgres-entra-provisioning";
import { generate } from "otplib";
import { EntraMfaService } from "@/server/modules/identity/entra-mfa-service";
import { PostgresEntraMfa } from "@/server/providers/postgres-entra-mfa";
import {
  MfaSecretProtector,
  MfaAuthenticator,
  MfaRecoveryCodes,
} from "@/server/providers/mfa-crypto";
import { NativeFixture } from "./fixture";
import { ids, testAuth } from "../fixtures/database";
import { PostgresDatabase } from "@/server/providers/postgres-database";
import { PostgresPortfolioRepository } from "@/server/providers/postgres-portfolio";
import { PortfolioService } from "@/server/modules/portfolio/portfolio-service";
import { FinancialCalculator } from "@/server/modules/portfolio/financial-calculator";
import { PostgresReportRepository } from "@/server/providers/postgres-reports";
const fixture = new NativeFixture();
const loginTransaction = () => ({
  stateHash: randomBytes(32).toString("hex"),
  bindingHash: randomBytes(32).toString("hex"),
  configurationHash: randomBytes(32).toString("hex"),
  nonce: randomBytes(32).toString("base64url"),
  codeVerifier: randomBytes(32).toString("base64url"),
});
const identity = (who: "a" | "b" | "admin") => ({
  provider: "supabase",
  subject: `synthetic-${who}`,
  assurance: who === "admin" ? ("aal2" as const) : ("aal1" as const),
});
beforeAll(() => fixture.initialize());
afterAll(() => fixture.close());
it("uses real verified TLS and denies untrusted certificates and hostname mismatch", async () => {
  const tls = (
    await fixture.pool.query(
      "select ssl,version from pg_stat_ssl where pid=pg_backend_pid()",
    )
  ).rows[0];
  expect(tls.ssl).toBe(true);
  expect(tls.version).toMatch(/^TLSv1\.[23]$/);
  for (const settings of [
    fixture.settings("nova_app", fixture.password, "127.0.0.1"),
    fixture.settings("nova_app", fixture.password, "localhost", ""),
  ]) {
    const pool = new Pool(settings);
    try {
      await expect(pool.query("select 1")).rejects.toThrow(
        /certificate|self.signed|verify/i,
      );
    } finally {
      await pool.end();
    }
  }
});
it("isolates sequential A/B/anonymous requests on the same real pooled connection and clears transaction identity", async () => {
  let pid: number | undefined;
  for (const who of ["a", "b", null] as const) {
    const result = await fixture.database.withIdentity(
      who ? identity(who) : null,
      async (sql) => ({
        profiles: (
          await sql.query<{ id: string }>("select id from profiles order by id")
        ).rows,
        pid: (await sql.query<{ pid: number }>("select pg_backend_pid() pid"))
          .rows[0].pid,
      }),
    );
    expect(result.profiles.map((row) => row.id)).toEqual(who ? [ids[who]] : []);
    if (pid !== undefined) expect(result.pid).toBe(pid);
    pid = result.pid;
    const session = (
      await fixture.pool.query(
        "select current_setting('app.subject',true) subject, pg_backend_pid() pid",
      )
    ).rows[0];
    expect(session.subject ?? "").toBe("");
    expect(session.pid).toBe(pid);
  }
});
it("rolls back real SQL failures before pool reuse and rejects an owner connection before application work", async () => {
  const before = (await fixture.pool.query("select pg_backend_pid() pid"))
    .rows[0].pid;
  await expect(
    fixture.database.withIdentity(identity("a"), (sql) =>
      sql.query("select 1/0"),
    ),
  ).rejects.toMatchObject({ code: "22012" });
  const next = await fixture.database.withIdentity(identity("b"), (sql) =>
    sql.query<{ id: string }>("select id from profiles"),
  );
  expect(next.rows.map((row) => row.id)).toEqual([ids.b]);
  expect(
    (await fixture.pool.query("select pg_backend_pid() pid")).rows[0].pid,
  ).toBe(before);
  let worked = false;
  await expect(
    new PostgresDatabase(fixture.owner).withIdentity(
      identity("admin"),
      async () => {
        worked = true;
      },
    ),
  ).rejects.toMatchObject({ code: "UNSAFE_DATABASE_ROLE" });
  expect(worked).toBe(false);
});
it("serializes duplicate financial submissions across real connections without duplicate records or audits", async () => {
  const pool = new Pool({ ...fixture.settings(), max: 3 });
  try {
    const database = new PostgresDatabase(pool);
    const service = new PortfolioService(
      testAuth(database),
      new PostgresPortfolioRepository(database),
      new FinancialCalculator(),
    );
    const input = {
      requestId: randomUUID(),
      clientId: ids.a,
      assetClass: "stocks",
      description: "SYNTHETIC native concurrency",
      currency: "INR",
      investedAmount: "100.1001",
      reportedValue: "110.2002",
      reportedAt: "2026-01-01T00:00:00Z",
    };
    const [a, b] = await Promise.all([
      service.createInvestment(input),
      service.createInvestment(input),
    ]);
    expect(a.id).toBe(b.id);
    expect(a.investedAmount).toBe("100.1001");
    expect(a.reportedValue).toBe("110.2002");
    expect(
      (
        await fixture.owner.query(
          "select count(*)::int count from investments where id=$1",
          [a.id],
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (
        await fixture.owner.query(
          "select count(*)::int count from audit_logs where entity_id=$1 and action='INSERT'",
          [a.id],
        )
      ).rows[0].count,
    ).toBe(1);
    const view = await database.withIdentity(identity("b"), (sql) =>
      sql.query("select id from investments where id=$1", [a.id]),
    );
    expect(view.rows).toEqual([]);
  } finally {
    await pool.end();
  }
});
it("rejects role spoofing and low-assurance admin writes in native RLS", async () => {
  const weakAdmin = { ...identity("admin"), assurance: "aal1" as const };
  expect(
    (
      await fixture.database.withIdentity(weakAdmin, (sql) =>
        sql.query<{ allowed: boolean }>("select private.is_admin() allowed"),
      )
    ).rows[0].allowed,
  ).toBe(false);
  for (const actor of [null, identity("a"), weakAdmin]) {
    await expect(
      fixture.database.withIdentity(actor, (sql) =>
        sql.query("update profiles set role='admin' where id=$1 returning id", [
          ids.a,
        ]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  }
  expect(
    (
      await fixture.database.withIdentity(weakAdmin, (sql) =>
        sql.query(
          "update profiles set display_name='SYNTHETIC forbidden correction' where id=$1 returning id",
          [ids.a],
        ),
      )
    ).rows,
  ).toEqual([]);
  expect(
    (
      await fixture.owner.query("select role from profiles where id=$1", [
        ids.a,
      ])
    ).rows[0].role,
  ).toBe("client");
});
it("allows only one of two concurrent corrections against the same native record version", async () => {
  const pool = new Pool({ ...fixture.settings(), max: 3 });
  try {
    const database = new PostgresDatabase(pool);
    const service = new PortfolioService(
      testAuth(database),
      new PostgresPortfolioRepository(database),
      new FinancialCalculator(),
    );
    const shared = {
      assetClass: "stocks",
      description: "SYNTHETIC native correction",
      investedAmount: "100",
      reportedValue: "110",
      reportedAt: "2026-01-01T00:00:00Z",
    };
    const record = await service.createInvestment({
      ...shared,
      requestId: randomUUID(),
      clientId: ids.a,
      currency: "INR",
    });
    const results = await Promise.allSettled(
      ["111", "112"].map((reportedValue) =>
        service.editInvestment(ids.a, record.id, {
          ...shared,
          reportedValue,
          requestId: randomUUID(),
          expectedVersion: 1,
          correctionReason: "Synthetic concurrency fixture",
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: { status: 409 } });
    expect(
      (
        await fixture.owner.query(
          "select version from investments where id=$1",
          [record.id],
        )
      ).rows[0].version,
    ).toBe(2);
  } finally {
    await pool.end();
  }
});
it("preserves native snapshot correction history under concurrent writes and isolates exact client summaries", async () => {
  const pool = new Pool({ ...fixture.settings(), max: 4 });
  try {
    const database = new PostgresDatabase(pool);
    const repository = new PostgresPortfolioRepository(database);
    const service = new PortfolioService(
      testAuth(database),
      repository,
      new FinancialCalculator(),
    );
    const input = {
      requestId: randomUUID(),
      clientId: ids.a,
      currency: "INR",
      adjustedBasis: "100.1001",
      reportedValue: "110.2002",
      basisExplanation: "SYNTHETIC native snapshot, no other cash flows",
      reportedAt: "2025-09-01T12:00:00.000Z",
    };
    const [original, replay] = await Promise.all([
      service.appendSnapshot(input),
      service.appendSnapshot(input),
    ]);
    expect(replay).toEqual(original);
    const competing = ["120.3003", "130.4004"].map((reportedValue) => ({
      ...input,
      requestId: randomUUID(),
      reportedValue,
      correctionOf: original.id,
      correctionReason: "SYNTHETIC competing correction",
    }));
    const results = await Promise.allSettled(
      competing.map((value) => service.appendSnapshot(value)),
    );
    const winners = results.filter((result) => result.status === "fulfilled");
    expect(winners).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: { status: 409 } });
    const winner = winners[0];
    if (winner.status !== "fulfilled") throw Error("Missing snapshot winner");
    const latest = await service.appendSnapshot({
      ...input,
      requestId: randomUUID(),
      reportedValue: "140.5005",
      correctionOf: winner.value.id,
      correctionReason: "SYNTHETIC second correction",
    });
    for (const [currency, adjustedBasis] of [
      ["USD", null],
      ["EUR", "0"],
    ] as const)
      await service.appendSnapshot({
        ...input,
        requestId: randomUUID(),
        currency,
        adjustedBasis,
        reportedValue: "6.0006",
      });
    const client = new PortfolioService(
      testAuth(database, "a"),
      repository,
      new FinancialCalculator(),
    );
    const overview = await client.clientOverview();
    const chain = overview.snapshots.filter((row) =>
      [original.id, winner.value.id, latest.id].includes(row.id),
    );
    expect(chain).toHaveLength(3);
    expect(chain.find((row) => row.id === original.id)).toMatchObject({
      superseded: true,
      reportedValue: "110.2002",
      correctionOf: null,
    });
    expect(chain.find((row) => row.id === winner.value.id)).toMatchObject({
      superseded: true,
      correctionOf: original.id,
    });
    expect(chain.find((row) => row.id === latest.id)).toMatchObject({
      superseded: false,
      correctionOf: winner.value.id,
    });
    expect(
      overview.summaries.find((row) => row.currency === "INR"),
    ).toMatchObject({
      reportedValue: "140.5005",
      adjustedBasis: "100.1001",
      profitLoss: "40.4004",
    });
    expect(
      overview.summaries.find((row) => row.currency === "USD"),
    ).toMatchObject({
      adjustedBasis: null,
      profitLoss: null,
      returnPercent: null,
    });
    expect(
      overview.summaries.find((row) => row.currency === "EUR"),
    ).toMatchObject({
      adjustedBasis: "0.0000",
      profitLoss: "6.0006",
      returnPercent: null,
    });
    expect(overview.summaries.map((row) => row.currency).sort()).toEqual([
      "EUR",
      "INR",
      "USD",
    ]);
    const other = new PortfolioService(
      testAuth(database, "b"),
      repository,
      new FinancialCalculator(),
    );
    expect((await other.clientOverview()).snapshots).toEqual([]);
    expect(
      (
        await database.withIdentity(identity("b"), (sql) =>
          sql.query("select id from portfolio_snapshots where client_id=$1", [
            ids.a,
          ]),
        )
      ).rows,
    ).toEqual([]);
    await expect(
      client.appendSnapshot({ ...input, requestId: randomUUID() }),
    ).rejects.toMatchObject({ status: 403 });
    const weakAdmin = new PortfolioService(
      testAuth(database, "admin", "aal1"),
      repository,
      new FinancialCalculator(),
    );
    await expect(
      weakAdmin.appendSnapshot({ ...input, requestId: randomUUID() }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.appendSnapshot({
        ...input,
        requestId: randomUUID(),
        clientId: ids.b,
        correctionOf: latest.id,
        correctionReason: "SYNTHETIC wrong client",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.appendSnapshot({
        ...input,
        requestId: randomUUID(),
        reportedAt: "2025-09-02T12:00:00.000Z",
        correctionOf: latest.id,
        correctionReason: "SYNTHETIC wrong date",
      }),
    ).rejects.toMatchObject({ status: 422 });
    for (const statement of [
      "update portfolio_snapshots set reported_value=0 where id=$1",
      "delete from portfolio_snapshots where id=$1",
    ])
      await expect(
        database.withIdentity(identity("admin"), (sql) =>
          sql.query(statement, [latest.id]),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    const audits = (
      await fixture.owner.query(
        "select entity_id,count(*)::int count from audit_logs where entity='portfolio_snapshots' and entity_id=any($1::uuid[]) group by entity_id",
        [chain.map((row) => row.id)],
      )
    ).rows;
    expect(audits).toHaveLength(3);
    expect(audits.every((row) => row.count === 1)).toBe(true);
    const loserIndex = results.findIndex(
      (result) => result.status === "rejected",
    );
    expect(
      (
        await fixture.owner.query(
          "select request_id from write_requests where request_id=$1",
          [competing[loserIndex].requestId],
        )
      ).rows,
    ).toEqual([]);
  } finally {
    await pool.end();
  }
});
it("rolls back a native snapshot and its submission marker when the audit insert fails, then permits the same request", async () => {
  const repository = new PostgresPortfolioRepository(fixture.database);
  const service = new PortfolioService(
    testAuth(fixture.database),
    repository,
    new FinancialCalculator(),
  );
  const input = {
    requestId: randomUUID(),
    clientId: ids.a,
    currency: "INR",
    adjustedBasis: "25.0001",
    reportedValue: "30.0002",
    basisExplanation: "SYNTHETIC failed audit rollback",
    reportedAt: "2025-09-03T12:00:00.000Z",
  };
  await fixture.owner.query(`
    create function private.nova_test_snapshot_audit_failure() returns trigger language plpgsql as $$
    begin raise exception 'synthetic-snapshot-audit-blocked'; end $$;
    create trigger nova_test_snapshot_audit_failure before insert on public.audit_logs
      for each row when (new.entity='portfolio_snapshots') execute function private.nova_test_snapshot_audit_failure();
  `);
  try {
    await expect(service.appendSnapshot(input)).rejects.toMatchObject({
      code: "P0001",
    });
    expect(
      (
        await fixture.owner.query(
          "select id from portfolio_snapshots where client_id=$1 and reported_at=$2",
          [ids.a, input.reportedAt],
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await fixture.owner.query(
          "select request_id from write_requests where request_id=$1",
          [input.requestId],
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await fixture.owner.query(
          "select id from audit_logs where entity='portfolio_snapshots' and after_data->>'basis_explanation'=$1",
          [input.basisExplanation],
        )
      ).rows,
    ).toEqual([]);
  } finally {
    await fixture.owner.query(
      "drop trigger if exists nova_test_snapshot_audit_failure on public.audit_logs; drop function if exists private.nova_test_snapshot_audit_failure();",
    );
  }
  const saved = await service.appendSnapshot(input);
  expect(await service.appendSnapshot(input)).toEqual(saved);
  expect(
    (
      await fixture.owner.query(
        "select count(*)::int count from audit_logs where entity='portfolio_snapshots' and entity_id=$1",
        [saved.id],
      )
    ).rows[0].count,
  ).toBe(1);
});
it("holds the active-profile lock through a download capability and enforces suspension after release", async () => {
  const context = await testAuth(fixture.database, "a").requireUser();
  const reports = new PostgresReportRepository(fixture.database);
  let unlock: (() => void) | undefined;
  let locked: (() => void) | undefined;
  const lockAcquired = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  const work = reports.withDownload(context, randomUUID(), async () => {
    locked!();
    await gate;
    return "synthetic capability";
  });
  await lockAcquired;
  const administrator = await fixture.owner.connect();
  let suspension: Promise<unknown> | undefined;
  try {
    const pid = (await administrator.query("select pg_backend_pid() pid"))
      .rows[0].pid;
    const suspended = administrator.query(
      "update profiles set status='suspended' where id=$1",
      [ids.a],
    );
    suspension = suspended;
    let waiting = false;
    for (let i = 0; i < 50; i++) {
      const state = (
        await fixture.owner.query(
          "select wait_event_type from pg_stat_activity where pid=$1",
          [pid],
        )
      ).rows[0];
      if (state?.wait_event_type === "Lock") {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
    unlock!();
    expect(await work).toBe("synthetic capability");
    await suspended;
    await expect(
      testAuth(fixture.database, "a").requireUser(),
    ).rejects.toMatchObject({ status: 403 });
  } finally {
    unlock!();
    await work.catch(() => {});
    await suspension?.catch(() => {});
    administrator.release();
    await fixture.owner.query(
      "update profiles set status='active' where id=$1",
      [ids.a],
    );
  }
});
it("serializes concurrent login capacity and allows exactly one state consumer across real connections", async () => {
  const pool = new Pool({ ...fixture.settings(), max: 5 });
  try {
    const repository = new PostgresLoginTransactions(
      new PostgresDatabase(pool),
    );
    const shared = loginTransaction();
    const attempts = Array.from({ length: 10 }, () => ({
      ...loginTransaction(),
      bindingHash: shared.bindingHash,
    }));
    const results = await Promise.allSettled(
      attempts.map((value) => repository.create(value)),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(5);
    for (const result of results.filter(
      (result) => result.status === "rejected",
    ))
      expect(result.reason).toMatchObject({ status: 429 });
    const chosen =
      attempts[results.findIndex((result) => result.status === "fulfilled")];
    const claims = await Promise.all(
      Array.from({ length: 5 }, () =>
        repository.take(
          chosen.stateHash,
          chosen.bindingHash,
          chosen.configurationHash,
        ),
      ),
    );
    expect(claims.filter(Boolean)).toEqual([
      {
        nonce: chosen.nonce,
        codeVerifier: chosen.codeVerifier,
        purpose: "login",
      },
    ]);
    expect(
      (
        await fixture.owner.query(
          "select count(*)::int count from private.entra_login_transactions where binding_hash=$1",
          [shared.bindingHash],
        )
      ).rows[0].count,
    ).toBe(4);
  } finally {
    await pool.end();
  }
});
it("denies wrong browser/configuration, expired claims and direct access to native login-state secrets", async () => {
  const repository = new PostgresLoginTransactions(fixture.database);
  const value = loginTransaction();
  await repository.create(value);
  expect(
    await repository.take(
      value.stateHash,
      randomBytes(32).toString("hex"),
      value.configurationHash,
    ),
  ).toBeNull();
  expect(
    await repository.take(
      value.stateHash,
      value.bindingHash,
      randomBytes(32).toString("hex"),
    ),
  ).toBeNull();
  await expect(
    fixture.pool.query("select * from private.entra_login_transactions"),
  ).rejects.toMatchObject({ code: "42501" });
  await fixture.owner.query(
    "update private.entra_login_transactions set created_at=statement_timestamp()-interval '11 minutes',expires_at=statement_timestamp()-interval '1 minute' where state_hash=$1",
    [value.stateHash],
  );
  expect(
    await repository.take(
      value.stateHash,
      value.bindingHash,
      value.configurationHash,
    ),
  ).toBeNull();
  await fixture.database.withIdentity(null, (sql) =>
    sql.query("select private.cleanup_entra_transactions()"),
  );
  expect(
    (
      await fixture.owner.query(
        "select count(*)::int count from private.entra_login_transactions where state_hash=$1",
        [value.stateHash],
      )
    ).rows[0].count,
  ).toBe(0);
});
const sessionRealm = {
  tenantId: "40000000-0000-4000-8000-000000000004",
  clientId: "50000000-0000-4000-8000-000000000005",
  issuer:
    "https://synthetic.ciamlogin.com/40000000-0000-4000-8000-000000000004/v2.0",
  applicationOrigin: "https://native.example.test",
};
const sessionIdentity = {
  provider: "entra",
  subject: `${sessionRealm.tenantId}:60000000-0000-4000-8000-000000000006`,
  assurance: "aal1" as const,
};
const sessionHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
it("keeps session revocation permanent across concurrent verification and account reactivation", async () => {
  await fixture.owner.query(
    "insert into provider_identities(profile_id,provider,subject) values($1,'entra',$2) on conflict(profile_id,provider) do nothing",
    [ids.a, sessionIdentity.subject],
  );
  const pool = new Pool({ ...fixture.settings(), max: 3 });
  try {
    const sessions = new EntraSessionService(
      new PostgresEntraSessions(new PostgresDatabase(pool)),
      sessionRealm,
    );
    const a = await sessions.issue(sessionIdentity);
    const b = await sessions.issue(sessionIdentity);
    await Promise.all([sessions.revoke(a.token), sessions.verify(b.token)]);
    expect(await sessions.verify(a.token)).toBeNull();
    expect(await sessions.verify(b.token)).toBeNull();
    const current = await sessions.issue(sessionIdentity);
    await fixture.owner.query(
      "update profiles set status='suspended' where id=$1",
      [ids.a],
    );
    expect(await sessions.verify(current.token)).toBeNull();
    await fixture.owner.query(
      "update profiles set status='active' where id=$1",
      [ids.a],
    );
    expect(await sessions.verify(current.token)).toBeNull();
    await expect(
      pool.query("select * from private.entra_sessions"),
    ).rejects.toMatchObject({ code: "42501" });
    const parallel = await Promise.all(
      Array.from({ length: 12 }, () => sessions.issue(sessionIdentity)),
    );
    const valid = [];
    for (const value of parallel)
      valid.push(await sessions.verify(value.token));
    expect(valid.filter(Boolean)).toHaveLength(10);
  } finally {
    await fixture.owner.query(
      "update profiles set status='active' where id=$1",
      [ids.a],
    );
    await pool.end();
  }
});
it("rechecks actual database expiry after waiting for a session lock", async () => {
  await fixture.owner.query(
    "insert into provider_identities(profile_id,provider,subject) values($1,'entra',$2) on conflict(profile_id,provider) do nothing",
    [ids.a, sessionIdentity.subject],
  );
  const sessions = new EntraSessionService(
    new PostgresEntraSessions(fixture.database),
    sessionRealm,
  );
  const session = await sessions.issue(sessionIdentity);
  const tokenHash = sessionHash(session.token);
  await fixture.owner.query(
    "update private.entra_sessions set created_at=statement_timestamp()-interval '8 hours'+interval '1 second',last_seen_at=statement_timestamp(),expires_at=statement_timestamp()+interval '1 second' where token_hash=$1",
    [tokenHash],
  );
  const locker = await fixture.owner.connect();
  let work: ReturnType<EntraSessionService["verify"]> | undefined;
  try {
    await locker.query("begin");
    await locker.query(
      "select id from private.entra_sessions where token_hash=$1 for update",
      [tokenHash],
    );
    work = sessions.verify(session.token);
    await vi.waitFor(async () => {
      const row = (
        await fixture.owner.query(
          "select count(*)::int count from pg_stat_activity where wait_event_type='Lock' and query like '%resolve_entra_session%' and pid<>pg_backend_pid()",
        )
      ).rows[0];
      expect(row.count).toBeGreaterThan(0);
    });
    await vi.waitFor(
      async () => {
        expect(
          (
            await fixture.owner.query(
              "select clock_timestamp()>=expires_at expired from private.entra_sessions where token_hash=$1",
              [tokenHash],
            )
          ).rows[0].expired,
        ).toBe(true);
      },
      { timeout: 4000, interval: 20 },
    );
    await locker.query("commit");
    expect(await work).toBeNull();
  } finally {
    await locker.query("rollback");
    await work?.catch(() => {});
    locker.release();
  }
}, 10000);

it("allows only one concurrent TOTP counter and recovery-code use on native PostgreSQL", async () => {
  const identity = {
    ...sessionIdentity,
    subject: `${sessionRealm.tenantId}:80000000-0000-4000-8000-000000000008`,
  };
  await fixture.owner.query(
    "insert into provider_identities(profile_id,provider,subject) values($1,'entra',$2) on conflict(profile_id,provider) do update set subject=excluded.subject",
    [ids.admin, identity.subject],
  );
  const pool = new Pool({ ...fixture.settings(), max: 4 });
  try {
    const database = new PostgresDatabase(pool);
    const sessions = new EntraSessionService(
      new PostgresEntraSessions(database),
      sessionRealm,
    );
    const crypto = {
      protector: new MfaSecretProtector("test", {
        test: randomBytes(32).toString("base64url"),
      }),
      authenticator: new MfaAuthenticator("Native"),
      recovery: new MfaRecoveryCodes(),
    };
    const mfa = new EntraMfaService(
      new PostgresEntraMfa(database),
      crypto,
      sessions.realmHash,
    );
    const initial = await sessions.issue(identity);
    const setup = await mfa.prepare(initial.token);
    if (setup.enrolled) throw Error("expected new synthetic enrollment");
    const secret = new URL(setup.provisioningUri).searchParams.get("secret")!;
    const current = await mfa.verify(initial.token, await generate({ secret }));
    const other = await sessions.issue(identity);
    const counter =
      Number(
        (
          await fixture.owner.query(
            "select last_step from private.entra_mfa_factors where id=$1",
            [setup.factorId],
          )
        ).rows[0].last_step,
      ) + 1;
    const nextCode = await generate({ secret, epoch: counter * 30 });
    const attempts = await Promise.allSettled([
      mfa.verify(current.token, nextCode),
      mfa.verify(other.token, nextCode),
    ]);
    expect(attempts.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((x) => x.status === "rejected")).toHaveLength(1);
    const a = await sessions.issue(identity),
      b = await sessions.issue(identity);
    const recoveries = await Promise.allSettled([
      mfa.verify(a.token, current.recoveryCodes![0], true),
      mfa.verify(b.token, current.recoveryCodes![0], true),
    ]);
    expect(recoveries.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(recoveries.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect(
      (
        await fixture.owner.query(
          "select count(*)::int count from private.entra_mfa_recovery where factor_id=$1 and consumed_at is not null",
          [setup.factorId],
        )
      ).rows[0].count,
    ).toBe(1);
    for (const result of [...attempts, ...recoveries])
      if (result.status === "fulfilled") {
        expect(await sessions.verify(result.value.token)).toMatchObject({
          assurance: "aal2",
        });
        expect(result.value.expiresAt).toBeDefined();
      }
    await expect(
      pool.query("select * from private.entra_mfa_factors"),
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await pool.end();
  }
});
it("consumes an MFA challenge that expires while waiting for its factor lock", async () => {
  const sessions = new EntraSessionService(
    new PostgresEntraSessions(fixture.database),
    {
      ...sessionRealm,
      applicationOrigin: "https://native-mfa-expiry.example.test",
    },
  );
  const repository = new PostgresEntraMfa(fixture.database);
  const identity = {
    ...sessionIdentity,
    subject: `${sessionRealm.tenantId}:80000000-0000-4000-8000-000000000008`,
  };
  await fixture.owner.query(
    "insert into provider_identities(profile_id,provider,subject) values($1,'entra',$2) on conflict(profile_id,provider) do update set subject=excluded.subject",
    [ids.admin, identity.subject],
  );
  const crypto = {
    protector: new MfaSecretProtector("test", {
      test: randomBytes(32).toString("base64url"),
    }),
    authenticator: new MfaAuthenticator("Native"),
    recovery: new MfaRecoveryCodes(),
  };
  const mfa = new EntraMfaService(repository, crypto, sessions.realmHash);
  const first = await sessions.issue(identity);
  const setup = await mfa.prepare(first.token);
  if (setup.enrolled) throw Error("expected new synthetic enrollment");
  const secret = new URL(setup.provisioningUri).searchParams.get("secret")!;
  const session = await mfa.verify(first.token, await generate({ secret }));
  const recoveryDigest = crypto.recovery.digest(session.recoveryCodes![0], {
    realmHash: sessions.realmHash,
    profileId: ids.admin,
    factorId: setup.factorId,
  });
  const proof = randomBytes(32).toString("hex");
  const challenge = await repository.begin(
    sessionHash(session.token),
    sessions.realmHash,
    proof,
    true,
  );
  expect(challenge).not.toBeNull();
  await fixture.owner.query(
    "update private.entra_mfa_challenges set expires_at=clock_timestamp()+interval '1 second' where proof_hash=$1",
    [proof],
  );
  const locker = await fixture.owner.connect();
  let work: ReturnType<PostgresEntraMfa["finish"]> | undefined;
  try {
    await locker.query("begin");
    await locker.query(
      "select id from private.entra_mfa_factors where id=$1 for update",
      [challenge!.factorId],
    );
    work = repository.finish({
      tokenHash: sessionHash(session.token),
      realmHash: sessions.realmHash,
      proofHash: proof,
      step: null,
      recoveryDigest,
      newTokenHash: randomBytes(32).toString("hex"),
      recoveryDigests: null,
    });
    await vi.waitFor(async () =>
      expect(
        (
          await fixture.owner.query(
            "select count(*)::int count from pg_stat_activity where wait_event_type='Lock' and query like '%finish_entra_mfa%' and pid<>pg_backend_pid()",
          )
        ).rows[0].count,
      ).toBeGreaterThan(0),
    );
    await vi.waitFor(
      async () =>
        expect(
          (
            await fixture.owner.query(
              "select clock_timestamp()>=expires_at expired from private.entra_mfa_challenges where proof_hash=$1",
              [proof],
            )
          ).rows[0].expired,
        ).toBe(true),
      { timeout: 4000, interval: 20 },
    );
    await locker.query("commit");
    expect(await work).toBeNull();
    expect(
      (
        await fixture.owner.query(
          "select * from private.entra_mfa_challenges where proof_hash=$1",
          [proof],
        )
      ).rows,
    ).toHaveLength(0);
    expect(await sessions.verify(session.token)).toMatchObject({
      assurance: "aal2",
    });
  } finally {
    await locker.query("rollback");
    await work?.catch(() => {});
    locker.release();
  }
}, 10000);

it("serializes recovery regeneration and factor removal with one winner and realm-wide revocation", async () => {
  const realm = {
    ...sessionRealm,
    applicationOrigin: "https://native-mfa-lifecycle.example.test",
  };
  const identity = {
    ...sessionIdentity,
    subject: `${realm.tenantId}:80000000-0000-4000-8000-000000000008`,
  };
  await fixture.owner.query(
    "insert into provider_identities(profile_id,provider,subject) values($1,'entra',$2) on conflict(profile_id,provider) do update set subject=excluded.subject",
    [ids.admin, identity.subject],
  );
  const pool = new Pool({ ...fixture.settings(), max: 4 });
  try {
    const db = new PostgresDatabase(pool),
      sessions = new EntraSessionService(new PostgresEntraSessions(db), realm);
    const mfa = new EntraMfaService(
      new PostgresEntraMfa(db),
      {
        protector: new MfaSecretProtector("test", {
          test: randomBytes(32).toString("base64url"),
        }),
        authenticator: new MfaAuthenticator("Native"),
        recovery: new MfaRecoveryCodes(),
      },
      sessions.realmHash,
    );
    const first = await sessions.issue(identity),
      setup = await mfa.prepare(first.token);
    if (setup.enrolled) throw Error("expected synthetic enrollment");
    const secret = new URL(setup.provisioningUri).searchParams.get("secret")!;
    const enrolled = await mfa.verify(first.token, await generate({ secret }));
    const second = await sessions.issue(identity);
    const results = await Promise.allSettled([
      mfa.regenerate(enrolled.token, enrolled.recoveryCodes![0], true),
      mfa.regenerate(second.token, enrolled.recoveryCodes![0], true),
    ]);
    const winners = results.filter((x) => x.status === "fulfilled");
    expect(winners).toHaveLength(1);
    expect(results.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect(await sessions.verify(enrolled.token)).toBeNull();
    expect(await sessions.verify(second.token)).toBeNull();
    const current = winners[0].value;
    const third = await sessions.issue(identity);
    const removals = await Promise.allSettled([
      mfa.remove(current.token, current.recoveryCodes[0], true),
      mfa.remove(third.token, current.recoveryCodes[0], true),
    ]);
    expect(removals.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(removals.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect(await sessions.verify(current.token)).toBeNull();
    expect(await sessions.verify(third.token)).toBeNull();
    expect(
      (
        await fixture.owner.query(
          "select * from private.entra_mfa_factors where realm_hash=$1",
          [sessions.realmHash],
        )
      ).rows,
    ).toHaveLength(0);
    const fresh = await sessions.issue(identity);
    expect((await mfa.prepare(fresh.token)).enrolled).toBe(false);
  } finally {
    await pool.end();
  }
});
it("rechecks recent-primary authentication after a lifecycle factor-lock wait", async () => {
  const realm = {
    ...sessionRealm,
    applicationOrigin: "https://native-mfa-freshness.example.test",
  };
  const identity = {
    ...sessionIdentity,
    subject: `${realm.tenantId}:80000000-0000-4000-8000-000000000008`,
  };
  await fixture.owner.query(
    "insert into provider_identities(profile_id,provider,subject) values($1,'entra',$2) on conflict(profile_id,provider) do update set subject=excluded.subject",
    [ids.admin, identity.subject],
  );
  const sessions = new EntraSessionService(
      new PostgresEntraSessions(fixture.database),
      realm,
    ),
    repository = new PostgresEntraMfa(fixture.database);
  const crypto = {
    protector: new MfaSecretProtector("test", {
      test: randomBytes(32).toString("base64url"),
    }),
    authenticator: new MfaAuthenticator("Native"),
    recovery: new MfaRecoveryCodes(),
  };
  const mfa = new EntraMfaService(repository, crypto, sessions.realmHash);
  const first = await sessions.issue(identity),
    setup = await mfa.prepare(first.token);
  if (setup.enrolled) throw Error("expected synthetic enrollment");
  const secret = new URL(setup.provisioningUri).searchParams.get("secret")!;
  const current = await mfa.verify(first.token, await generate({ secret }));
  await fixture.owner.query(
    "update private.entra_sessions set created_at=statement_timestamp()-interval '10 minutes'+interval '2 seconds',expires_at=statement_timestamp()+interval '7 hours 50 minutes'+interval '2 seconds' where token_hash=$1",
    [sessionHash(current.token)],
  );
  const proof = randomBytes(32).toString("hex");
  const challenge = await repository.beginAction(
    sessionHash(current.token),
    sessions.realmHash,
    proof,
    true,
    "remove",
  );
  expect(challenge).not.toBeNull();
  const digest = crypto.recovery.digest(current.recoveryCodes![0], {
    realmHash: sessions.realmHash,
    profileId: ids.admin,
    factorId: setup.factorId,
  });
  const locker = await fixture.owner.connect();
  let work: ReturnType<PostgresEntraMfa["finishAction"]> | undefined;
  try {
    await locker.query("begin");
    await locker.query(
      "select id from private.entra_mfa_factors where id=$1 for update",
      [setup.factorId],
    );
    work = repository.finishAction({
      tokenHash: sessionHash(current.token),
      realmHash: sessions.realmHash,
      proofHash: proof,
      operation: "remove",
      step: null,
      recoveryDigest: digest,
      newTokenHash: null,
      recoveryDigests: null,
    });
    await vi.waitFor(async () =>
      expect(
        (
          await fixture.owner.query(
            "select count(*)::int count from pg_stat_activity where wait_event_type='Lock' and query like '%finish_entra_mfa_action%' and pid<>pg_backend_pid()",
          )
        ).rows[0].count,
      ).toBeGreaterThan(0),
    );
    await vi.waitFor(
      async () =>
        expect(
          (
            await fixture.owner.query(
              "select clock_timestamp()>=created_at+interval '10 minutes' stale from private.entra_sessions where token_hash=$1",
              [sessionHash(current.token)],
            )
          ).rows[0].stale,
        ).toBe(true),
      { timeout: 5000, interval: 20 },
    );
    await locker.query("commit");
    expect(await work).toBeNull();
    expect(
      (
        await fixture.owner.query(
          "select * from private.entra_mfa_challenges where proof_hash=$1",
          [proof],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await fixture.owner.query(
          "select * from private.entra_mfa_recovery where factor_id=$1 and consumed_at is not null",
          [setup.factorId],
        )
      ).rows,
    ).toHaveLength(0);
    expect(await sessions.verify(current.token)).toMatchObject({
      assurance: "aal2",
    });
  } finally {
    await locker.query("rollback");
    await work?.catch(() => {});
    locker.release();
  }
}, 10000);

it("serializes durable provisioning claims, one-use create intent and uncertain reconciliation across native connections", async () => {
  const tenant = "a0000000-0000-4000-8000-000000000001",
    domain = "synthetic.onmicrosoft.com",
    profile = randomUUID();
  await fixture.owner.query(
    "insert into profiles(id,display_name,email,role,status) values($1,'Synthetic Native Provisioning',$2,'client','active')",
    [profile, `native-${profile}@example.test`],
  );
  const pool = new Pool({ ...fixture.settings(), max: 4 });
  try {
    const database = new PostgresDatabase(pool),
      repository = new PostgresEntraProvisioning(database),
      context = await testAuth(database).requireAdmin();
    const leases = Array.from({ length: 4 }, () => randomUUID());
    const claims = await Promise.all(
      leases.map((lease) =>
        repository.claim(context, tenant, domain, profile, lease),
      ),
    );
    expect(claims.filter((x) => x.mode === "check")).toHaveLength(1);
    expect(claims.filter((x) => x.mode === "busy")).toHaveLength(3);
    const index = claims.findIndex((x) => x.mode === "check"),
      lease = leases[index];
    const intents = await Promise.all(
      Array.from({ length: 4 }, () =>
        repository.start(context, tenant, profile, lease),
      ),
    );
    expect(intents.filter(Boolean)).toHaveLength(1);
    await fixture.owner.query(
      "update private.entra_provisioning set lease_until=clock_timestamp()-interval '1 second' where tenant_id=$1 and profile_id=$2",
      [tenant, profile],
    );
    const next = randomUUID();
    expect(
      (await repository.claim(context, tenant, domain, profile, next)).mode,
    ).toBe("reconcile");
    expect(await repository.start(context, tenant, profile, next)).toBe(false);
    expect(await repository.start(context, tenant, profile, lease)).toBe(false);
    const object = randomUUID();
    expect(
      await repository.complete(context, tenant, profile, lease, object),
    ).toBe(false);
    const finished = await Promise.all(
      Array.from({ length: 3 }, () =>
        repository.complete(context, tenant, profile, next, object),
      ),
    );
    expect(finished.filter(Boolean)).toHaveLength(1);
    expect(
      (
        await fixture.owner.query(
          "select subject from provider_identities where profile_id=$1 and provider='entra'",
          [profile],
        )
      ).rows,
    ).toEqual([{ subject: `${tenant}:${object}` }]);
    await expect(
      pool.query("select * from private.entra_provisioning"),
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await pool.end();
  }
});
it("rechecks provisioning lease expiry after a real profile-lock wait", async () => {
  const tenant = "a0000000-0000-4000-8000-000000000002",
    profile = randomUUID(),
    lease = randomUUID(),
    domain = "synthetic.onmicrosoft.com";
  await fixture.owner.query(
    "insert into profiles(id,display_name,email,role,status) values($1,'Synthetic Provisioning Lease',$2,'client','active')",
    [profile, `native-${profile}@example.test`],
  );
  const repository = new PostgresEntraProvisioning(fixture.database),
    context = await testAuth(fixture.database).requireAdmin();
  await repository.claim(context, tenant, domain, profile, lease);
  await fixture.owner.query(
    "update private.entra_provisioning set lease_until=clock_timestamp()+interval '1 second' where tenant_id=$1 and profile_id=$2",
    [tenant, profile],
  );
  const locker = await fixture.owner.connect();
  let work: ReturnType<PostgresEntraProvisioning["start"]> | undefined;
  try {
    await locker.query("begin");
    await locker.query("select id from profiles where id=$1 for update", [
      profile,
    ]);
    work = repository.start(context, tenant, profile, lease);
    await vi.waitFor(async () =>
      expect(
        (
          await fixture.owner.query(
            "select count(*)::int count from pg_stat_activity where wait_event_type='Lock' and query like '%start_entra_provisioning%' and pid<>pg_backend_pid()",
          )
        ).rows[0].count,
      ).toBeGreaterThan(0),
    );
    await vi.waitFor(
      async () =>
        expect(
          (
            await fixture.owner.query(
              "select clock_timestamp()>=lease_until expired from private.entra_provisioning where tenant_id=$1 and profile_id=$2",
              [tenant, profile],
            )
          ).rows[0].expired,
        ).toBe(true),
      { timeout: 4000, interval: 20 },
    );
    await locker.query("commit");
    expect(await work).toBe(false);
    expect(
      (
        await fixture.owner.query(
          "select status from private.entra_provisioning where tenant_id=$1 and profile_id=$2",
          [tenant, profile],
        )
      ).rows[0].status,
    ).toBe("checking");
  } finally {
    await locker.query("rollback");
    await work?.catch(() => {});
    locker.release();
  }
}, 10000);

it("keeps recovery purpose atomic across native one-use transaction consumption and denies legacy intent loss", async () => {
  const pool = new Pool({ ...fixture.settings(), max: 3 });
  try {
    const database = new PostgresDatabase(pool),
      repository = new PostgresLoginTransactions(database),
      value = { ...loginTransaction(), purpose: "recovery" as const };
    await repository.create(value);
    expect(
      (
        await database.withIdentity(null, (sql) =>
          sql.query("select * from private.take_entra_transaction($1,$2,$3)", [
            value.stateHash,
            value.bindingHash,
            value.configurationHash,
          ]),
        )
      ).rows,
    ).toHaveLength(0);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        repository.take(
          value.stateHash,
          value.bindingHash,
          value.configurationHash,
        ),
      ),
    );
    expect(results.filter(Boolean)).toEqual([
      {
        nonce: value.nonce,
        codeVerifier: value.codeVerifier,
        purpose: "recovery",
      },
    ]);
    expect(
      await repository.take(
        value.stateHash,
        value.bindingHash,
        value.configurationHash,
      ),
    ).toBeNull();
  } finally {
    await pool.end();
  }
});
it("commits verified recovery revocation before minting and does not revive old sessions after a mint failure", async () => {
  await fixture.owner.query(
    "insert into provider_identities(profile_id,provider,subject) values($1,'entra',$2) on conflict(profile_id,provider) do update set subject=excluded.subject",
    [ids.a, sessionIdentity.subject],
  );
  const realm = {
      ...sessionRealm,
      applicationOrigin: "https://native-recovery.example.test",
    },
    repository = new PostgresEntraSessions(fixture.database),
    sessions = new EntraSessionService(repository, realm);
  const a = await sessions.issue(sessionIdentity),
    other = await sessions.issue(sessionIdentity),
    fresh = await sessions.issueRecovery(sessionIdentity);
  expect(await sessions.verify(a.token)).toBeNull();
  expect(await sessions.verify(other.token)).toBeNull();
  expect(await sessions.verify(fresh.token)).toMatchObject({
    assurance: "aal1",
  });
  const failing = new EntraSessionService(
    {
      resolve: repository.resolve.bind(repository),
      revoke: repository.revoke.bind(repository),
      revokeVerified: repository.revokeVerified.bind(repository),
      create: async () => {
        throw Error("synthetic mint failure");
      },
    },
    realm,
  );
  await expect(failing.issueRecovery(sessionIdentity)).rejects.toThrow(
    "synthetic mint failure",
  );
  expect(await sessions.verify(fresh.token)).toBeNull();
  expect(
    (
      await fixture.owner.query(
        "select * from private.entra_sessions where realm_hash=$1 and profile_id=$2 and revoked_at is null",
        [sessions.realmHash, ids.a],
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await fixture.database.withIdentity(
        { ...sessionIdentity, assurance: "aal2" },
        (sql) =>
          sql.query<{ revoked: boolean }>(
            "select private.revoke_entra_verified_sessions($1) revoked",
            [sessions.realmHash],
          ),
      )
    ).rows[0].revoked,
  ).toBe(false);
});
it("denies a recovery transaction that expires while waiting for its private row lock", async () => {
  const repository = new PostgresLoginTransactions(fixture.database),
    value = { ...loginTransaction(), purpose: "recovery" as const };
  await repository.create(value);
  await fixture.owner.query(
    "update private.entra_login_transactions set created_at=statement_timestamp()-interval '10 minutes'+interval '1 second',expires_at=statement_timestamp()+interval '1 second' where state_hash=$1",
    [value.stateHash],
  );
  const locker = await fixture.owner.connect();
  let work: ReturnType<PostgresLoginTransactions["take"]> | undefined;
  try {
    await locker.query("begin");
    await locker.query(
      "select state_hash from private.entra_login_transactions where state_hash=$1 for update",
      [value.stateHash],
    );
    work = repository.take(
      value.stateHash,
      value.bindingHash,
      value.configurationHash,
    );
    await vi.waitFor(async () =>
      expect(
        (
          await fixture.owner.query(
            "select count(*)::int count from pg_stat_activity where wait_event_type='Lock' and query like '%take_entra_transaction_flow%' and pid<>pg_backend_pid()",
          )
        ).rows[0].count,
      ).toBeGreaterThan(0),
    );
    await vi.waitFor(
      async () =>
        expect(
          (
            await fixture.owner.query(
              "select clock_timestamp()>=expires_at expired from private.entra_login_transactions where state_hash=$1",
              [value.stateHash],
            )
          ).rows[0].expired,
        ).toBe(true),
      { timeout: 4000, interval: 20 },
    );
    await locker.query("commit");
    expect(await work).toBeNull();
  } finally {
    await locker.query("rollback");
    await work?.catch(() => {});
    locker.release();
  }
}, 10000);

it("waits for a checked-out native pool connection before closing telemetry", async () => {
  const { ServerShutdownCoordinator } =
    await import("@/server/server-shutdown");
  const pool = new Pool({ ...fixture.settings(), max: 1 });
  const client = await pool.connect();
  let released = false;
  const telemetry = vi.fn(async () => {});
  const coordinator = new ServerShutdownCoordinator(
    () => pool.end(),
    telemetry,
  );
  const pending = coordinator.shutdown();
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(telemetry).not.toHaveBeenCalled();
    client.release();
    released = true;
    expect(await pending).toEqual({ database: "closed", telemetry: "closed" });
    expect(telemetry).toHaveBeenCalledOnce();
    await expect(pool.query("select 1")).rejects.toThrow(/after calling end/i);
  } finally {
    if (!released) client.release();
    await pending;
  }
}, 10000);
it("records native maintenance completion/failure without publishing partial writes and protects status history", async () => {
  const { PostgresMaintenanceRepository } =
    await import("@/server/providers/postgres-maintenance");
  const { MaintenanceService } =
    await import("@/server/modules/offers/maintenance-service");
  const repository = new PostgresMaintenanceRepository(fixture.database);
  const maintenance = new MaintenanceService(
    testAuth(fixture.database),
    repository,
    {
      provider: "external",
      environment: "test",
      secret: "synthetic-native-maintenance-history-secret",
    },
  );
  const original = (
    await fixture.owner.query(
      "select pg_get_functiondef('private.expire_offers()'::regprocedure) definition",
    )
  ).rows[0].definition;
  await maintenance.runScheduled(
    "Bearer synthetic-native-maintenance-history-secret",
  );
  expect(await maintenance.status()).toMatchObject({
    state: "current",
    lastScheduledOutcome: "completed",
  });
  const offer = (
    await fixture.owner.query(
      "insert into offers(title,description,category,eligibility,terms,status,starts_at,ends_at,created_by) values('SYNTHETIC native failed maintenance','test','member','test','test','published',now()-interval '2 days',now()-interval '1 day',$1) returning id",
      [ids.admin],
    )
  ).rows[0].id;
  const auditBefore = (
    await fixture.owner.query("select count(*)::int count from audit_logs")
  ).rows[0].count;
  const before = (
    await fixture.owner.query(
      "select count(*)::int count from private.maintenance_runs",
    )
  ).rows[0].count;
  try {
    await fixture.owner.query(
      "create or replace function private.expire_offers() returns integer language plpgsql security definer set search_path='' as $$ begin update public.offers set status='expired' where title='SYNTHETIC native failed maintenance';raise exception 'private-native-sql-secret';end $$;",
    );
    await expect(
      maintenance.runScheduled(
        "Bearer synthetic-native-maintenance-history-secret",
      ),
    ).rejects.toMatchObject({ code: "MAINTENANCE_FAILED" });
    expect(
      (
        await fixture.owner.query("select status from offers where id=$1", [
          offer,
        ])
      ).rows[0].status,
    ).toBe("published");
    expect(
      (await fixture.owner.query("select count(*)::int count from audit_logs"))
        .rows[0].count,
    ).toBe(auditBefore);
    expect(await maintenance.status()).toMatchObject({
      state: "failed",
      lastScheduledExpiredOffers: null,
    });
    expect(
      (
        await fixture.owner.query(
          "select count(*)::int count from private.maintenance_runs",
        )
      ).rows[0].count,
    ).toBe(before + 1);
    for (const who of ["a", "b"] as const) {
      await expect(
        fixture.database.withIdentity(identity(who), (sql) =>
          sql.query("select * from private.run_maintenance_batch()"),
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        fixture.database.withIdentity(identity(who), (sql) =>
          sql.query("select * from private.maintenance_status()"),
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        fixture.database.withIdentity(identity(who), (sql) =>
          sql.query("select * from private.maintenance_runs"),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    }
  } finally {
    await fixture.owner.query(original);
  }
}, 10000);
it("restores an exact native archive snapshot into a quarantined fresh target and prevents restored authentication proof reuse", async () => {
  await new NativeRestoreRehearsal(fixture).run();
}, 60000);
