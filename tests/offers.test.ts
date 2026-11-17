import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { TestDatabase, testAuth, ids } from "./fixtures/database";
import { OfferService } from "@/server/modules/offers/offer-service";
import { PostgresOfferRepository } from "@/server/providers/postgres-offers";
import type { OfferInput } from "@/lib/offer-inputs";
const db = new TestDatabase();
let admin: OfferService;
const base = (): OfferInput => ({
  requestId: randomUUID(),
  title: "Synthetic travel benefit",
  description: "Fixture only",
  category: "travel",
  eligibility: "Invited members",
  terms: "Subject to availability",
  status: "draft",
  startsAt: "2020-01-01T00:00:00.000Z",
  endsAt: "2090-01-01T00:00:00.000Z",
});
beforeAll(async () => {
  await db.initialize();
  admin = new OfferService(testAuth(db), new PostgresOfferRepository(db));
}, 20000);
afterAll(() => db.close());
describe("offer lifecycle and isolation", () => {
  it("keeps drafts private, publishes, unpublishes and preserves audited versions", async () => {
    const input = base();
    const draft = await admin.save(input);
    expect(await admin.current()).not.toContainEqual(
      expect.objectContaining({ id: draft.id }),
    );
    expect(await admin.save(input)).toEqual(draft);
    const published = await admin.save(
      {
        ...input,
        requestId: randomUUID(),
        expectedVersion: 1,
        status: "published",
      },
      draft.id,
    );
    expect(published.version).toBe(2);
    expect(await admin.current()).toContainEqual(published);
    const unpublished = await admin.save(
      { ...input, requestId: randomUUID(), expectedVersion: 2 },
      draft.id,
    );
    expect(unpublished.version).toBe(3);
    expect(await admin.current()).not.toContainEqual(
      expect.objectContaining({ id: draft.id }),
    );
    const audit = await db.engine.query<{ count: number }>(
      "select count(*)::int count from audit_logs where entity_id=$1",
      [draft.id],
    );
    expect(audit.rows[0].count).toBe(3);
  });
  it("rejects stale edits, changed idempotent payloads and malformed or expired publication", async () => {
    const input = base();
    const draft = await admin.save(input);
    await expect(
      admin.save({ ...input, title: "changed" }),
    ).rejects.toMatchObject({ status: 409 });
    await admin.save(
      {
        ...input,
        requestId: randomUUID(),
        expectedVersion: 1,
        title: "Updated",
      },
      draft.id,
    );
    await expect(
      admin.save(
        { ...input, requestId: randomUUID(), expectedVersion: 1 },
        draft.id,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      admin.save({
        ...base(),
        status: "published",
        endsAt: "2021-01-01T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      admin.save({ ...base(), endsAt: "2019-01-01T00:00:00.000Z" }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      admin.save({ ...base(), createdBy: ids.admin }),
    ).rejects.toMatchObject({ status: 422 });
  });
  it("enforces half-open validity windows at the database clock, independently of maintenance", async () => {
    const identity = {
      provider: "supabase" as const,
      subject: "synthetic-admin",
      assurance: "aal2" as const,
    };
    await db.withIdentity(identity, async (sql) => {
      await sql.query(
        `insert into offers(title,description,category,eligibility,terms,status,starts_at,ends_at,created_by) values
    ('Boundary start','test','member','test','test','published',now(),now()+interval '1 day',$1),
    ('Boundary end','test','member','test','test','published',now()-interval '1 day',now(),$1),
    ('Future','test','member','test','test','published',now()+interval '1 day',now()+interval '2 day',$1)`,
        [ids.admin],
      );
      await sql.query(
        "select set_config('app.subject','',true),set_config('app.provider','',true),set_config('app.assurance','',true)",
      );
      const rows = (
        await sql.query<{ title: string }>("select title from offers")
      ).rows.map((row) => row.title);
      expect(rows).toContain("Boundary start");
      expect(rows).not.toContain("Boundary end");
      expect(rows).not.toContain("Future");
    });
  });
  it("denies client writes and admin without MFA in the service and database", async () => {
    for (const auth of [testAuth(db, "a"), testAuth(db, "admin", "aal1")]) {
      const service = new OfferService(auth, new PostgresOfferRepository(db));
      await expect(service.save(base())).rejects.toMatchObject({ status: 403 });
      await expect(service.manage()).rejects.toMatchObject({ status: 403 });
    }
    await expect(
      db.withIdentity(
        { provider: "supabase", subject: "synthetic-a", assurance: "aal2" },
        (sql) =>
          sql.query(
            "insert into offers(title,description,category,eligibility,terms,starts_at,ends_at,created_by) values('x','x','member','x','x',now(),now()+interval '1 day',$1)",
            [ids.a],
          ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
  it("hides manually expired content even before its end and rejects ownership edits", async () => {
    const input = base();
    const record = await admin.save({ ...input, status: "expired" });
    expect(await admin.current()).not.toContainEqual(
      expect.objectContaining({ id: record.id }),
    );
    await expect(
      db.withIdentity(
        { provider: "supabase", subject: "synthetic-admin", assurance: "aal2" },
        (sql) =>
          sql.query("update offers set created_by=$1 where id=$2", [
            ids.a,
            record.id,
          ]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
