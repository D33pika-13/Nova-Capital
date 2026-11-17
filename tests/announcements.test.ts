import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { TestDatabase, testAuth, ids } from "./fixtures/database";
import { AnnouncementService } from "@/server/modules/offers/announcement-service";
import { PostgresAnnouncementRepository } from "@/server/providers/postgres-announcements";
import type { AnnouncementInput } from "@/lib/announcement-inputs";
const db = new TestDatabase();
const repo = new PostgresAnnouncementRepository(db);
const admin = new AnnouncementService(testAuth(db), repo);
const a = new AnnouncementService(testAuth(db, "a"), repo);
const b = new AnnouncementService(testAuth(db, "b"), repo);
const identity = (subject: string, assurance: "aal1" | "aal2" = "aal2") => ({
  provider: "supabase" as const,
  subject: `synthetic-${subject}`,
  assurance,
});
const input = (): AnnouncementInput => ({
  requestId: randomUUID(),
  title: "SYNTHETIC notice",
  body: "Fixture content only",
  status: "draft",
  clientIds: [ids.a],
});
const edit = (data: AnnouncementInput, version: number) => ({
  ...data,
  requestId: randomUUID(),
  expectedVersion: version,
});
const read = (version: number) => ({
  requestId: randomUUID(),
  expectedVersion: version,
});
beforeAll(() => db.initialize(), 20000);
afterAll(() => db.close());
describe("private announcements", () => {
  it("keeps drafts private, publishes to only intended recipients and hides recipient lists", async () => {
    const data = input();
    const draft = await admin.save(data);
    expect(await a.inbox()).not.toContainEqual(
      expect.objectContaining({ id: draft.id }),
    );
    const notice = await admin.save(
      { ...edit(data, 1), status: "published" },
      draft.id,
    );
    const delivered = (await a.inbox()).find((n) => n.id === notice.id)!;
    expect(delivered).toMatchObject({
      title: data.title,
      body: data.body,
      version: 2,
      readVersion: 0,
      readAt: null,
    });
    expect(delivered).not.toHaveProperty("recipients");
    expect(delivered).not.toHaveProperty("createdBy");
    expect(await b.inbox()).not.toContainEqual(
      expect.objectContaining({ id: notice.id }),
    );
    const anonymous = await db.withIdentity(null, async (sql) => ({
      announcements: (await sql.query("select * from announcements")).rows,
      recipients: (await sql.query("select * from announcement_recipients"))
        .rows,
    }));
    expect(anonymous).toEqual({ announcements: [], recipients: [] });
  });
  it("records only the client acknowledgment, replays without duplicate audit and resets unread after editing", async () => {
    const data = { ...input(), status: "published" as const };
    const notice = await admin.save(data);
    const receipt = await a.markRead(notice.id, read(1));
    expect(receipt.readVersion).toBe(1);
    expect(Number.isFinite(Date.parse(receipt.readAt))).toBe(true);
    const auditCount = async () =>
      (
        await db.engine.query<{ count: number }>(
          "select count(*)::int count from audit_logs where entity='announcement_recipients' and after_data->>'announcement_id'=$1",
          [notice.id],
        )
      ).rows[0].count;
    expect(await auditCount()).toBe(2);
    expect(await a.markRead(notice.id, read(1))).toEqual(receipt);
    expect(await auditCount()).toBe(2);
    const edited = await admin.save(
      { ...edit(data, 1), body: "New synthetic terms" },
      notice.id,
    );
    const inbox = (await a.inbox()).find((n) => n.id === notice.id)!;
    expect(inbox).toMatchObject({ version: edited.version, readVersion: 1 });
    await expect(a.markRead(notice.id, read(1))).rejects.toMatchObject({
      status: 409,
    });
    await a.markRead(notice.id, read(2));
    expect((await a.inbox()).find((n) => n.id === notice.id)!.readVersion).toBe(
      2,
    );
  });
  it("unpublishes, archives and changes recipient membership without deleting receipt history", async () => {
    const data = { ...input(), status: "published" as const };
    const notice = await admin.save(data);
    await a.markRead(notice.id, read(1));
    await admin.save({ ...edit(data, 1), clientIds: [ids.b] }, notice.id);
    expect(await a.inbox()).not.toContainEqual(
      expect.objectContaining({ id: notice.id }),
    );
    expect(await b.inbox()).toContainEqual(
      expect.objectContaining({ id: notice.id, readVersion: 0 }),
    );
    await expect(a.markRead(notice.id, read(2))).rejects.toMatchObject({
      status: 409,
    });
    await admin.save(
      { ...edit(data, 2), status: "draft", clientIds: [ids.a, ids.b] },
      notice.id,
    );
    expect(await b.inbox()).not.toContainEqual(
      expect.objectContaining({ id: notice.id }),
    );
    await admin.save({ ...edit(data, 3), status: "published" }, notice.id);
    expect((await a.inbox()).find((n) => n.id === notice.id)!.readVersion).toBe(
      1,
    );
    const receiptRows = await db.engine.query<{ count: number }>(
      "select count(*)::int count from announcement_recipients where announcement_id=$1",
      [notice.id],
    );
    expect(receiptRows.rows[0].count).toBe(2);
    await admin.save({ ...edit(data, 4), status: "archived" }, notice.id);
    expect(await a.inbox()).not.toContainEqual(
      expect.objectContaining({ id: notice.id }),
    );
  });
  it("handles idempotency and rejects stale edits, invalid targets and forged identities atomically", async () => {
    const data = input();
    const notice = await admin.save(data);
    expect(await admin.save(data)).toEqual(notice);
    await expect(
      admin.save({ ...data, body: "Changed" }),
    ).rejects.toMatchObject({ status: 409 });
    await admin.save(edit(data, 1), notice.id);
    await expect(admin.save(edit(data, 1), notice.id)).rejects.toMatchObject({
      status: 409,
    });
    for (const clientIds of [[ids.a, ids.a], [ids.admin], [randomUUID()]])
      await expect(admin.save({ ...input(), clientIds })).rejects.toMatchObject(
        { status: 422 },
      );
    await expect(
      admin.save({ ...input(), clientId: ids.b }),
    ).rejects.toMatchObject({ status: 422 });
    expect(
      (await admin.manage()).find((n) => n.id === notice.id)!.version,
    ).toBe(2);
  });
  it("denies clients, low-assurance admins, cross-client acknowledgments, and future/read timestamp tampering in SQL", async () => {
    const notice = await admin.save({ ...input(), status: "published" });
    await expect(a.save(input())).rejects.toMatchObject({ status: 403 });
    await expect(a.manage()).rejects.toMatchObject({ status: 403 });
    const low = new AnnouncementService(testAuth(db, "admin", "aal1"), repo);
    await expect(low.manage()).rejects.toMatchObject({ status: 403 });
    await expect(admin.markRead(notice.id, read(1))).rejects.toMatchObject({
      status: 403,
    });
    await expect(b.markRead(notice.id, read(1))).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      a.markRead(notice.id, { ...read(1), clientId: ids.b }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      db.withIdentity(identity("a"), (sql) =>
        sql.query(
          "update announcement_recipients set read_version=100 where announcement_id=$1",
          [notice.id],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.withIdentity(identity("a"), (sql) =>
        sql.query(
          "update announcement_recipients set read_at=now() where announcement_id=$1",
          [notice.id],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    const hidden = await db.withIdentity(identity("b"), (sql) =>
      sql.query(
        "select id from announcement_recipients where announcement_id=$1",
        [notice.id],
      ),
    );
    expect(hidden.rows).toEqual([]);
  });
  it("blocks suspended accounts even with an existing synthetic session and rejects query identity injection", async () => {
    const notice = await admin.save({ ...input(), status: "published" });
    await db.engine.query(
      "update profiles set status='suspended' where id=$1",
      [ids.a],
    );
    try {
      await expect(a.inbox()).rejects.toMatchObject({ status: 403 });
      await expect(a.markRead(notice.id, read(1))).rejects.toMatchObject({
        status: 403,
      });
      const direct = await db.withIdentity(identity("a"), (sql) =>
        sql.query("select id from announcements where id=$1", [notice.id]),
      );
      expect(direct.rows).toEqual([]);
    } finally {
      await db.engine.query("update profiles set status='active' where id=$1", [
        ids.a,
      ]);
    }
    await expect(a.inbox({ clientId: ids.b })).rejects.toMatchObject({
      status: 422,
    });
  });
});

it("does not allow clients or low-assurance admins to write announcement content or recipients directly", async () => {
  const notice = await admin.save({ ...input(), status: "published" });
  for (const subject of ["a", "b"]) {
    const changed = await db.withIdentity(identity(subject), (sql) =>
      sql.query(
        "update announcements set body='FORGED' where id=$1 returning id",
        [notice.id],
      ),
    );
    expect(changed.rows).toEqual([]);
  }
  await expect(
    db.withIdentity(identity("a"), (sql) =>
      sql.query(
        "insert into announcement_recipients(announcement_id,client_id) values($1,$2)",
        [notice.id, ids.b],
      ),
    ),
  ).rejects.toMatchObject({ code: "42501" });
  const low = await db.withIdentity(identity("admin", "aal1"), (sql) =>
    sql.query("select id from announcements"),
  );
  expect(low.rows).toEqual([]);
  await expect(
    db.withIdentity(identity("admin"), (sql) =>
      sql.query(
        "update announcement_recipients set read_version=1 where announcement_id=$1",
        [notice.id],
      ),
    ),
  ).rejects.toMatchObject({ code: "42501" });
});
it("paginates a client's inbox without accepting another client identity", async () => {
  await db.withIdentity(identity("admin"), (sql) =>
    sql.query(
      "with created as (insert into announcements(title,body,status,created_by) select 'SYNTHETIC page '||g,'test','published',$1 from generate_series(1,51) g returning id) insert into announcement_recipients(announcement_id,client_id) select id,$2 from created",
      [ids.admin, ids.b],
    ),
  );
  const first = await b.inbox();
  const second = await b.inbox({ offset: 50 });
  expect(first).toHaveLength(50);
  expect(second.length).toBeGreaterThan(0);
  expect(
    second.some((n) => first.some((previous) => previous.id === n.id)),
  ).toBe(false);
  expect((await admin.manage()).length).toBe(50);
});
