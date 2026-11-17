import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { generate } from "otplib";
import { TestDatabase, ids } from "./fixtures/database";
import { EntraSessionService } from "@/server/modules/identity/entra-session-service";
import { EntraMfaService } from "@/server/modules/identity/entra-mfa-service";
import { PostgresEntraSessions } from "@/server/providers/postgres-entra-sessions";
import { PostgresEntraMfa } from "@/server/providers/postgres-entra-mfa";
import {
  MfaSecretProtector,
  MfaAuthenticator,
  MfaRecoveryCodes,
} from "@/server/providers/mfa-crypto";
import { AuthorizationService } from "@/server/modules/identity/authorization-service";
import { PostgresProfileRepository } from "@/server/providers/postgres-database";
import type { VerifiedIdentity } from "@/server/contracts";

const db = new TestDatabase();
const tenant = "40000000-0000-4000-8000-000000000004";
const sessions = new EntraSessionService(new PostgresEntraSessions(db), {
  tenantId: tenant,
  clientId: "50000000-0000-4000-8000-000000000005",
  issuer: `https://synthetic.ciamlogin.com/${tenant}/v2.0`,
  applicationOrigin: "https://app.example.test",
});
const repository = new PostgresEntraMfa(db);
const crypto = {
  protector: new MfaSecretProtector("test", {
    test: randomBytes(32).toString("base64url"),
  }),
  authenticator: new MfaAuthenticator("Synthetic"),
  recovery: new MfaRecoveryCodes(),
};
const service = new EntraMfaService(repository, crypto, sessions.realmHash);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const identity = (who: "admin" | "a"): VerifiedIdentity => ({
  provider: "entra",
  subject: `${tenant}:${ids[who]}`,
  assurance: "aal1",
});
beforeAll(async () => {
  await db.initialize();
  for (const who of ["admin", "a"] as const)
    await db.engine.query(
      "insert into provider_identities(profile_id,provider,subject) values($1,'entra',$2)",
      [ids[who], identity(who).subject],
    );
}, 20000);
beforeEach(async () => {
  await db.engine.exec(
    "delete from private.entra_sessions; delete from private.entra_mfa_factors; delete from private.entra_mfa_limits;",
  );
});
afterAll(() => db.close());
async function pending() {
  const session = await sessions.issue(identity("admin"));
  const setup = await service.prepare(session.token);
  if (setup.enrolled) throw Error("expected synthetic setup");
  const secret = new URL(setup.provisioningUri).searchParams.get("secret")!;
  return { session, setup, secret, code: await generate({ secret }) };
}
async function enrolled() {
  const state = await pending();
  const elevated = await service.verify(state.session.token, state.code);
  return { ...state, elevated };
}
async function begin(token: string, recovery = false) {
  const proofHash = randomBytes(32).toString("hex");
  const factor = await repository.begin(
    hash(token),
    sessions.realmHash,
    proofHash,
    recovery,
  );
  return { proofHash, factor };
}
const finish = (
  token: string,
  proofHash: string,
  step: number | null,
  codes: string[] | null = null,
  recoveryDigest: string | null = null,
) =>
  repository.finish({
    tokenHash: hash(token),
    realmHash: sessions.realmHash,
    proofHash,
    step,
    newTokenHash: randomBytes(32).toString("hex"),
    recoveryDigests: codes,
    recoveryDigest,
  });

describe("persistent Entra admin MFA", () => {
  it("enrolls, stores only encrypted seeds/digests, rotates and resolves actual aal2", async () => {
    const { session, setup, secret, code } = await pending();
    expect(await sessions.verify(session.token)).toMatchObject({
      assurance: "aal1",
    });
    const repeat = await service.prepare(session.token);
    expect(repeat).toEqual(setup);
    const elevated = await service.verify(session.token, code);
    expect(elevated.token).not.toBe(session.token);
    expect(elevated.expiresAt).toBe(session.expiresAt);
    expect(elevated.recoveryCodes).toHaveLength(10);
    expect(await sessions.verify(session.token)).toBeNull();
    expect(await sessions.verify(elevated.token)).toEqual({
      ...identity("admin"),
      assurance: "aal2",
    });
    const authorization = new AuthorizationService(
      {
        verify: () => sessions.verify(elevated.token),
        signIn: vi.fn(),
        signOut: vi.fn(),
        requestReset: vi.fn(),
        setPassword: vi.fn(),
      },
      new PostgresProfileRepository(db),
    );
    expect((await authorization.requireAdmin()).profile.id).toBe(ids.admin);
    const saved = (
      await db.engine.query("select * from private.entra_mfa_factors")
    ).rows;
    expect(JSON.stringify(saved)).not.toContain(secret);
    const recovery = (
      await db.engine.query("select * from private.entra_mfa_recovery")
    ).rows;
    expect(recovery).toHaveLength(10);
    for (const value of elevated.recoveryCodes!)
      expect(JSON.stringify(recovery)).not.toContain(value);
    const audits = JSON.stringify(
      (
        await db.engine.query(
          "select * from audit_logs where entity in ('mfa_factors','application_sessions')",
        )
      ).rows,
    );
    for (const value of [
      secret,
      session.token,
      elevated.token,
      ...elevated.recoveryCodes!,
    ])
      expect(audits).not.toContain(value);
    expect(await service.prepare(elevated.token)).toEqual({
      factorId: setup.factorId,
      enrolled: true,
    });
  });
  it("denies clients, unknown cookies, wrong realms and direct table/helper access", async () => {
    const client = await sessions.issue(identity("a"));
    await expect(service.prepare(client.token)).rejects.toMatchObject({
      code: "MFA_DENIED",
    });
    await expect(
      service.prepare(randomBytes(32).toString("base64url")),
    ).rejects.toMatchObject({ status: 403 });
    const { session } = await pending();
    const other = new EntraMfaService(repository, crypto, "b".repeat(64));
    await expect(other.prepare(session.token)).rejects.toMatchObject({
      status: 403,
    });
    for (const table of [
      "entra_mfa_factors",
      "entra_mfa_recovery",
      "entra_mfa_challenges",
      "entra_mfa_limits",
    ])
      await expect(
        db.withIdentity({ ...identity("admin"), assurance: "aal2" }, (sql) =>
          sql.query(`select * from private.${table}`),
        ),
      ).rejects.toThrow(/permission denied/);
    await expect(
      db.withIdentity(null, (sql) =>
        sql.query("select private.lock_entra_mfa_session($1,$2)", [
          hash(session.token),
          sessions.realmHash,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("requires recent primary authentication for seed disclosure and rejects expired pending enrollment", async () => {
    const { session } = await pending();
    await db.engine.query(
      "update private.entra_sessions set created_at=created_at-interval '11 minutes',expires_at=expires_at-interval '11 minutes' where token_hash=$1",
      [hash(session.token)],
    );
    await expect(service.prepare(session.token)).rejects.toMatchObject({
      code: "MFA_DENIED",
    });
    const fresh = await sessions.issue(identity("admin"));
    await db.engine.exec(
      "update private.entra_mfa_factors set created_at=created_at-interval '11 minutes'",
    );
    const challenge = await begin(fresh.token);
    expect(challenge.factor).toBeNull();
    const replacement = await service.prepare(fresh.token);
    expect(replacement.enrolled).toBe(false);
  });
  it("consumes challenges on invalid proofs, expiry and time-step replay", async () => {
    const { session, code } = await pending();
    const first = await begin(session.token);
    const codes = crypto.recovery
      .create({
        realmHash: sessions.realmHash,
        profileId: ids.admin,
        factorId: first.factor!.factorId,
      })
      .map((x) => x.digest);
    expect(await finish(session.token, first.proofHash, 0, codes)).toBeNull();
    expect(
      await finish(
        session.token,
        first.proofHash,
        Math.floor(Date.now() / 30000),
        codes,
      ),
    ).toBeNull();
    const expired = await begin(session.token);
    await db.engine.query(
      "update private.entra_mfa_challenges set expires_at=clock_timestamp()-interval '1 second' where proof_hash=$1",
      [expired.proofHash],
    );
    expect(
      await finish(
        session.token,
        expired.proofHash,
        Math.floor(Date.now() / 30000),
        codes,
      ),
    ).toBeNull();
    expect(
      (await db.engine.query("select * from private.entra_mfa_challenges"))
        .rows,
    ).toHaveLength(0);
    const result = await service.verify(session.token, code);
    await expect(service.verify(result.token, code)).rejects.toMatchObject({
      code: "MFA_DENIED",
    });
    expect(await sessions.verify(result.token)).toMatchObject({
      assurance: "aal2",
    });
  });
  it("binds each challenge to its session and replaces outstanding proofs", async () => {
    const { session } = await pending();
    const another = await sessions.issue(identity("admin"));
    const first = await begin(session.token),
      second = await begin(session.token);
    expect(await finish(another.token, second.proofHash, 0)).toBeNull();
    expect(await finish(session.token, first.proofHash, 0)).toBeNull();
    expect(
      (
        await db.engine.query(
          "select proof_hash from private.entra_mfa_challenges",
        )
      ).rows,
    ).toEqual([{ proof_hash: second.proofHash }]);
  });
  it("limits attempts durably across sessions and resets only after the window", async () => {
    const { session } = await pending();
    for (let i = 0; i < 9; i++)
      expect((await begin(session.token)).factor).not.toBeNull();
    expect((await begin(session.token)).factor).toBeNull();
    const another = await sessions.issue(identity("admin"));
    expect((await begin(another.token)).factor).toBeNull();
    await db.engine.exec(
      "update private.entra_mfa_limits set window_at=window_at-interval '16 minutes'",
    );
    expect((await begin(another.token)).factor).not.toBeNull();
  });
  it("consumes recovery codes once, rotates tokens and preserves original expiry", async () => {
    const { elevated } = await enrolled();
    const recovered = await service.verify(
      elevated.token,
      elevated.recoveryCodes![0].toLowerCase(),
      true,
    );
    expect(recovered.recoveryCodes).toBeNull();
    expect(recovered.expiresAt).toBe(elevated.expiresAt);
    expect(await sessions.verify(elevated.token)).toBeNull();
    expect(await sessions.verify(recovered.token)).toMatchObject({
      assurance: "aal2",
    });
    await expect(
      service.verify(recovered.token, elevated.recoveryCodes![0], true),
    ).rejects.toMatchObject({ code: "MFA_DENIED" });
    const unused = (
      await db.engine.query(
        "select * from private.entra_mfa_recovery where consumed_at is null",
      )
    ).rows;
    expect(unused).toHaveLength(9);
  });
  it("downgrades expired MFA without extending primary session lifetime", async () => {
    const { elevated } = await enrolled();
    await db.engine.query(
      "update private.entra_sessions set created_at=created_at-interval '16 minutes',expires_at=expires_at-interval '16 minutes',mfa_verified_at=mfa_verified_at-interval '16 minutes',mfa_expires_at=mfa_expires_at-interval '16 minutes' where token_hash=$1",
      [hash(elevated.token)],
    );
    expect(await sessions.verify(elevated.token)).toMatchObject({
      assurance: "aal1",
    });
  });
  it("invalidates factors, recovery and challenges on account/mapping changes", async () => {
    const { elevated } = await enrolled();
    await begin(elevated.token);
    await db.engine.query(
      "update provider_identities set subject=subject||'x' where provider='entra' and profile_id=$1",
      [ids.admin],
    );
    expect(await sessions.verify(elevated.token)).toBeNull();
    for (const table of [
      "entra_mfa_factors",
      "entra_mfa_recovery",
      "entra_mfa_challenges",
    ])
      expect(
        (await db.engine.query(`select * from private.${table}`)).rows,
      ).toHaveLength(0);
    await db.engine.query(
      "update provider_identities set subject=$1 where provider='entra' and profile_id=$2",
      [identity("admin").subject, ids.admin],
    );
    expect(await sessions.verify(elevated.token)).toBeNull();
  });
  it("cleans expired challenges, pending factors and old attempt windows without removing confirmed enrollment", async () => {
    const state = await pending();
    await begin(state.session.token);
    await db.engine.exec(
      "update private.entra_mfa_factors set created_at=created_at-interval '11 minutes'; update private.entra_mfa_limits set window_at=window_at-interval '25 hours'",
    );
    const cleaned = await db.withIdentity(null, (sql) =>
      sql.query<{ count: number }>("select private.cleanup_entra_mfa() count"),
    );
    expect(cleaned.rows[0].count).toBe(2);
    expect(
      (await db.engine.query("select * from private.entra_mfa_challenges"))
        .rows,
    ).toHaveLength(0);
    const current = await enrolled();
    await begin(current.elevated.token);
    await db.engine.exec(
      "update private.entra_mfa_challenges set expires_at=clock_timestamp()-interval '1 second'",
    );
    expect(
      (
        await db.withIdentity(null, (sql) =>
          sql.query<{ count: number }>(
            "select private.cleanup_entra_mfa() count",
          ),
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (
        await db.engine.query(
          "select * from private.entra_mfa_factors where confirmed_at is not null",
        )
      ).rows,
    ).toHaveLength(1);
    expect(await sessions.verify(current.elevated.token)).toMatchObject({
      assurance: "aal2",
    });
  });
  it("regenerates codes once and revokes old realm sessions without extending expiry", async () => {
    const { elevated, setup } = await enrolled();
    const parallel = await sessions.issue(identity("admin"));
    const replacement = await service.regenerate(
      elevated.token,
      elevated.recoveryCodes![0],
      true,
    );
    expect(replacement.recoveryCodes).toHaveLength(10);
    expect(replacement.expiresAt).toBe(elevated.expiresAt);
    expect(replacement.token).not.toBe(elevated.token);
    expect(await sessions.verify(elevated.token)).toBeNull();
    expect(await sessions.verify(parallel.token)).toBeNull();
    expect(await sessions.verify(replacement.token)).toMatchObject({
      assurance: "aal2",
    });
    const saved = (
      await db.engine.query<{ digest: string }>(
        "select digest from private.entra_mfa_recovery where factor_id=$1",
        [setup.factorId],
      )
    ).rows;
    expect(saved).toHaveLength(10);
    for (const code of elevated.recoveryCodes!) {
      expect(saved.map((x) => x.digest)).not.toContain(
        crypto.recovery.digest(code, {
          realmHash: sessions.realmHash,
          profileId: ids.admin,
          factorId: setup.factorId,
        }),
      );
    }
    await expect(
      service.verify(replacement.token, elevated.recoveryCodes![1], true),
    ).rejects.toMatchObject({ code: "MFA_DENIED" });
    const next = await service.verify(
      replacement.token,
      replacement.recoveryCodes[0],
      true,
    );
    expect(await sessions.verify(next.token)).toMatchObject({
      assurance: "aal2",
    });
    const audits = JSON.stringify(
      (
        await db.engine.query(
          "select after_data from audit_logs where entity='mfa_factors' and entity_id=$1",
          [setup.factorId],
        )
      ).rows,
    );
    expect(audits).toContain("recovery_regenerated");
    for (const value of [...replacement.recoveryCodes, replacement.token])
      expect(audits).not.toContain(value);
  });
  it("recovers a lost enrollment response using a new authenticator counter", async () => {
    const { elevated, secret } = await enrolled();
    // The enrollment recovery-code response is deliberately unused.
    const last = Number(
      (
        await db.engine.query<{ last_step: string | number }>(
          "select last_step from private.entra_mfa_factors",
        )
      ).rows[0].last_step,
    );
    const code = await generate({ secret, epoch: (last + 1) * 30 });
    const current = await sessions.issue(identity("admin"));
    const result = await service.regenerate(current.token, code);
    expect(result.recoveryCodes).toHaveLength(10);
    expect(await sessions.verify(elevated.token)).toBeNull();
    await expect(service.regenerate(result.token, code)).rejects.toMatchObject({
      code: "MFA_DENIED",
    });
  });
  it("removes a factor with a fresh proof, revokes all own-realm sessions and requires reenrollment", async () => {
    const { elevated } = await enrolled();
    const parallel = await sessions.issue(identity("admin"));
    const otherRealm = new EntraSessionService(new PostgresEntraSessions(db), {
      tenantId: tenant,
      clientId: "50000000-0000-4000-8000-000000000005",
      issuer: `https://synthetic.ciamlogin.com/${tenant}/v2.0`,
      applicationOrigin: "https://other.example.test",
    });
    const other = await otherRealm.issue(identity("admin"));
    expect(
      await service.remove(elevated.token, elevated.recoveryCodes![0], true),
    ).toEqual({ removed: true });
    for (const token of [elevated.token, parallel.token])
      expect(await sessions.verify(token)).toBeNull();
    expect(await otherRealm.verify(other.token)).toMatchObject({
      assurance: "aal1",
    });
    for (const table of [
      "entra_mfa_factors",
      "entra_mfa_recovery",
      "entra_mfa_challenges",
    ])
      expect(
        (await db.engine.query(`select * from private.${table}`)).rows,
      ).toHaveLength(0);
    await expect(
      service.remove(elevated.token, elevated.recoveryCodes![1], true),
    ).rejects.toMatchObject({ code: "MFA_DENIED" });
    const fresh = await sessions.issue(identity("admin"));
    expect(await sessions.verify(fresh.token)).toMatchObject({
      assurance: "aal1",
    });
    expect((await service.prepare(fresh.token)).enrolled).toBe(false);
  });
  it("requires recent primary auth, confirmed enrollment and code proof for lifecycle changes", async () => {
    const pendingState = await pending();
    await expect(
      service.regenerate(pendingState.session.token, pendingState.code),
    ).rejects.toMatchObject({ code: "MFA_DENIED" });
    const elevated = await service.verify(
      pendingState.session.token,
      pendingState.code,
    );
    await db.engine.query(
      "update private.entra_sessions set created_at=created_at-interval '11 minutes',expires_at=expires_at-interval '11 minutes' where token_hash=$1",
      [hash(elevated.token)],
    );
    for (const action of ["regenerate", "remove"] as const) {
      await expect(
        service[action](elevated.token, elevated.recoveryCodes![0], true),
      ).rejects.toMatchObject({ code: "MFA_DENIED" });
      await expect(
        service[action](elevated.token, "bad", true),
      ).rejects.toMatchObject({ code: "MFA_DENIED" });
    }
    expect(await sessions.verify(elevated.token)).toMatchObject({
      assurance: "aal2",
    });
    const client = await sessions.issue(identity("a"));
    await expect(
      service.remove(client.token, elevated.recoveryCodes![0], true),
    ).rejects.toMatchObject({ code: "MFA_DENIED" });
    expect(
      (
        await db.engine.query(
          "select * from private.entra_mfa_recovery where consumed_at is not null",
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("binds lifecycle proofs to their operation and prevents step-up substitution", async () => {
    const { elevated, setup } = await enrolled();
    const digest = crypto.recovery.digest(elevated.recoveryCodes![0], {
      realmHash: sessions.realmHash,
      profileId: ids.admin,
      factorId: setup.factorId,
    });
    const actionProof = async () => {
      const proof = randomBytes(32).toString("hex");
      expect(
        await repository.beginAction(
          hash(elevated.token),
          sessions.realmHash,
          proof,
          true,
          "regenerate",
        ),
      ).not.toBeNull();
      return proof;
    };
    const first = await actionProof();
    expect(
      await repository.finishAction({
        tokenHash: hash(elevated.token),
        realmHash: sessions.realmHash,
        proofHash: first,
        operation: "remove",
        step: null,
        recoveryDigest: digest,
        newTokenHash: null,
        recoveryDigests: null,
      }),
    ).toBeNull();
    const second = await actionProof();
    expect(await finish(elevated.token, second, null, null, digest)).toBeNull();
    const third = await begin(elevated.token, true);
    expect(
      await repository.finishAction({
        tokenHash: hash(elevated.token),
        realmHash: sessions.realmHash,
        proofHash: third.proofHash,
        operation: "remove",
        step: null,
        recoveryDigest: digest,
        newTokenHash: null,
        recoveryDigests: null,
      }),
    ).toBeNull();
    expect(
      (await db.engine.query("select * from private.entra_mfa_challenges"))
        .rows,
    ).toHaveLength(0);
    expect(
      (
        await db.engine.query(
          "select * from private.entra_mfa_recovery where consumed_at is not null",
        )
      ).rows,
    ).toHaveLength(0);
    expect(await sessions.verify(elevated.token)).toMatchObject({
      assurance: "aal2",
    });
  });
  it("consumes denied lifecycle challenges without changing recovery data or sessions", async () => {
    const { elevated, setup } = await enrolled();
    const proof = randomBytes(32).toString("hex");
    await repository.beginAction(
      hash(elevated.token),
      sessions.realmHash,
      proof,
      true,
      "regenerate",
    );
    const digest = crypto.recovery.digest(elevated.recoveryCodes![0], {
      realmHash: sessions.realmHash,
      profileId: ids.admin,
      factorId: setup.factorId,
    });
    expect(
      await repository.finishAction({
        tokenHash: hash(elevated.token),
        realmHash: sessions.realmHash,
        proofHash: proof,
        operation: "regenerate",
        step: null,
        recoveryDigest: digest,
        newTokenHash: randomBytes(32).toString("hex"),
        recoveryDigests: Array(10).fill(digest),
      }),
    ).toBeNull();
    expect(
      (await db.engine.query("select * from private.entra_mfa_challenges"))
        .rows,
    ).toHaveLength(0);
    expect(
      (
        await db.engine.query(
          "select * from private.entra_mfa_recovery where consumed_at is not null",
        )
      ).rows,
    ).toHaveLength(0);
    expect(await sessions.verify(elevated.token)).toMatchObject({
      assurance: "aal2",
    });
  });
});
