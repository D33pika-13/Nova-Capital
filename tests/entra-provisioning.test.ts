import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { TestDatabase, ids, testAuth } from "./fixtures/database";
import { AuthorizationService } from "@/server/modules/identity/authorization-service";
import { ClientService } from "@/server/modules/clients/client-service";
import { InvitationService } from "@/server/modules/clients/invitation-service";
import {
  EntraProvisioningService,
  type EntraProvisioningDirectory,
} from "@/server/modules/clients/entra-provisioning-service";
import { PostgresEntraProvisioning } from "@/server/providers/postgres-entra-provisioning";
import { PostgresClientRepository } from "@/server/providers/postgres-clients";
import { PostgresInvitationRepository } from "@/server/providers/postgres-invitations";
import { PostgresProfileRepository } from "@/server/providers/postgres-database";
import { EntraAccountInvitationProvider } from "@/server/providers/entra-accounts";
import { EntraDirectoryUsers } from "@/server/providers/entra-directory";
import type { EmailProvider } from "@/server/contracts";
import { AppError } from "@/server/errors";
const db = new TestDatabase(),
  tenant = "40000000-0000-4000-8000-000000000004",
  domain = "synthetic.onmicrosoft.com";
const adminIdentity = {
  provider: "entra",
  subject: `${tenant}:80000000-0000-4000-8000-000000000008`,
  assurance: "aal2" as const,
};
const auth = new AuthorizationService(
  {
    verify: async () => adminIdentity,
    signIn: vi.fn(),
    signOut: vi.fn(),
    requestReset: vi.fn(),
    setPassword: vi.fn(),
  },
  new PostgresProfileRepository(db),
);
const clients = new ClientService(auth, new PostgresClientRepository(db)),
  repository = new PostgresEntraProvisioning(db);
beforeAll(async () => {
  await db.initialize();
  await db.engine.query(
    "insert into provider_identities(profile_id,provider,subject) values($1,'entra',$2)",
    [ids.admin, adminIdentity.subject],
  );
}, 20000);
afterAll(() => db.close());
async function fixture() {
  const client = await clients.create({
    requestId: randomUUID(),
    displayName: "Synthetic Provisioning Client",
    email: `fixture-${randomUUID()}@example.test`,
  });
  const oid = randomUUID(),
    account = {
      objectId: oid,
      subject: `${tenant}:${oid}`,
      email: client.email,
    };
  let remote: typeof account | null = null;
  const directory = {
    findByEmail: vi.fn<EntraProvisioningDirectory["findByEmail"]>(
      async () => remote,
    ),
    getById: vi.fn<EntraProvisioningDirectory["getById"]>(async () => {
      if (!remote) throw new AppError("DIRECTORY_UNAVAILABLE", "private", 503);
      return remote;
    }),
    createCustomer: vi.fn<EntraProvisioningDirectory["createCustomer"]>(
      async () => {
        remote = account;
        return account;
      },
    ),
  };
  const provisioning = new EntraProvisioningService(repository, directory, {
    tenantId: tenant,
    tenantSubdomain: "synthetic",
  });
  const provider = new EntraAccountInvitationProvider(provisioning, {
    applicationOrigin: "https://app.example.test",
    recoveryMode: "hosted_sspr",
  });
  const email = { send: vi.fn<EmailProvider["send"]>(async () => {}) },
    limits = { consume: vi.fn(async () => true) };
  const invitations = new InvitationService(
    auth,
    new PostgresInvitationRepository(db),
    provider,
    email,
    limits,
    "Synthetic Example Firm",
  );
  return {
    client,
    account,
    directory,
    provisioning,
    provider,
    email,
    invitations,
    context: await auth.requireAdmin(),
    setRemote: (value: typeof account | null) => {
      remote = value;
    },
  };
}
async function ledger(clientId: string) {
  return (
    await db.engine.query<{
      status: string;
      object_id: string | null;
      lease_id: string;
      email_hash: Uint8Array;
    }>(
      "select * from private.entra_provisioning where profile_id=$1 and tenant_id=$2",
      [clientId, tenant],
    )
  ).rows[0];
}

describe("durable Entra account provisioning and invitations", () => {
  it("records intent before one creation, atomically maps the verified identity and sends accurate hosted instructions", async () => {
    const state = await fixture();
    state.directory.createCustomer.mockImplementation(async () => {
      expect((await ledger(state.client.id)).status).toBe("creating");
      state.setRemote(state.account);
      return state.account;
    });
    const input = { requestId: randomUUID(), purpose: "setup" };
    expect((await state.invitations.send(state.client.id, input)).status).toBe(
      "accepted",
    );
    expect((await state.invitations.send(state.client.id, input)).status).toBe(
      "accepted",
    );
    expect(state.directory.createCustomer).toHaveBeenCalledTimes(1);
    expect(state.email.send).toHaveBeenCalledTimes(1);
    expect(await ledger(state.client.id)).toMatchObject({
      status: "ready",
      object_id: state.account.objectId,
    });
    const message = state.email.send.mock.calls[0][0];
    expect(message.text).toContain("Forgot password?");
    expect(message.text).toContain("https://app.example.test/login");
    expect(message.text).not.toContain("single-use");
    expect(message.text).not.toContain(state.account.subject);
    const linked = (
      await db.engine.query(
        "select subject from provider_identities where profile_id=$1 and provider='entra'",
        [state.client.id],
      )
    ).rows;
    expect(linked).toEqual([{ subject: state.account.subject }]);
    const audit = JSON.stringify(
      (
        await db.engine.query(
          "select * from audit_logs where entity='account_provisioning'",
        )
      ).rows,
    );
    expect(audit).not.toContain(state.client.email);
    expect(audit).not.toContain((await ledger(state.client.id)).lease_id);
    expect(audit).not.toContain("email_hash");
  });
  it("reconciles possible creation through reads only, even with email duplicate-risk acknowledgement", async () => {
    const state = await fixture();
    state.directory.createCustomer.mockRejectedValueOnce(
      new AppError(
        "ACCOUNT_CREATION_UNCERTAIN",
        "private bootstrap password",
        503,
      ),
    );
    await expect(
      state.invitations.send(state.client.id, {
        requestId: randomUUID(),
        purpose: "setup",
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_PROVISIONING_UNCERTAIN" });
    expect((await ledger(state.client.id)).status).toBe("unknown");
    expect(state.email.send).not.toHaveBeenCalled();
    await expect(
      state.invitations.send(state.client.id, {
        requestId: randomUUID(),
        purpose: "setup",
        acknowledgeDuplicateRisk: true,
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_PROVISIONING_UNCERTAIN" });
    expect(state.directory.createCustomer).toHaveBeenCalledTimes(1);
    state.setRemote(state.account);
    expect(
      (
        await state.invitations.send(state.client.id, {
          requestId: randomUUID(),
          purpose: "setup",
        })
      ).status,
    ).toBe("accepted");
    expect(state.directory.createCustomer).toHaveBeenCalledTimes(1);
    expect(state.email.send).toHaveBeenCalledTimes(1);
    expect((await ledger(state.client.id)).status).toBe("ready");
  });
  it("allows a new checked attempt only after a proven no-creation failure", async () => {
    const state = await fixture();
    state.directory.createCustomer.mockRejectedValueOnce(
      new AppError("DIRECTORY_REJECTED", "private", 503),
    );
    await expect(
      state.provisioning.prepare(
        state.context,
        state.client.id,
        state.client.email,
        null,
        "setup",
      ),
    ).rejects.toMatchObject({ code: "DIRECTORY_REJECTED" });
    expect((await ledger(state.client.id)).status).toBe("rejected");
    expect(
      await state.provisioning.prepare(
        state.context,
        state.client.id,
        state.client.email,
        null,
        "setup",
      ),
    ).toMatchObject({ subject: state.account.subject });
    expect(state.directory.findByEmail).toHaveBeenCalledTimes(2);
    expect(state.directory.createCustomer).toHaveBeenCalledTimes(2);
  });
  it("treats unknown exception/ownership failure after creation intent as uncertain", async () => {
    const state = await fixture();
    state.directory.createCustomer.mockRejectedValueOnce(
      Error("private transport reset"),
    );
    await expect(
      state.provisioning.prepare(
        state.context,
        state.client.id,
        state.client.email,
        null,
        "setup",
      ),
    ).rejects.toMatchObject({ code: "ACCOUNT_PROVISIONING_UNCERTAIN" });
    expect((await ledger(state.client.id)).status).toBe("unknown");
    expect(state.email.send).not.toHaveBeenCalled();
  });
  it("a crashed creating lease can only reconcile and stale holders cannot create or complete", async () => {
    const state = await fixture(),
      first = randomUUID();
    expect(
      (
        await repository.claim(
          state.context,
          tenant,
          domain,
          state.client.id,
          first,
        )
      ).mode,
    ).toBe("check");
    expect(
      await repository.start(state.context, tenant, state.client.id, first),
    ).toBe(true);
    expect(
      (
        await repository.claim(
          state.context,
          tenant,
          domain,
          state.client.id,
          randomUUID(),
        )
      ).mode,
    ).toBe("busy");
    await db.engine.query(
      "update private.entra_provisioning set lease_until=clock_timestamp()-interval '1 second' where profile_id=$1",
      [state.client.id],
    );
    const next = randomUUID();
    expect(
      (
        await repository.claim(
          state.context,
          tenant,
          domain,
          state.client.id,
          next,
        )
      ).mode,
    ).toBe("reconcile");
    expect(
      await repository.start(state.context, tenant, state.client.id, first),
    ).toBe(false);
    expect(
      await repository.start(state.context, tenant, state.client.id, next),
    ).toBe(false);
    expect(
      await repository.complete(
        state.context,
        tenant,
        state.client.id,
        first,
        state.account.objectId,
      ),
    ).toBe(false);
    await repository.release(
      state.context,
      tenant,
      state.client.id,
      next,
      false,
    );
    await expect(
      state.provisioning.prepare(
        state.context,
        state.client.id,
        state.client.email,
        null,
        "setup",
      ),
    ).rejects.toMatchObject({ code: "ACCOUNT_PROVISIONING_UNCERTAIN" });
    expect(state.directory.createCustomer).not.toHaveBeenCalled();
  });
  it("reclaims an expired read-only lease without granting the old holder a write", async () => {
    const state = await fixture(),
      first = randomUUID();
    await repository.claim(
      state.context,
      tenant,
      domain,
      state.client.id,
      first,
    );
    await db.engine.query(
      "update private.entra_provisioning set lease_until=clock_timestamp()-interval '1 second' where profile_id=$1",
      [state.client.id],
    );
    const next = randomUUID();
    expect(
      (
        await repository.claim(
          state.context,
          tenant,
          domain,
          state.client.id,
          next,
        )
      ).mode,
    ).toBe("check");
    expect(
      await repository.start(state.context, tenant, state.client.id, first),
    ).toBe(false);
    expect(
      await repository.start(state.context, tenant, state.client.id, next),
    ).toBe(true);
  });
  it("verifies existing customer accounts and never creates during reset or on ready replay", async () => {
    const state = await fixture();
    state.setRemote(state.account);
    await state.invitations.send(state.client.id, {
      requestId: randomUUID(),
      purpose: "setup",
    });
    await state.invitations.send(state.client.id, {
      requestId: randomUUID(),
      purpose: "reset",
    });
    expect(state.directory.createCustomer).not.toHaveBeenCalled();
    expect(state.directory.findByEmail).toHaveBeenCalledTimes(1);
    expect(state.directory.getById).toHaveBeenCalledExactlyOnceWith(
      state.account.objectId,
      state.client.email,
    );
    expect(state.email.send).toHaveBeenCalledTimes(2);
  });
  it("denies client/low-assurance/forged contexts and private table/helper access", async () => {
    const state = await fixture(),
      clientContext = await testAuth(db, "a").requireUser(),
      low = await testAuth(db, "admin", "aal1").requireUser();
    for (const context of [
      clientContext,
      low,
      {
        ...clientContext,
        profile: state.context.profile,
        assurance: "aal2" as const,
        identity: { ...clientContext.identity, assurance: "aal2" as const },
      },
    ])
      await expect(
        state.provisioning.prepare(
          context,
          state.client.id,
          state.client.email,
          null,
          "setup",
        ),
      ).rejects.toMatchObject({ status: 403 });
    await expect(
      db.withIdentity(state.context.identity, (sql) =>
        sql.query("select * from private.entra_provisioning"),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.withIdentity(state.context.identity, (sql) =>
        sql.query("select private.lock_entra_provisioning_client($1)", [
          state.client.id,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
    expect(state.directory.findByEmail).not.toHaveBeenCalled();
  });
  it("rejects changed email/tenant-domain and cross-profile takeover before Graph I/O", async () => {
    const state = await fixture(),
      lease = randomUUID();
    await repository.claim(
      state.context,
      tenant,
      domain,
      state.client.id,
      lease,
    );
    await repository.release(
      state.context,
      tenant,
      state.client.id,
      lease,
      false,
    );
    await expect(
      repository.claim(
        state.context,
        tenant,
        "other.onmicrosoft.com",
        state.client.id,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 409 });
    const replacement = `changed-${randomUUID()}@example.test`;
    await db.engine.query("update profiles set email=$1 where id=$2", [
      replacement,
      state.client.id,
    ]);
    await expect(
      state.provisioning.prepare(
        state.context,
        state.client.id,
        replacement,
        null,
        "setup",
      ),
    ).rejects.toMatchObject({ status: 409 });
    const other = await fixture();
    await db.engine.query("update profiles set email=$1 where id=$2", [
      state.client.email,
      other.client.id,
    ]);
    await expect(
      repository.claim(
        state.context,
        tenant,
        domain,
        other.client.id,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(state.directory.findByEmail).not.toHaveBeenCalled();
  });
  it("rechecks current client state before intent and completion and refuses identity mismatch", async () => {
    const state = await fixture(),
      lease = randomUUID();
    await repository.claim(
      state.context,
      tenant,
      domain,
      state.client.id,
      lease,
    );
    await db.engine.query(
      "update profiles set status='suspended' where id=$1",
      [state.client.id],
    );
    await expect(
      repository.start(state.context, tenant, state.client.id, lease),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      repository.complete(
        state.context,
        tenant,
        state.client.id,
        lease,
        state.account.objectId,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await db.engine.query("update profiles set status='active' where id=$1", [
      state.client.id,
    ]);
    await repository.release(
      state.context,
      tenant,
      state.client.id,
      lease,
      false,
    );
    state.directory.findByEmail.mockResolvedValue({
      ...state.account,
      subject: `${tenant}:${randomUUID()}`,
    });
    await expect(
      state.provisioning.prepare(
        state.context,
        state.client.id,
        state.client.email,
        null,
        "setup",
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_CONFLICT" });
    expect(
      (
        await db.engine.query(
          "select * from provider_identities where profile_id=$1",
          [state.client.id],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("separates SMTP uncertainty from provisioning and never recreates on explicit resend", async () => {
    const state = await fixture();
    state.email.send.mockRejectedValueOnce(Error("synthetic SMTP timeout"));
    const request = { requestId: randomUUID(), purpose: "setup" };
    await expect(
      state.invitations.send(state.client.id, request),
    ).rejects.toMatchObject({ code: "DELIVERY_UNCERTAIN" });
    expect((await ledger(state.client.id)).status).toBe("ready");
    expect(
      (await state.invitations.send(state.client.id, request)).status,
    ).toBe("unknown");
    expect(
      (
        await state.invitations.send(state.client.id, {
          requestId: randomUUID(),
          purpose: "setup",
          acknowledgeDuplicateRisk: true,
        })
      ).status,
    ).toBe("accepted");
    expect(state.directory.createCustomer).toHaveBeenCalledTimes(1);
    expect(state.email.send).toHaveBeenCalledTimes(2);
  });
  it("composes Graph readback uncertainty, eventual reconciliation, SQL mapping and one email acceptance", async () => {
    const state = await fixture();
    let created = false,
      visible = false;
    const remote = {
      id: state.account.objectId,
      accountEnabled: true,
      userType: "Member",
      identities: [
        {
          signInType: "emailAddress",
          issuer: domain,
          issuerAssignedId: state.client.email,
        },
      ],
    };
    const transport = vi.fn<typeof fetch>(async (url, init) => {
      if (init?.method === "POST") {
        created = true;
        return Response.json({ id: state.account.objectId }, { status: 201 });
      }
      if (new URL(String(url)).pathname.endsWith(state.account.objectId))
        return new Response(null, { status: 404 });
      return Response.json({ value: created && visible ? [remote] : [] });
    });
    const directory = new EntraDirectoryUsers(
      { tenantId: tenant, tenantSubdomain: "synthetic" },
      {
        getToken: async () => ({
          token: "synthetic-graph-token",
          expiresOnTimestamp: Date.now() + 60000,
        }),
      },
      transport,
    );
    const provisioning = new EntraProvisioningService(repository, directory, {
      tenantId: tenant,
      tenantSubdomain: "synthetic",
    });
    const provider = new EntraAccountInvitationProvider(provisioning, {
      applicationOrigin: "https://app.example.test",
      recoveryMode: "hosted_sspr",
    });
    const service = new InvitationService(
      auth,
      new PostgresInvitationRepository(db),
      provider,
      state.email,
      { consume: async () => true },
      "Synthetic Example Firm",
    );
    const input = { requestId: randomUUID(), purpose: "setup" };
    await expect(service.send(state.client.id, input)).rejects.toMatchObject({
      code: "ACCOUNT_PROVISIONING_UNCERTAIN",
    });
    await expect(service.send(state.client.id, input)).rejects.toMatchObject({
      code: "ACCOUNT_PROVISIONING_UNCERTAIN",
    });
    expect(state.email.send).not.toHaveBeenCalled();
    visible = true;
    expect((await service.send(state.client.id, input)).status).toBe(
      "accepted",
    );
    expect(
      transport.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
    expect(state.email.send).toHaveBeenCalledTimes(1);
    expect((await ledger(state.client.id)).status).toBe("ready");
  });
  it("keeps known email acceptance distinct from a failed status save", async () => {
    const state = await fixture(),
      base = new PostgresInvitationRepository(db);
    const finish = vi.fn(base.finish.bind(base));
    finish.mockImplementationOnce(async (context, id, status) => {
      await base.finish(context, id, status);
      throw Error("synthetic commit acknowledgement loss");
    });
    const service = new InvitationService(
      auth,
      { claim: base.claim.bind(base), attach: base.attach.bind(base), finish },
      state.provider,
      state.email,
      { consume: async () => true },
      "Synthetic Example Firm",
    );
    const input = { requestId: randomUUID(), purpose: "setup" };
    await expect(service.send(state.client.id, input)).rejects.toMatchObject({
      code: "INVITATION_TRACKING_UNCERTAIN",
    });
    expect(
      finish.mock.calls.every(([, , status]) => status === "accepted"),
    ).toBe(true);
    expect((await service.send(state.client.id, input)).status).toBe(
      "accepted",
    );
    expect(state.email.send).toHaveBeenCalledTimes(1);
    expect(state.directory.createCustomer).toHaveBeenCalledTimes(1);
  });
});
