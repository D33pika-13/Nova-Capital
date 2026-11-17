import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { TestDatabase, testAuth, ids } from "./fixtures/database";
import { ClientService } from "@/server/modules/clients/client-service";
import { PostgresClientRepository } from "@/server/providers/postgres-clients";
let db: TestDatabase;
let clients: ClientService;
beforeAll(async () => {
  db = new TestDatabase();
  await db.initialize();
  clients = new ClientService(testAuth(db), new PostgresClientRepository(db));
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe("client lifecycle through application classes and real RLS", () => {
  it("creates an auto-numbered client and returns the same result on retry", async () => {
    const input = {
      requestId: randomUUID(),
      displayName: "Synthetic New Client",
      email: "new@example.test",
    };
    const first = await clients.create(input);
    const replay = await clients.create(input);
    expect(first.clientId).toBe("INV-1003");
    expect(replay).toEqual(first);
    expect(first.identityLinked).toBe(false);
    expect(
      (
        await db.engine.query(
          "select * from profiles where email='new@example.test'",
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("rejects request-key reuse for a different client", async () => {
    const key = randomUUID();
    await clients.create({
      requestId: key,
      displayName: "One",
      email: "one@example.test",
    });
    await expect(
      clients.create({
        requestId: key,
        displayName: "Two",
        email: "two@example.test",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await db.engine.query(
          "select * from profiles where email='two@example.test'",
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("normalizes email uniqueness and never creates an admin from request input", async () => {
    await expect(
      clients.create({
        requestId: randomUUID(),
        displayName: "Forged",
        email: "forged@example.test",
        role: "admin",
      }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      clients.create({
        requestId: randomUUID(),
        displayName: "Duplicate",
        email: "CLIENT-A@example.test",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it.each(["suspended", "deactivated"] as const)(
    "updates with a full-precision concurrency token and audits %s",
    async (status) => {
      const before = await clients.get(ids.b);
      expect(before.updatedAt).toMatch(/\.\d{6}Z$/);
      const updated = await clients.update(ids.b, {
        requestId: randomUUID(),
        displayName: "Synthetic B edited",
        status,
        expectedUpdatedAt: before.updatedAt,
      });
      expect(updated.status).toBe(status);
      await expect(testAuth(db, "b").requireUser()).rejects.toMatchObject({
        status: 403,
      });
      const logs = await db.engine.query<{ actor_id: string }>(
        "select actor_id from audit_logs where entity_id=$1 and action='UPDATE'",
        [ids.b],
      );
      expect(logs.rows.at(-1)?.actor_id).toBe(ids.admin);
      await clients.update(ids.b, {
        requestId: randomUUID(),
        displayName: "Synthetic B",
        status: "active",
        expectedUpdatedAt: updated.updatedAt,
      });
    },
  );
  it("rejects stale client edits without overwriting newer data", async () => {
    const before = await clients.get(ids.a);
    await clients.update(ids.a, {
      requestId: randomUUID(),
      displayName: "Latest A",
      status: "active",
      expectedUpdatedAt: before.updatedAt,
    });
    await expect(
      clients.update(ids.a, {
        requestId: randomUUID(),
        displayName: "Stale A",
        status: "deactivated",
        expectedUpdatedAt: before.updatedAt,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await clients.get(ids.a)).displayName).toBe("Latest A");
  });
  it("searches literal input safely and filters status", async () => {
    expect(
      (await clients.list({ query: "INV-1001", status: "active" })).map(
        (c) => c.id,
      ),
    ).toEqual([ids.a]);
    expect(await clients.list({ query: "%' OR 1=1 --" })).toEqual([]);
  });
  it("blocks client and MFA-less administrator access", async () => {
    await expect(
      new ClientService(
        testAuth(db, "a"),
        new PostgresClientRepository(db),
      ).list(),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      new ClientService(
        testAuth(db, "admin", "aal1"),
        new PostgresClientRepository(db),
      ).create({}),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
  });
  it("keeps administrative notes private and audit-backed", async () => {
    const note = await clients.addNote(ids.a, {
      requestId: randomUUID(),
      note: "Internal synthetic note",
    });
    expect((await clients.notes(ids.a)).some((n) => n.id === note.id)).toBe(
      true,
    );
    const identity = (await testAuth(db, "a").requireUser()).identity;
    expect(
      (
        await db.withIdentity(identity, (c) =>
          c.query("select * from admin_notes"),
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("derives overview metrics from database records", async () => {
    const metrics = await clients.metrics();
    const count = (
      await db.engine.query<{ count: number }>(
        "select count(*)::int as count from profiles where role='client'",
      )
    ).rows[0].count;
    expect(metrics.totalClients).toBe(count);
    expect(metrics.latestActivity.length).toBeGreaterThan(0);
  });
  it("skips manually reserved identifiers during automatic assignment", async () => {
    const current = (
      await db.engine.query<{ last_value: number }>(
        "select last_value::int from private.client_number",
      )
    ).rows[0].last_value;
    const reserved = current + 1;
    await clients.create({
      requestId: randomUUID(),
      displayName: "Reserved",
      email: "reserved@example.test",
      clientId: `INV-${reserved}`,
    });
    const automatic = await clients.create({
      requestId: randomUUID(),
      displayName: "Auto after reserved",
      email: "after-reserved@example.test",
    });
    expect(automatic.clientId).toBe(`INV-${reserved + 1}`);
  });
});
