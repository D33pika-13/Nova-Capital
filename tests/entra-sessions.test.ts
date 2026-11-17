import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import {
  EntraSessionService,
  type EntraSessionRealm,
  type EntraSessionRepository,
} from "@/server/modules/identity/entra-session-service";
import { PostgresEntraSessions } from "@/server/providers/postgres-entra-sessions";
import { PostgresProfileRepository } from "@/server/providers/postgres-database";
import { AuthorizationService } from "@/server/modules/identity/authorization-service";
import type { IdentityProvider, VerifiedIdentity } from "@/server/contracts";
import { TestDatabase, ids } from "./fixtures/database";

const db = new TestDatabase();
const realm: EntraSessionRealm = {
  tenantId: "40000000-0000-4000-8000-000000000004",
  clientId: "50000000-0000-4000-8000-000000000005",
  issuer:
    "https://synthetic.ciamlogin.com/40000000-0000-4000-8000-000000000004/v2.0",
  applicationOrigin: "https://app.example.test",
};
const oid = {
  a: "60000000-0000-4000-8000-000000000006",
  b: "70000000-0000-4000-8000-000000000007",
  admin: "80000000-0000-4000-8000-000000000008",
};
const identity = (who: keyof typeof oid): VerifiedIdentity => ({
  provider: "entra",
  subject: `${realm.tenantId}:${oid[who]}`,
  assurance: "aal1",
});
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const repository = new PostgresEntraSessions(db);
const service = new EntraSessionService(repository, realm);
beforeAll(async () => {
  await db.initialize();
  for (const who of ["a", "b", "admin"] as const)
    await db.engine.query(
      "insert into provider_identities(profile_id,provider,subject) values($1,'entra',$2)",
      [ids[who], identity(who).subject],
    );
}, 20000);
afterAll(() => db.close());
function auth(token: string) {
  const provider: IdentityProvider = {
    verify: () => service.verify(token),
    signIn: vi.fn(),
    signOut: () => service.revoke(token),
    requestReset: vi.fn(),
    setPassword: vi.fn(),
  };
  return new AuthorizationService(provider, new PostgresProfileRepository(db));
}

describe("persistent Entra application sessions", () => {
  it("mints opaque random tokens, stores only their hashes and keeps secrets out of audit payloads", async () => {
    const session = await service.issue(identity("a"));
    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(session.maxAgeSeconds).toBe(28800);
    const row = (
      await db.engine.query<{
        id: string;
        token_hash: string;
        lifetime: number;
      }>(
        "select *,extract(epoch from expires_at-created_at)::int lifetime from private.entra_sessions where token_hash=$1",
        [hash(session.token)],
      )
    ).rows[0];
    expect(row.token_hash).toBe(hash(session.token));
    expect(row.lifetime).toBe(28800);
    expect(JSON.stringify(row)).not.toContain(session.token);
    const audit = (
      await db.engine.query<{ after_data: unknown }>(
        "select after_data from audit_logs where entity='application_sessions' and entity_id=$1",
        [row.id],
      )
    ).rows;
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(session.token);
    expect(JSON.stringify(audit)).not.toContain(row.token_hash);
    expect(await service.verify(session.token)).toEqual(identity("a"));
    expect(Object.isFrozen(await service.verify(session.token))).toBe(true);
  });
  it("rechecks current mapped profile ownership through real application authorization/RLS", async () => {
    const a = await service.issue(identity("a"));
    const b = await service.issue(identity("b"));
    expect((await auth(a.token).requireUser()).profile.id).toBe(ids.a);
    expect((await auth(b.token).requireUser()).profile.id).toBe(ids.b);
    const verified = (await service.verify(a.token))!;
    const visible = await db.withIdentity(verified, (sql) =>
      sql.query<{ id: string }>("select id from profiles"),
    );
    expect(visible.rows).toEqual([{ id: ids.a }]);
  });
  it("refuses anonymous, unknown, non-Entra, wrong-tenant and caller-elevated issuance", async () => {
    for (const value of [
      { ...identity("a"), assurance: "aal2" as const },
      { ...identity("a"), provider: "supabase" },
      {
        ...identity("a"),
        subject: `90000000-0000-4000-8000-000000000009:${oid.a}`,
      },
    ])
      await expect(service.issue(value)).rejects.toMatchObject({ status: 401 });
    await expect(
      service.issue({
        ...identity("a"),
        subject: `${realm.tenantId}:90000000-0000-4000-8000-000000000009`,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      await db.withIdentity(null, (sql) =>
        sql.query("select * from private.create_entra_session($1,$2)", [
          hash("synthetic"),
          hash("realm"),
        ]),
      ),
    ).toMatchObject({ rows: [] });
  });
  it("does not grant administrator access from an Entra first-factor session", async () => {
    const session = await service.issue(identity("admin"));
    expect((await auth(session.token).requireUser()).profile.role).toBe(
      "admin",
    );
    await expect(auth(session.token).requireAdmin()).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
  });
  it("rotates an existing browser token instead of adopting caller-chosen session IDs", async () => {
    const old = await service.issue(identity("a"));
    const next = await service.issue(identity("a"), old.token);
    expect(next.token).not.toBe(old.token);
    expect(await service.verify(old.token)).toBeNull();
    expect(await service.verify(next.token)).toEqual(identity("a"));
    expect(
      await service.verify(randomBytes(32).toString("base64url")),
    ).toBeNull();
  });
  it("revokes all own-realm sessions on logout without affecting another client", async () => {
    const a = await service.issue(identity("a"));
    const otherA = await service.issue(identity("a"));
    const b = await service.issue(identity("b"));
    await service.revoke(a.token);
    expect(await service.verify(a.token)).toBeNull();
    expect(await service.verify(otherA.token)).toBeNull();
    expect(await service.verify(b.token)).toEqual(identity("b"));
    await service.revoke(a.token); // Already revoked is safe and cannot revoke a future session.
    const newA = await service.issue(identity("a"));
    await service.revoke(a.token);
    expect(await service.verify(newA.token)).toEqual(identity("a"));
  });
  it.each([
    { clientId: "90000000-0000-4000-8000-000000000009" },
    { applicationOrigin: "https://other-app.example.test" },
    {
      issuer:
        "https://another.ciamlogin.com/40000000-0000-4000-8000-000000000004/v2.0",
    },
  ])(
    "isolates sessions from another application realm (%#)",
    async (change) => {
      const session = await service.issue(identity("a"));
      const other = new EntraSessionService(repository, {
        ...realm,
        ...change,
      });
      expect(await other.verify(session.token)).toBeNull();
      await other.revoke(session.token);
      expect(await service.verify(session.token)).toEqual(identity("a"));
    },
  );
  it("expires idle sessions and does not let an expired token revoke a newer session", async () => {
    const expired = await service.issue(identity("a"));
    const current = await service.issue(identity("a"));
    await db.engine.query(
      "update private.entra_sessions set created_at=statement_timestamp()-interval '1 hour',last_seen_at=statement_timestamp()-interval '31 minutes',expires_at=statement_timestamp()+interval '7 hours' where token_hash=$1",
      [hash(expired.token)],
    );
    await service.revoke(expired.token);
    expect(await service.verify(expired.token)).toBeNull();
    expect(await service.verify(current.token)).toEqual(identity("a"));
  });
  it("enforces an absolute eight-hour lifetime and cannot extend expiry by reading", async () => {
    const session = await service.issue(identity("b"));
    const expiresAt = session.expiresAt;
    await service.verify(session.token);
    expect(
      (
        await db.engine.query<{ expires_at: string }>(
          "select expires_at::text from private.entra_sessions where token_hash=$1",
          [hash(session.token)],
        )
      ).rows[0].expires_at,
    ).toBeTruthy();
    const expiry = (
      await db.engine.query<{ expiry: string }>(
        "select to_char(expires_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') expiry from private.entra_sessions where token_hash=$1",
        [hash(session.token)],
      )
    ).rows[0].expiry;
    expect(expiry).toBe(expiresAt);
    await db.engine.query(
      "update private.entra_sessions set created_at=statement_timestamp()-interval '9 hours',last_seen_at=statement_timestamp()-interval '2 hours',expires_at=statement_timestamp()-interval '1 hour' where token_hash=$1",
      [hash(session.token)],
    );
    expect(await service.verify(session.token)).toBeNull();
  });
  it.each(["suspended", "deactivated"])(
    "revokes sessions on %s status and never revives them on reactivation",
    async (status) => {
      const session = await service.issue(identity("a"));
      await db.engine.query("update profiles set status=$2 where id=$1", [
        ids.a,
        status,
      ]);
      expect(await service.verify(session.token)).toBeNull();
      await expect(service.issue(identity("a"))).rejects.toMatchObject({
        status: 403,
      });
      await db.engine.query("update profiles set status='active' where id=$1", [
        ids.a,
      ]);
      expect(await service.verify(session.token)).toBeNull();
    },
  );
  it("revokes sessions when role or identity mapping changes", async () => {
    const session = await service.issue(identity("a"));
    await db.engine.query("update profiles set role='admin' where id=$1", [
      ids.a,
    ]);
    expect(await service.verify(session.token)).toBeNull();
    await db.engine.query("update profiles set role='client' where id=$1", [
      ids.a,
    ]);
    const mapped = await service.issue(identity("a"));
    await db.engine.query(
      "update provider_identities set subject=$2 where provider='entra' and profile_id=$1",
      [ids.a, `${realm.tenantId}:90000000-0000-4000-8000-000000000009`],
    );
    expect(await service.verify(mapped.token)).toBeNull();
    await db.engine.query(
      "update provider_identities set subject=$2 where provider='entra' and profile_id=$1",
      [ids.a, identity("a").subject],
    );
    expect(await service.verify(mapped.token)).toBeNull();
  });
  it("caps active sessions across logins by revoking the oldest and preserving recent sessions", async () => {
    const isolated = new EntraSessionService(repository, {
      ...realm,
      applicationOrigin: "https://capacity.example.test",
    });
    const sessions = [];
    sessions.push(await isolated.issue(identity("b")));
    // Equal clock ticks have no chronological order; make the oldest fixture explicit.
    await db.engine.query(
      "update private.entra_sessions set created_at=created_at-interval '1 second',expires_at=expires_at-interval '1 second' where token_hash=$1",
      [hash(sessions[0].token)],
    );
    for (let n = 0; n < 10; n++)
      sessions.push(await isolated.issue(identity("b")));
    expect(await isolated.verify(sessions[0].token)).toBeNull();
    for (const session of sessions.slice(1))
      expect(await isolated.verify(session.token)).toEqual(identity("b"));
  });
  it("denies runtime table access and removes expired/revoked rows in bounded batches", async () => {
    await expect(
      db.withIdentity(null, (sql) =>
        sql.query("select * from private.entra_sessions"),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.withIdentity(null, (sql) =>
        sql.query("update private.entra_sessions set revoked_at=null"),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    const active = await service.issue(identity("b"));
    await db.engine.query(
      "insert into private.entra_sessions(token_hash,realm_hash,profile_id,identity_id,subject,created_at,last_seen_at,expires_at) select repeat(md5('synthetic-expired-'||g),2),repeat('f',64),$1,i.id,i.subject,statement_timestamp()-interval '9 hours',statement_timestamp()-interval '9 hours',statement_timestamp()-interval '1 hour' from generate_series(1,501) g cross join provider_identities i where i.profile_id=$1 and i.provider='entra'",
      [ids.b],
    );
    const before = (
      await db.engine.query<{ count: number }>(
        "select count(*)::int count from private.entra_sessions",
      )
    ).rows[0].count;
    const removed = await db.withIdentity(
      null,
      async (sql) =>
        (
          await sql.query<{ count: number }>(
            "select private.cleanup_entra_sessions() count",
          )
        ).rows[0].count,
    );
    expect(removed).toBe(500);
    expect(
      (
        await db.engine.query<{ count: number }>(
          "select count(*)::int count from private.entra_sessions",
        )
      ).rows[0].count,
    ).toBe(before - 500);
    expect(await service.verify(active.token)).toEqual(identity("b"));
  });
});

describe("session input and dependency failures", () => {
  it.each([
    { tenantId: "common" },
    { clientId: "not-a-client" },
    { issuer: "https://evil.example.test/v2.0" },
    { issuer: realm.issuer.replace("https:", "http:") },
    { applicationOrigin: "https://app.example.test/portal" },
    { applicationOrigin: "https://user:secret@app.example.test" },
  ])("rejects invalid configured session realms (%#)", (change) => {
    expect(
      () => new EntraSessionService(repository, { ...realm, ...change }),
    ).toThrow("ENTRA_SESSION_REALM");
  });
  it("never queries persistence for missing or malformed cookie tokens", async () => {
    const resolve = vi.fn();
    const sessions = new EntraSessionService(
      { create: vi.fn(), resolve, revoke: vi.fn(), revokeVerified: vi.fn() },
      realm,
    );
    for (const token of [
      undefined,
      "",
      "x",
      "x".repeat(10000),
      "../forged-token",
    ])
      expect(await sessions.verify(token)).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });
  it("fails closed on session-store failure without restoring a replaced cookie", async () => {
    const failing: EntraSessionRepository = {
      revokeVerified: vi.fn(async () => true),
      resolve: vi.fn(async () => {
        throw Error("database unavailable");
      }),
      revoke: vi.fn(async () => {}),
      create: vi.fn(async () => {
        throw Error("database unavailable");
      }),
    };
    const sessions = new EntraSessionService(failing, realm);
    await expect(sessions.verify("t".repeat(43))).rejects.toThrow(
      "database unavailable",
    );
    await expect(sessions.issue(identity("a"), "t".repeat(43))).rejects.toThrow(
      "database unavailable",
    );
    expect(failing.revoke).toHaveBeenCalledOnce();
  });
  it("revokes only the recovered identity's application-realm sessions before issuing fresh aal1", async () => {
    const a = await service.issue(identity("a")),
      other = await service.issue(identity("a")),
      b = await service.issue(identity("b"));
    const otherRealm = new EntraSessionService(repository, {
      ...realm,
      applicationOrigin: "https://other-recovery.example.test",
    });
    const foreign = await otherRealm.issue(identity("a"));
    const recovered = await service.issueRecovery(identity("a"), a.token);
    expect(await service.verify(a.token)).toBeNull();
    expect(await service.verify(other.token)).toBeNull();
    expect(await service.verify(recovered.token)).toEqual(identity("a"));
    expect(await service.verify(b.token)).toEqual(identity("b"));
    expect(await otherRealm.verify(foreign.token)).toEqual(identity("a"));
    const audit = JSON.stringify(
      (
        await db.engine.query(
          "select after_data from audit_logs where entity='application_sessions' and after_data->>'reason'='hosted_recovery_sign_in'",
        )
      ).rows,
    );
    expect(audit).toContain("hosted_recovery_sign_in");
    for (const value of [a.token, other.token, recovered.token, hash(a.token)])
      expect(audit).not.toContain(value);
  });
  it("does not restore globally revoked sessions when recovery minting fails", async () => {
    const a = await service.issue(identity("a")),
      other = await service.issue(identity("a"));
    const failing = new EntraSessionService(
      {
        resolve: repository.resolve.bind(repository),
        revoke: repository.revoke.bind(repository),
        revokeVerified: repository.revokeVerified.bind(repository),
        create: vi.fn(async () => {
          throw Error("synthetic mint failure");
        }),
      },
      realm,
    );
    await expect(failing.issueRecovery(identity("a"), a.token)).rejects.toThrow(
      "synthetic mint failure",
    );
    expect(await service.verify(a.token)).toBeNull();
    expect(await service.verify(other.token)).toBeNull();
  });
  it("refuses caller-elevated recovery and never mints after unconfirmed revocation", async () => {
    const create = vi.fn(),
      revokeVerified = vi.fn(async () => {
        throw Error("synthetic revocation failure");
      });
    const sessions = new EntraSessionService(
      { create, resolve: vi.fn(), revoke: vi.fn(), revokeVerified },
      realm,
    );
    await expect(
      sessions.issueRecovery({ ...identity("a"), assurance: "aal2" }),
    ).rejects.toMatchObject({ status: 401 });
    expect(revokeVerified).not.toHaveBeenCalled();
    await expect(sessions.issueRecovery(identity("a"))).rejects.toThrow(
      "synthetic revocation failure",
    );
    expect(create).not.toHaveBeenCalled();
  });
});
