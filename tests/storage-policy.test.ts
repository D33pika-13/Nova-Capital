import { beforeAll, afterAll, it, expect } from "vitest";
import { TestDatabase, testAuth } from "./fixtures/database";
import { PostgresReportRepository } from "@/server/providers/postgres-reports";
let db: TestDatabase;
beforeAll(async () => {
  db = new TestDatabase();
  await db.initialize(true);
  await db.engine.exec(
    "insert into storage.buckets(id,name,public) values('other','other',false);insert into storage.objects(bucket_id,name) values('client-reports','sensitive.pdf'),('other','other.txt');",
  );
}, 30000);
afterAll(async () => {
  await db.close();
});
it("registers a private report bucket and verifies the restrictive policy", async () => {
  const repo = new PostgresReportRepository(db);
  expect(
    await repo.storageReady(
      await testAuth(db).requireAdmin(),
      "client-reports",
    ),
  ).toBe(true);
});
it.each(["anon", "authenticated"])(
  "denies %s direct report access despite a broad existing policy",
  async (role) => {
    await db.engine.exec(`begin;set local role ${role};`);
    try {
      const result = await db.engine.query<{ bucket_id: string }>(
        "select bucket_id from storage.objects",
      );
      expect(result.rows).toEqual([{ bucket_id: "other" }]);
      await expect(
        db.engine.query(
          "insert into storage.objects(bucket_id,name) values('client-reports','forged.pdf')",
        ),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await db.engine.exec("rollback");
    }
  },
);
it("fails readiness when the bucket becomes public or policy is removed", async () => {
  const repo = new PostgresReportRepository(db);
  const context = await testAuth(db).requireAdmin();
  await db.engine.exec(
    "update storage.buckets set public=true where id='client-reports'",
  );
  expect(await repo.storageReady(context, "client-reports")).toBe(false);
  await db.engine.exec(
    "update storage.buckets set public=false where id='client-reports'",
  );
  await db.engine.exec(
    "select private.configure_report_bucket('client-reports',10485760)",
  );
  const policy = (
    await db.engine.query<{ polname: string }>(
      "select polname from pg_policy where polname like 'nova_reports_%'",
    )
  ).rows[0].polname;
  await db.engine.exec(`drop policy "${policy}" on storage.objects`);
  expect(await repo.storageReady(context, "client-reports")).toBe(false);
});
