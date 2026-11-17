import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it } from "vitest";
import { TestDatabase, testAuth } from "./fixtures/database";
import { EducationService } from "@/server/modules/education/education-service";
import { PostgresEducationRepository } from "@/server/providers/postgres-education";
import { educationConfirmation } from "@/lib/education-inputs";
const db = new TestDatabase();
const repository = new PostgresEducationRepository(db);
const options = {
  enabled: true,
  secret: "synthetic-education-hash-secret-at-least-32",
};
const allowed = { consume: async () => true };
const service = (
  who: "admin" | "a" | "b" = "admin",
  assurance: "aal1" | "aal2" = "aal2",
) =>
  new EducationService(
    repository,
    testAuth(db, who, assurance),
    allowed,
    options,
  );
const input = () => ({
  requestId: randomUUID(),
  name: "SYNTHETIC Education visitor",
  email: randomUUID() + "@example.test",
  phone: "+44 7700 900123",
  service: "webinars",
  message: "",
  consent: true,
  website: "",
});
beforeAll(() => db.initialize(), 20000);
afterAll(() => db.close());
it("commits guest details and consent once, with metadata-only audit and exact replay", async () => {
  const data = input();
  const result = await service().submit(data, "203.0.113.25");
  expect(result).toEqual({
    reference: data.requestId,
    status: "received",
    message: educationConfirmation,
  });
  expect(await service().submit(data, "203.0.113.25")).toEqual(result);
  const records = await service().list();
  expect(records.find((r) => r.id === data.requestId)).toMatchObject({
    name: data.name,
    email: data.email,
    phone: data.phone,
    service: "webinars",
    message: "",
  });
  const row = (
    await db.engine.query<{ consented_at: unknown }>(
      "select consented_at from private.education_requests where id=$1",
      [data.requestId],
    )
  ).rows[0];
  expect(row.consented_at).toBeTruthy();
  const audits = (
    await db.engine.query(
      "select * from audit_logs where entity='education_requests' and entity_id=$1",
      [data.requestId],
    )
  ).rows;
  expect(audits).toHaveLength(1);
  const audit = JSON.stringify(audits);
  for (const value of [
    data.name,
    data.email,
    data.phone,
    "203.0.113.25",
    options.secret,
  ])
    expect(audit).not.toContain(value);
  expect(JSON.stringify(result)).not.toContain(data.email);
  await expect(
    service().submit({ ...data, service: "mentorship" }, null),
  ).rejects.toMatchObject({ status: 409 });
});
it("stores mentorship separately, preserves literal text safely, and filters and pages admin requests", async () => {
  const data = {
    ...input(),
    service: "mentorship",
    message: '<script>alert("synthetic")</script>\nLearning question',
  };
  await service("a").submit(data, null);
  expect(
    (await service().list({ service: "mentorship" })).find(
      (r) => r.id === data.requestId,
    )?.message,
  ).toBe(data.message);
  expect(
    (await service().list({ service: "webinars" })).some(
      (r) => r.id === data.requestId,
    ),
  ).toBe(false);
  expect(await service().list({ offset: 10000 })).toEqual([]);
  await expect(service().list({ role: "admin" })).rejects.toMatchObject({
    status: 422,
  });
});
it.each(["a", "b"] as const)(
  "denies %s at service and database read boundaries",
  async (who) => {
    await expect(service(who).list()).rejects.toMatchObject({ status: 403 });
    const context = await testAuth(db, who).requireUser();
    expect(
      await repository.list(context, { service: "all", offset: 0 }),
    ).toEqual([]);
  },
);
it("denies anonymous and AAL1 admin reads and all direct runtime writes", async () => {
  await expect(
    new EducationService(
      repository,
      {
        requireAdmin: async () => {
          throw Object.assign(new Error("sign in"), { status: 401 });
        },
      },
      allowed,
      options,
    ).list(),
  ).rejects.toMatchObject({ status: 401 });
  await expect(service("admin", "aal1").list()).rejects.toMatchObject({
    status: 403,
  });
  expect(
    await db.withIdentity(
      null,
      async (sql) =>
        (await sql.query("select * from private.education_requests")).rows,
    ),
  ).toEqual([]);
  for (const sql of [
    "delete from private.education_requests",
    "update private.education_requests set name='changed'",
    "insert into private.education_requests(id) values(gen_random_uuid())",
  ]) {
    await expect(
      db.withIdentity(null, async (client) => client.query(sql)),
    ).rejects.toThrow(/permission denied/);
  }
});
it.each([
  { name: "" },
  { name: "Header\r\ninjection" },
  { email: "bad" },
  { phone: "abc12345" },
  { phone: "123456" },
  { phone: "1234567890123456" },
  { service: "trading" },
  { consent: false },
  { website: "bot.test" },
  { message: "x".repeat(3001) },
  { message: "bad\u0001" },
  { role: "admin" },
  { clientId: randomUUID() },
])("rejects invalid/untrusted fields %j", async (fields) => {
  await expect(
    service().submit({ ...input(), ...fields }, null),
  ).rejects.toMatchObject({ status: 422 });
});
it("fails closed for missing configuration, invalid ingress and a shared limit denial", async () => {
  await expect(
    new EducationService(repository, testAuth(db), allowed, {
      enabled: false,
    }).submit(input(), null),
  ).rejects.toMatchObject({ status: 503 });
  await expect(
    service().submit(input(), "untrusted-header"),
  ).rejects.toMatchObject({ status: 503 });
  const data = input();
  await expect(
    new EducationService(
      repository,
      testAuth(db),
      { consume: async () => false },
      options,
    ).submit(data, null),
  ).rejects.toMatchObject({ status: 429 });
  expect(
    (
      await db.engine.query(
        "select id from private.education_requests where id=$1",
        [data.requestId],
      )
    ).rows,
  ).toHaveLength(0);
});
it("rolls back the submitted personal data when its audit cannot commit", async () => {
  const data = input();
  await db.engine.exec(
    "create function private.reject_education_audit() returns trigger language plpgsql as $$ begin if new.entity='education_requests' then raise exception 'synthetic audit failure';end if;return new;end $$;create trigger reject_education before insert on audit_logs for each row execute function private.reject_education_audit();",
  );
  try {
    await expect(service().submit(data, null)).rejects.toThrow(/audit failure/);
  } finally {
    await db.engine.exec(
      "drop trigger reject_education on audit_logs;drop function private.reject_education_audit();",
    );
  }
  expect(
    (
      await db.engine.query(
        "select id from private.education_requests where id=$1",
        [data.requestId],
      )
    ).rows,
  ).toHaveLength(0);
});
