import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { TestDatabase } from "./fixtures/database";

const db = new TestDatabase();
let operation: string;
beforeAll(async () => {
  await db.initialize();
  // Policy/operation tests only. Actual pg_cron execution is a separate staging gate.
  await db.engine.exec(`create schema cron;
    create table cron.job(jobid bigint generated always as identity primary key,jobname text not null,schedule text not null,command text not null,username text not null,database text not null default current_database(),active boolean default true,unique(jobname,username));
    create table cron.job_run_details(runid bigint generated always as identity primary key,jobid bigint,end_time timestamptz);
    create function cron.schedule(p_name text,p_schedule text,p_command text) returns bigint language sql as $$
      insert into cron.job(jobname,schedule,command,username) values(p_name,p_schedule,p_command,current_user)
      on conflict(jobname,username) do update set schedule=excluded.schedule,command=excluded.command returning jobid $$;
    create function cron.alter_job(job_id bigint,active boolean default null) returns void language sql as $$ update cron.job set active=coalesce($2,cron.job.active) where jobid=$1 $$;
    grant usage on schema cron to public; grant select on cron.job to public;`);
  operation = await readFile(
    "supabase/operations/install-maintenance-scheduler.sql",
    "utf8",
  );
}, 30000);
afterAll(() => db.close());
async function settings(overrides: Record<string, string> = {}) {
  const current = (
    await db.engine.query<{ name: string }>("select current_database() as name")
  ).rows[0].name;
  const values = {
    target: current,
    environment: "staging",
    operation: randomUUID(),
    verify_minute: "false",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values))
    await db.engine.query("select set_config($1,$2,false)", [
      `nova.scheduler_${key}`,
      value,
    ]);
  return values;
}
async function apply() {
  try {
    await db.engine.exec(operation);
  } catch (error) {
    await db.engine.exec("rollback; reset role");
    throw error;
  }
}
it("rejects missing/wrong intent, accelerated production cadence and non-owner execution before scheduling", async () => {
  const invalidSettings: Record<string, string>[] = [
    { target: "other-database" },
    { operation: "" },
    { environment: "development" },
    { environment: "production", verify_minute: "true" },
  ];
  for (const invalid of invalidSettings) {
    await settings(invalid);
    await expect(apply()).rejects.toThrow();
  }
  await settings();
  await db.engine.exec("set role nova_app");
  await expect(apply()).rejects.toMatchObject({ code: "42501" });
  expect((await db.engine.query("select * from cron.job")).rows).toEqual([]);
});
it("installs the fixed job idempotently, audits intent and prevents conflicting operation-ID reuse", async () => {
  const intent = await settings();
  await apply();
  await apply();
  const jobs = (
    await db.engine.query<{
      jobname: string;
      schedule: string;
      active: boolean;
    }>("select * from cron.job")
  ).rows;
  const membership = (
    await db.engine.query<{ set_option: boolean; inherit_option: boolean }>(
      "select set_option,inherit_option from pg_auth_members where roleid='nova_app'::regrole and member=current_user::regrole",
    )
  ).rows[0];
  expect(membership).toEqual({ set_option: true, inherit_option: false });
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({
    jobname: "nova-maintenance-staging",
    schedule: "*/15 * * * *",
    active: true,
  });
  expect(
    (
      await db.engine.query(
        "select * from audit_logs where action='SCHEDULER_CONFIGURE' and entity_id=$1",
        [intent.operation],
      )
    ).rows,
  ).toHaveLength(1);
  await settings({ ...intent, environment: "production" });
  await expect(apply()).rejects.toThrow("reused");
  expect((await db.engine.query("select * from cron.job")).rows).toHaveLength(
    1,
  );
});
it("clears caller identity, records a scheduler batch and prunes only this job's old operational history", async () => {
  const job = (
    await db.engine.query<{ jobid: number; command: string }>(
      "select jobid::integer,command from cron.job where jobname='nova-maintenance-staging'",
    )
  ).rows[0];
  await db.engine.query(
    "insert into cron.job_run_details(jobid,end_time) values($1,now()-interval '8 days'),(99999,now()-interval '8 days')",
    [job.jobid],
  );
  await db.engine.query(
    "select set_config('app.provider','supabase',false),set_config('app.subject','synthetic-a',false),set_config('app.assurance','aal1',false)",
  );
  await db.engine.exec(`begin;${job.command}commit;`);
  const run = (
    await db.engine.query(
      "select origin,actor_id,outcome from private.maintenance_runs order by id desc limit 1",
    )
  ).rows[0];
  expect(run).toEqual({
    origin: "scheduler",
    actor_id: null,
    outcome: "completed",
  });
  expect(
    (await db.engine.query("select jobid::integer from cron.job_run_details"))
      .rows,
  ).toEqual([{ jobid: 99999 }]);
  expect(
    (await db.engine.query<{ role: string }>("select current_user as role"))
      .rows[0].role,
  ).not.toBe("nova_app");
});
it("denies application/client access to cron administration and supports test-only accelerated verification", async () => {
  await db.engine.exec("set role nova_app");
  try {
    await expect(
      db.engine.query("select * from cron.job"),
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await db.engine.exec("reset role");
  }
  await settings({ verify_minute: "true" });
  await apply();
  expect(
    (
      await db.engine.query<{ schedule: string }>(
        "select schedule from cron.job where jobname='nova-maintenance-staging'",
      )
    ).rows[0].schedule,
  ).toBe("* * * * *");
});
