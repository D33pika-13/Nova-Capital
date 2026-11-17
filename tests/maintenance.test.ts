import { beforeAll, afterAll, it, expect } from "vitest";
import { TestDatabase, testAuth, ids } from "./fixtures/database";
import { MaintenanceService } from "@/server/modules/offers/maintenance-service";
import { PostgresMaintenanceRepository } from "@/server/providers/postgres-maintenance";
const db = new TestDatabase();
const secret = "synthetic-maintenance-token-for-local-tests";
const repository = new PostgresMaintenanceRepository(db);
const scheduled = new MaintenanceService(testAuth(db), repository, {
  provider: "external",
  environment: "test",
  secret,
});
beforeAll(() => db.initialize(), 20000);
afterAll(() => db.close());
it("authenticates scheduled work independently of cookies and fails closed for missing or wrong secrets", async () => {
  for (const token of [
    null,
    "Bearer wrong",
    `Basic ${secret}`,
    `Bearer ${secret} `,
  ])
    await expect(scheduled.runScheduled(token)).rejects.toMatchObject({
      status: 401,
    });
  for (const options of [
    { provider: "external" as const, environment: "test" as const },
    { provider: "database" as const, environment: "staging" as const, secret },
    { provider: "local" as const, environment: "production" as const, secret },
  ])
    await expect(
      new MaintenanceService(testAuth(db), repository, options).runScheduled(
        `Bearer ${secret}`,
      ),
    ).rejects.toMatchObject({ status: 503 });
  const local = new MaintenanceService(testAuth(db), repository, {
    provider: "local",
    environment: "development",
    secret,
  });
  expect(await local.runScheduled(`Bearer ${secret}`)).toMatchObject({
    expiredOffers: 0,
  });
});
it("expires only ended published offers, in bounded repeatable batches, with system audit and version changes", async () => {
  await db.engine.query(
    "insert into offers(title,description,category,eligibility,terms,status,starts_at,ends_at,created_by) select 'SYNTHETIC due '||g,'test','member','test','test','published',now()-interval '2 days',now()-interval '1 day',$1 from generate_series(1,501) g",
    [ids.admin],
  );
  await db.engine.query(
    "insert into offers(title,description,category,eligibility,terms,status,starts_at,ends_at,created_by) values('SYNTHETIC current','test','member','test','test','published',now()-interval '1 day',now()+interval '1 day',$1),('SYNTHETIC draft','test','member','test','test','draft',now()-interval '2 days',now()-interval '1 day',$1)",
    [ids.admin],
  );
  expect(await scheduled.runScheduled(`Bearer ${secret}`)).toEqual({
    expiredOffers: 500,
    batchLimit: 500,
    mayHaveMore: true,
  });
  expect(await scheduled.runScheduled(`Bearer ${secret}`)).toEqual({
    expiredOffers: 1,
    batchLimit: 500,
    mayHaveMore: false,
  });
  expect(await scheduled.runScheduled(`Bearer ${secret}`)).toMatchObject({
    expiredOffers: 0,
  });
  const changed = await db.engine.query<{ count: number }>(
    "select count(*)::int count from offers where status='expired' and version=2",
  );
  expect(changed.rows[0].count).toBe(501);
  const audit = await db.engine.query<{ count: number }>(
    "select count(*)::int count from audit_logs where entity='offers' and action='UPDATE' and actor_id is null and after_data->>'status'='expired'",
  );
  expect(audit.rows[0].count).toBe(501);
  const retained = await db.engine.query<{ title: string; status: string }>(
    "select title,status from offers where title in ('SYNTHETIC current','SYNTHETIC draft') order by title",
  );
  expect(retained.rows).toEqual([
    { title: "SYNTHETIC current", status: "published" },
    { title: "SYNTHETIC draft", status: "draft" },
  ]);
});
it("requires admin MFA for manual work and denies client invocation of the SQL maintenance capability", async () => {
  for (const auth of [testAuth(db, "a"), testAuth(db, "admin", "aal1")])
    await expect(
      new MaintenanceService(auth, repository, {
        provider: "local",
        environment: "test",
      }).runAsAdmin(),
    ).rejects.toMatchObject({ status: 403 });
  await expect(
    db.withIdentity(
      { provider: "supabase", subject: "synthetic-a", assurance: "aal2" },
      (sql) => sql.query("select private.expire_offers()"),
    ),
  ).rejects.toMatchObject({ code: "42501" });
  const manual = new MaintenanceService(testAuth(db), repository, {
    provider: "local",
    environment: "test",
  });
  expect(await manual.runAsAdmin()).toMatchObject({ expiredOffers: 0 });
});
