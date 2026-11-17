import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { TestDatabase, testAuth } from "./fixtures/database";
import { ClientService } from "@/server/modules/clients/client-service";
import { InvitationService } from "@/server/modules/clients/invitation-service";
import { PostgresClientRepository } from "@/server/providers/postgres-clients";
import { PostgresInvitationRepository } from "@/server/providers/postgres-invitations";
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
async function fixture() {
  return clients.create({
    requestId: randomUUID(),
    displayName: "Synthetic Invitation Client",
    email: `fixture-${randomUUID()}@example.test`,
  });
}
function setup(companyName = "Synthetic Example Firm") {
  const subjects = new Map<string, string>();
  const accounts = {
    prepare: vi.fn(async (email: string) => {
      if (!subjects.has(email)) subjects.set(email, randomUUID());
      return {
        subject: subjects.get(email)!,
        provider: "supabase",
        link: "https://example.test/auth/callback?token_hash=synthetic-test-only&type=invite",
      };
    }),
  };
  const email = { send: vi.fn(async () => {}) };
  const limits = { consume: vi.fn(async () => true) };
  return {
    accounts,
    email,
    limits,
    service: new InvitationService(
      testAuth(db),
      new PostgresInvitationRepository(db),
      accounts,
      email,
      limits,
      companyName,
    ),
  };
}
describe("durable invitation workflow", () => {
  it("links the correct identity and does not resend a repeated accepted request", async () => {
    const client = await fixture();
    const s = setup();
    const request = { requestId: randomUUID(), purpose: "setup" };
    expect((await s.service.send(client.id, request)).status).toBe("accepted");
    expect((await s.service.send(client.id, request)).status).toBe("accepted");
    expect(s.accounts.prepare).toHaveBeenCalledTimes(1);
    expect(s.email.send).toHaveBeenCalledTimes(1);
    expect(s.email.send.mock.calls[0]).toBeDefined();
    expect(s.email.send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Your Synthetic Example Firm account invitation",
      }),
    );
    expect((await clients.get(client.id)).identityLinked).toBe(true);
    expect((await clients.get(client.id)).invitationStatus).toBe("accepted");
  });
  it("does not store setup links/tokens in application records or audit logs", async () => {
    const audit = await db.engine.query(
      "select * from audit_logs where entity='client_invitations'",
    );
    expect(JSON.stringify(audit.rows)).not.toContain("synthetic-test-only");
  });
  it("allows retry after preparation failed without an email attempt", async () => {
    const client = await fixture();
    const s = setup();
    s.accounts.prepare.mockRejectedValueOnce(new Error("Provider unavailable"));
    const input = { requestId: randomUUID(), purpose: "setup" };
    await expect(s.service.send(client.id, input)).rejects.toMatchObject({
      code: "INVITATION_FAILED",
    });
    expect(s.email.send).not.toHaveBeenCalled();
    expect((await s.service.send(client.id, input)).status).toBe("accepted");
    expect(s.email.send).toHaveBeenCalledTimes(1);
  });
  it("does not silently resend ambiguous SMTP delivery", async () => {
    const client = await fixture();
    const s = setup();
    s.email.send.mockRejectedValueOnce(
      new Error("SMTP timeout after submission"),
    );
    const input = { requestId: randomUUID(), purpose: "setup" };
    await expect(s.service.send(client.id, input)).rejects.toMatchObject({
      code: "DELIVERY_UNCERTAIN",
    });
    expect((await clients.get(client.id)).invitationStatus).toBe("unknown");
    expect((await s.service.send(client.id, input)).status).toBe("unknown");
    expect(s.email.send).toHaveBeenCalledTimes(1);
    await expect(
      s.service.send(client.id, { ...input, requestId: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await s.service.send(client.id, {
          ...input,
          requestId: randomUUID(),
          acknowledgeDuplicateRisk: true,
        })
      ).status,
    ).toBe("accepted");
    expect(s.email.send).toHaveBeenCalledTimes(2);
  });
  it("rejects caller-supplied recipient email and request-key reuse", async () => {
    const first = await fixture();
    const second = await fixture();
    const s = setup();
    await expect(
      s.service.send(first.id, {
        requestId: randomUUID(),
        purpose: "setup",
        email: "attacker@example.test",
      }),
    ).rejects.toMatchObject({ status: 422 });
    const key = randomUUID();
    await s.service.send(first.id, { requestId: key, purpose: "setup" });
    await expect(
      s.service.send(second.id, { requestId: key, purpose: "setup" }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("does not invite inactive clients or reset unlinked accounts", async () => {
    const client = await fixture();
    const s = setup();
    await expect(
      s.service.send(client.id, { requestId: randomUUID(), purpose: "reset" }),
    ).rejects.toMatchObject({ code: "NOT_INVITED" });
    await clients.update(client.id, {
      requestId: randomUUID(),
      displayName: client.displayName,
      status: "suspended",
      expectedUpdatedAt: client.updatedAt,
    });
    await expect(
      s.service.send(client.id, { requestId: randomUUID(), purpose: "setup" }),
    ).rejects.toMatchObject({ code: "INACTIVE_CLIENT" });
    expect(s.email.send).not.toHaveBeenCalled();
  });
  it("blocks clients and enforces shared rate limits before provider calls", async () => {
    const client = await fixture();
    const s = setup();
    s.limits.consume.mockResolvedValue(false);
    await expect(
      s.service.send(client.id, { requestId: randomUUID(), purpose: "setup" }),
    ).rejects.toMatchObject({ status: 429 });
    expect(s.accounts.prepare).not.toHaveBeenCalled();
    const denied = new InvitationService(
      testAuth(db, "a"),
      new PostgresInvitationRepository(db),
      s.accounts,
      s.email,
      s.limits,
      "Synthetic Example Firm",
    );
    await expect(denied.send(client.id, {})).rejects.toMatchObject({
      status: 403,
    });
  });
  it("uses injected company branding for reset mail after account setup", async () => {
    const client = await fixture();
    const s = setup("  Synthetic Replacement Firm  ");
    await s.service.send(client.id, {
      requestId: randomUUID(),
      purpose: "setup",
    });
    await s.service.send(client.id, {
      requestId: randomUUID(),
      purpose: "reset",
    });
    expect(s.email.send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        subject: "Your Synthetic Replacement Firm password reset",
      }),
    );
  });
  it.each([
    "",
    "   ",
    "Synthetic\r\nBcc: private@example.test",
    "Synthetic\n",
    "Synthetic\u0000",
    "x".repeat(201),
  ])("rejects invalid branding without exposing its value", (companyName) => {
    expect(() => setup(companyName)).toThrow(
      "Invalid server configuration: companyName",
    );
  });
});
