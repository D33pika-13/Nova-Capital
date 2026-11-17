import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { generate } from "otplib";
import {
  EntraRuntimeFactory,
  type EntraRuntimeOptions,
} from "@/server/providers/entra-runtime-factory";
import { entraCookieNames as names } from "@/server/providers/entra-cookies";
import type { Database } from "@/server/database";
import type { TokenCredential } from "@azure/identity";
import type { EmailProvider } from "@/server/contracts";
import type { EntraDirectoryCredentialBuilder } from "@/server/providers/entra-directory-credential";
import { InvitationService } from "@/server/modules/clients/invitation-service";
import { ClientService } from "@/server/modules/clients/client-service";
import { PostgresClientRepository } from "@/server/providers/postgres-clients";
import { PostgresInvitationRepository } from "@/server/providers/postgres-invitations";
import { PostgresRateLimiter } from "@/server/providers/postgres-database";
import { ConfigurationError } from "@/server/errors";
import { TestDatabase, ids } from "./fixtures/database";
const db = new TestDatabase();
const tenant = "40000000-0000-4000-8000-000000000004",
  client = "50000000-0000-4000-8000-000000000005";
const origin = "https://app.example.test",
  authority = "https://synthetic.ciamlogin.com",
  issuer = `${authority}/${tenant}/v2.0`;
let pair: Awaited<ReturnType<typeof generateKeyPair>>;
let jwk: Awaited<ReturnType<typeof exportJWK>>;
beforeAll(async () => {
  await db.initialize();
  pair = await generateKeyPair("RS256");
  jwk = {
    ...(await exportJWK(pair.publicKey)),
    kid: "synthetic",
    alg: "RS256",
    use: "sig",
  };
  for (const who of ["a", "b", "admin"] as const)
    await db.engine.query(
      "insert into provider_identities(profile_id,provider,subject) values($1,'entra',$2)",
      [ids[who], `${tenant}:${ids[who]}`],
    );
}, 20000);
beforeEach(() =>
  db.engine.exec(
    "delete from private.entra_sessions;delete from private.entra_mfa_factors;delete from private.entra_mfa_limits;delete from private.entra_login_transactions;delete from private.rate_limits;",
  ),
);
afterAll(() => db.close());
function options(): EntraRuntimeOptions {
  return {
    tenantId: tenant,
    clientId: client,
    tenantSubdomain: "synthetic",
    applicationOrigin: origin,
    clientSecret: "synthetic-client-secret-not-real",
    mfaIssuer: "Synthetic",
    mfaActiveKeyId: "current",
    mfaEncryptionKeys: { current: randomBytes(32).toString("base64url") },
  };
}
function req(path = "/portal", cookie = "", body?: unknown) {
  return new Request(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: origin,
      Cookie: cookie,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function setup(
  settings = options(),
  directoryRequest?: typeof fetch,
  buildDirectoryCredential?: EntraDirectoryCredentialBuilder,
) {
  const pending = new Map<
    string,
    { nonce: string; challenge: string; oid: string }
  >();
  const request = vi.fn<typeof fetch>(async (url, init) => {
    const value = String(url);
    if (value.startsWith("https://graph.microsoft.com/") && directoryRequest)
      return directoryRequest(url, init);
    if (value === `${issuer}/.well-known/openid-configuration`)
      return Response.json({
        issuer,
        authorization_endpoint: `${authority}/${tenant}/oauth2/v2.0/authorize`,
        token_endpoint: `${authority}/${tenant}/oauth2/v2.0/token`,
        jwks_uri: `${authority}/${tenant}/discovery/v2.0/keys`,
        end_session_endpoint: `${authority}/${tenant}/oauth2/v2.0/logout`,
        response_types_supported: ["code"],
        response_modes_supported: ["query"],
        id_token_signing_alg_values_supported: ["RS256"],
        subject_types_supported: ["pairwise"],
        scopes_supported: ["openid", "profile"],
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      });
    if (value === `${authority}/${tenant}/discovery/v2.0/keys`)
      return Response.json({ keys: [jwk] });
    if (value === `${authority}/${tenant}/oauth2/v2.0/token`) {
      const data = new URLSearchParams(String(init?.body)),
        entry = pending.get(data.get("code")!);
      if (!entry) throw Error("unknown synthetic code");
      pending.delete(data.get("code")!);
      expect(data.get("client_secret")).toBe(settings.clientSecret);
      expect(data.get("redirect_uri")).toBe(`${origin}/auth/entra/callback`);
      expect(
        createHash("sha256")
          .update(data.get("code_verifier")!)
          .digest("base64url"),
      ).toBe(entry.challenge);
      const now = Math.floor(Date.now() / 1000);
      return Response.json({
        token_type: "Bearer",
        access_token: "synthetic-access-token",
        id_token: await new SignJWT({
          iss: issuer,
          aud: client,
          sub: `synthetic-${entry.oid}`,
          oid: entry.oid,
          tid: tenant,
          ver: "2.0",
          nonce: entry.nonce,
          iat: now,
          nbf: now - 30,
          exp: now + 3600,
        })
          .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: "synthetic" })
          .sign(pair.privateKey),
      });
    }
    throw Error("unapproved transport");
  });
  const telemetry = { event: vi.fn() };
  const factory = new EntraRuntimeFactory(
    settings,
    db,
    telemetry,
    request,
    buildDirectoryCredential,
  );
  async function login(
    who: "a" | "b" | "admin" | "unknown" | { objectId: string },
    purpose: "login" | "recovery" = "login",
  ) {
    const current = factory.create(req());
    const startRequest = new Request(
      `${origin}/auth/entra/${purpose === "recovery" ? "recover" : "start"}`,
      { method: "POST", headers: { Origin: origin } },
    );
    const start =
      purpose === "recovery"
        ? await current.authHttp.recover(startRequest)
        : await current.authHttp.start(startRequest);
    expect(start.status).toBe(303);
    const query = new URL(start.headers.get("location")!).searchParams;
    const code = randomBytes(16).toString("hex");
    pending.set(code, {
      nonce: query.get("nonce")!,
      challenge: query.get("code_challenge")!,
      oid:
        typeof who === "object"
          ? who.objectId
          : who === "unknown"
            ? "90000000-0000-4000-8000-000000000009"
            : ids[who],
    });
    const binding = `${names.binding}=${start.cookies.get(names.binding)!.value}`;
    const response = await factory
      .create(req())
      .authHttp.callback(
        req(
          `/auth/entra/callback?${new URLSearchParams({ code, state: query.get("state")! })}`,
          binding,
        ),
      );
    const token = response.cookies.get(names.session)?.value;
    return {
      response,
      authorizationUrl: start.headers.get("location")!,
      cookie: token ? `${binding}; ${names.session}=${token}` : binding,
      token,
    };
  }
  return { factory, request, telemetry, login };
}

describe("Entra dependency composition and request identity", () => {
  it("composes independent client scopes and shares discovery without storing request identity", async () => {
    const state = setup(),
      a = await state.login("a"),
      b = await state.login("b");
    const aRequest = req("/portal", a.cookie),
      scopeA = state.factory.create(aRequest),
      scopeB = state.factory.create(req("/portal", b.cookie));
    aRequest.headers.set("cookie", b.cookie);
    expect((await scopeA.auth.requireUser()).profile.id).toBe(ids.a);
    expect((await scopeB.auth.requireUser()).profile.id).toBe(ids.b);
    expect(await state.factory.create(req()).identity.verify()).toBeNull();
    expect(await scopeA.identity.verify()).toMatchObject({
      subject: `${tenant}:${ids.a}`,
      assurance: "aal1",
    });
    expect(scopeA.identity).not.toBe(scopeB.identity);
    expect(scopeA.auth).not.toBe(scopeB.auth);
    expect(scopeA.authHttp).toBe(scopeB.authHttp);
    expect(scopeA.mfaHttp).toBe(scopeB.mfaHttp);
    expect(
      state.request.mock.calls.filter(([url]) =>
        String(url).includes(".well-known"),
      ),
    ).toHaveLength(1);
    expect(Object.isFrozen(scopeA)).toBe(true);
    expect(Object.isFrozen(scopeA.capabilities)).toBe(true);
  });
  it("composes admin primary login, MFA, authorized access, regeneration, removal and reenrollment", async () => {
    const state = setup(),
      admin = await state.login("admin");
    expect(admin.response.headers.get("location")).toBe(`${origin}/mfa`);
    await expect(
      state.factory.create(req("/admin", admin.cookie)).auth.requireAdmin(),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    const send = (cookie: string, body: unknown) =>
      state.factory
        .create(req("/api/auth/mfa", cookie, body))
        .mfaHttp.execute(req("/api/auth/mfa", cookie, body));
    const prepared = await send(admin.cookie, { action: "setup" });
    expect(prepared.status).toBe(200);
    const factor = await prepared.json(),
      secret = new URL(factor.provisioningUri).searchParams.get("secret")!;
    const verified = await send(admin.cookie, {
      action: "verify",
      code: await generate({ secret }),
    });
    expect(verified.status).toBe(200);
    const initialCodes = (await verified.json()).recoveryCodes as string[];
    const cookie = `${names.session}=${verified.cookies.get(names.session)!.value}`;
    expect(
      (await state.factory.create(req("/admin", cookie)).auth.requireAdmin())
        .profile.id,
    ).toBe(ids.admin);
    expect(
      await state.factory.create(req("/admin", admin.cookie)).identity.verify(),
    ).toBeNull();
    const regenerated = await send(cookie, {
      action: "regenerate",
      method: "recovery",
      code: initialCodes[0],
    });
    expect(regenerated.status).toBe(200);
    const replacementCodes = (await regenerated.json())
      .recoveryCodes as string[];
    const replacement = `${names.session}=${regenerated.cookies.get(names.session)!.value}`;
    const removed = await send(replacement, {
      action: "remove",
      method: "recovery",
      code: replacementCodes[0],
    });
    expect(removed.status).toBe(200);
    expect(
      await state.factory.create(req("/admin", replacement)).identity.verify(),
    ).toBeNull();
    const fresh = await state.login("admin");
    expect(
      (await (await send(fresh.cookie, { action: "setup" })).json()).enrolled,
    ).toBe(false);
    const telemetry = JSON.stringify(state.telemetry.event.mock.calls);
    for (const value of [
      secret,
      admin.token!,
      ...initialCodes,
      ...replacementCodes,
    ])
      expect(telemetry).not.toContain(value);
  });
  it("rechecks current status instead of caching request identity", async () => {
    const state = setup(),
      a = await state.login("a"),
      scope = state.factory.create(req("/portal", a.cookie));
    expect(await scope.identity.verify()).not.toBeNull();
    await db.engine.query(
      "update profiles set status='suspended' where id=$1",
      [ids.a],
    );
    expect(await scope.identity.verify()).toBeNull();
    await db.engine.query("update profiles set status='active' where id=$1", [
      ids.a,
    ]);
    expect(await scope.identity.verify()).toBeNull();
  });
  it("uses the HTTP logout boundary and refuses headless/password/lifecycle calls without side effects", async () => {
    const state = setup(),
      a = await state.login("a"),
      scope = state.factory.create(req("/portal", a.cookie)),
      count = state.request.mock.calls.length;
    await expect(
      scope.identity.signIn("synthetic@example.invalid", "private-password"),
    ).rejects.toMatchObject({ code: "BROWSER_SIGN_IN_REQUIRED" });
    await expect(scope.identity.signOut()).rejects.toMatchObject({
      code: "BROWSER_SIGN_OUT_REQUIRED",
    });
    await expect(
      scope.identity.requestReset("synthetic@example.invalid"),
    ).rejects.toMatchObject({ code: "ACCOUNT_LIFECYCLE_UNAVAILABLE" });
    await expect(
      scope.identity.setPassword("private-password"),
    ).rejects.toMatchObject({ code: "ACCOUNT_LIFECYCLE_UNAVAILABLE" });
    expect(state.request).toHaveBeenCalledTimes(count);
    expect(await scope.identity.verify()).not.toBeNull();
    const logout = await scope.authHttp.logout(
      new Request(`${origin}/api/auth/logout`, {
        method: "POST",
        headers: { Origin: origin, Cookie: a.cookie },
      }),
    );
    expect(logout.status).toBe(200);
    expect(logout.cookies.get(names.session)?.maxAge).toBe(0);
    expect(await scope.identity.verify()).toBeNull();
    expect(scope.capabilities).toEqual({
      browserSignIn: true,
      applicationLogout: true,
      passwordSignIn: false,
      accountLifecycle: false,
      accountInvitations: false,
      remoteLogout: false,
      providerLogoutInitiation: true,
    });
  });
  it("rejects unknown mappings and ambiguous cookies without a fallback identity", async () => {
    const state = setup(),
      unknown = await state.login("unknown");
    expect(unknown.token).toBeUndefined();
    expect(unknown.response.headers.get("location")).toBe(
      `${origin}/login?error=link`,
    );
    const a = await state.login("a");
    expect(
      await state.factory
        .create(req("/portal", `${a.cookie}; ${names.session}=${a.token}`))
        .identity.verify(),
    ).toBeNull();
    expect(
      await state.factory
        .create(req("/portal", "sb-synthetic-auth-token=ignored"))
        .identity.verify(),
    ).toBeNull();
  });
  it.each([
    { applicationOrigin: "http://app.example.test" },
    { applicationOrigin: `${origin}/` },
    { clientSecret: "short" },
    { mfaIssuer: undefined },
    { mfaIssuer: "bad\nissuer" },
    { mfaEncryptionKeys: {} },
    { mfaActiveKeyId: "unknown" },
    { discoveryTimeoutMs: 10001 },
    { exchangeTimeoutMs: 20001 },
  ])("rejects invalid composition settings %# without I/O", (invalid) => {
    const request = vi.fn<typeof fetch>();
    expect(
      () =>
        new EntraRuntimeFactory(
          { ...options(), ...invalid } as EntraRuntimeOptions,
          db,
          { event: vi.fn() },
          request,
        ),
    ).toThrow(ConfigurationError);
    expect(request).not.toHaveBeenCalled();
  });
  it("copies key configuration and never falls back to a different keyring", async () => {
    const settings = options(),
      state = setup(settings),
      admin = await state.login("admin");
    const first = state.factory.create(req()).mfaHttp;
    const prepared = await first.execute(
      req("/api/auth/mfa", admin.cookie, { action: "setup" }),
    );
    expect(prepared.status).toBe(200);
    const initial = await prepared.json();
    (settings.mfaEncryptionKeys as Record<string, string>).current =
      randomBytes(32).toString("base64url");
    settings.applicationOrigin = "https://changed.example.test";
    const again = await first.execute(
      req("/api/auth/mfa", admin.cookie, { action: "setup" }),
    );
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(initial);
    const other = setup({ ...settings, applicationOrigin: origin });
    const denied = await other.factory
      .create(req())
      .mfaHttp.execute(req("/api/auth/mfa", admin.cookie, { action: "setup" }));
    expect(denied.status).toBe(503);
    expect(await denied.text()).not.toContain(
      new URL(initial.provisioningUri).searchParams.get("secret")!,
    );
  });
  it("propagates database failure instead of returning anonymous/fallback identity and keeps HTTP errors private", async () => {
    const failure = vi.fn(async () => {
      throw Error("private synthetic database failure");
    });
    const database: Database = { withIdentity: failure };
    const factory = new EntraRuntimeFactory(
      options(),
      database,
      { event: vi.fn() },
      vi.fn(),
    );
    const cookie = `${names.session}=${"p".repeat(43)}`;
    const scope = factory.create(req("/portal", cookie));
    await expect(scope.identity.verify()).rejects.toThrow(
      "private synthetic database failure",
    );
    await expect(scope.auth.requireUser()).rejects.toThrow(
      "private synthetic database failure",
    );
    const response = await scope.mfaHttp.execute(
      req("/api/auth/mfa", cookie, { action: "setup" }),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private synthetic");
    const before = failure.mock.calls.length;
    expect(
      await factory
        .create(req("/portal", `${cookie}; ${cookie}`))
        .identity.verify(),
    ).toBeNull();
    expect(failure).toHaveBeenCalledTimes(before);
  });
  it("does not enable account invitations without explicit directory settings", () => {
    const state = setup(),
      scope = state.factory.create(req());
    expect(scope.accounts).toBeNull();
    expect(scope.capabilities.accountInvitations).toBe(false);
    expect(
      () =>
        new EntraRuntimeFactory(
          options(),
          db,
          { event: vi.fn() },
          vi.fn(),
          () => ({ getToken: vi.fn() }),
        ),
    ).toThrow(ConfigurationError);
    expect(state.request).not.toHaveBeenCalled();
  });
  it.each([
    null,
    {
      clientId: "bad",
      clientSecret: "synthetic-directory-secret",
      recoveryMode: "hosted_sspr",
    },
    { clientId: client, clientSecret: "short", recoveryMode: "hosted_sspr" },
    {
      clientId: client,
      clientSecret: "synthetic-directory-secret",
      recoveryMode: "unsupported",
    },
    {
      clientId: client,
      clientSecret: "synthetic-directory-secret",
      recoveryMode: "hosted_sspr",
      timeoutMs: 0,
    },
    {
      clientId: client,
      clientSecret: "synthetic-directory-secret",
      recoveryMode: "hosted_sspr",
      timeoutMs: 20001,
    },
  ])(
    "rejects incomplete or unsupported directory composition %# without token/Graph requests",
    (directory) => {
      const getToken = vi.fn(),
        request = vi.fn(),
        build: EntraDirectoryCredentialBuilder = () => ({ getToken });
      expect(
        () =>
          new EntraRuntimeFactory(
            { ...options(), directory } as EntraRuntimeOptions,
            db,
            { event: vi.fn() },
            request,
            build,
          ),
      ).toThrow(ConfigurationError);
      expect(getToken).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    },
  );
  it("constructs the actual SDK credential without acquiring tokens when explicitly configured", () => {
    const settings = {
        ...options(),
        directory: {
          clientId: "60000000-0000-4000-8000-000000000006",
          clientSecret: "synthetic-directory-secret",
          recoveryMode: "hosted_sspr" as const,
        },
      },
      request = vi.fn();
    const factory = new EntraRuntimeFactory(
        settings,
        db,
        { event: vi.fn() },
        request,
      ),
      scope = factory.create(req());
    expect(scope.accounts).not.toBeNull();
    expect(scope.capabilities.accountInvitations).toBe(true);
    expect(scope.capabilities.accountLifecycle).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
  it("composes real admin MFA, durable customer provisioning/invitation, client login and hosted reset", async () => {
    const directoryClient = "60000000-0000-4000-8000-000000000006",
      directorySecret = "synthetic-directory-secret-not-a-login-secret";
    const settings = {
      ...options(),
      directory: {
        clientId: directoryClient,
        clientSecret: directorySecret,
        recoveryMode: "hosted_sspr" as const,
      },
    };
    let remote: {
      id: string;
      accountEnabled: boolean;
      userType: string;
      identities: {
        signInType: string;
        issuer: string;
        issuerAssignedId: string;
      }[];
    } | null = null;
    const graph = vi.fn<typeof fetch>(async (url, init) => {
      expect(new URL(String(url)).origin).toBe("https://graph.microsoft.com");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer synthetic-directory-token",
      );
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        remote = {
          id: randomUUID(),
          accountEnabled: true,
          userType: "Member",
          identities: body.identities,
        };
        expect(body.passwordProfile.password).not.toBe(directorySecret);
        expect(body.passwordProfile.password).not.toBe(settings.clientSecret);
        return Response.json({ id: remote.id }, { status: 201 });
      }
      return Response.json(
        new URL(String(url)).pathname === "/v1.0/users"
          ? { value: remote ? [remote] : [] }
          : remote,
      );
    });
    const getToken = vi.fn<TokenCredential["getToken"]>(async () => ({
        token: "synthetic-directory-token",
        expiresOnTimestamp: Date.now() + 60000,
      })),
      build = vi.fn<EntraDirectoryCredentialBuilder>(() => ({ getToken }));
    const state = setup(settings, graph, build),
      admin = await state.login("admin");
    const mfa = state.factory.create(req()).mfaHttp;
    const prepared = await mfa.execute(
      req("/api/auth/mfa", admin.cookie, { action: "setup" }),
    );
    const factor = await prepared.json();
    const secret = new URL(factor.provisioningUri).searchParams.get("secret")!;
    const verified = await mfa.execute(
      req("/api/auth/mfa", admin.cookie, {
        action: "verify",
        code: await generate({ secret }),
      }),
    );
    expect(verified.status).toBe(200);
    const cookie = `${names.session}=${verified.cookies.get(names.session)!.value}`;
    const scope = state.factory.create(req("/admin", cookie));
    expect(scope.capabilities.accountInvitations).toBe(true);
    expect(Object.isFrozen(scope.capabilities)).toBe(true);
    const clients = new ClientService(
      scope.auth,
      new PostgresClientRepository(db),
    );
    const profile = await clients.create({
      requestId: randomUUID(),
      displayName: "Synthetic Runtime Customer",
      email: `runtime-${randomUUID()}@example.test`,
    });
    const email = { send: vi.fn<EmailProvider["send"]>(async () => {}) };
    const invitations = new InvitationService(
      scope.auth,
      new PostgresInvitationRepository(db),
      scope.accounts!,
      email,
      new PostgresRateLimiter(db),
      "Synthetic Example Firm",
    );
    const input = { requestId: randomUUID(), purpose: "setup" };
    expect((await invitations.send(profile.id, input)).status).toBe("accepted");
    expect((await invitations.send(profile.id, input)).status).toBe("accepted");
    expect(
      graph.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(email.send.mock.calls[0][0].text).toContain("Forgot password?");
    expect(email.send.mock.calls[0][0].text).not.toContain("single-use");
    const object = (
      await db.engine.query<{ subject: string }>(
        "select subject from provider_identities where profile_id=$1 and provider='entra'",
        [profile.id],
      )
    ).rows[0].subject.slice(37);
    const customer = await state.login({ objectId: object }),
      clientScope = state.factory.create(req("/portal", customer.cookie));
    expect(customer.response.headers.get("location")).toBe(`${origin}/portal`);
    expect((await clientScope.auth.requireUser()).profile.id).toBe(profile.id);
    await expect(clientScope.auth.requireAdmin()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect((await scope.auth.requireAdmin()).profile.id).toBe(ids.admin);
    expect(
      (
        await invitations.send(profile.id, {
          requestId: randomUUID(),
          purpose: "reset",
        })
      ).status,
    ).toBe("accepted");
    expect(
      graph.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
    expect(email.send).toHaveBeenCalledTimes(2);
    expect(build).toHaveBeenCalledTimes(1);
    expect(build.mock.calls[0].slice(0, 3)).toEqual([
      tenant,
      directoryClient,
      directorySecret,
    ]);
    expect(
      getToken.mock.calls.every(
        (args) => args[0] === "https://graph.microsoft.com/.default",
      ),
    ).toBe(true);
    expect(state.factory.create(req()).accounts).toBe(scope.accounts);
    const count = graph.mock.calls.length;
    const clientInvitations = new InvitationService(
      clientScope.auth,
      new PostgresInvitationRepository(db),
      clientScope.accounts!,
      email,
      new PostgresRateLimiter(db),
      "Synthetic Example Firm",
    );
    await expect(
      clientInvitations.send(profile.id, {
        requestId: randomUUID(),
        purpose: "reset",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(graph).toHaveBeenCalledTimes(count);
  });
  it("composes recovery purpose, fresh sign-in and all-prior-session revocation for only the verified client", async () => {
    const state = setup(),
      a = await state.login("a"),
      other = await state.login("a"),
      b = await state.login("b");
    const oldA = state.factory.create(req("/portal", a.cookie)),
      oldOther = state.factory.create(req("/portal", other.cookie)),
      oldB = state.factory.create(req("/portal", b.cookie));
    const recovered = await state.login("a", "recovery");
    expect(new URL(recovered.authorizationUrl).searchParams.get("prompt")).toBe(
      "login",
    );
    expect(recovered.response.headers.get("location")).toBe(`${origin}/portal`);
    expect(await oldA.identity.verify()).toBeNull();
    expect(await oldOther.identity.verify()).toBeNull();
    expect((await oldB.auth.requireUser()).profile.id).toBe(ids.b);
    expect(
      await state.factory
        .create(req("/portal", recovered.cookie))
        .identity.verify(),
    ).toMatchObject({ subject: `${tenant}:${ids.a}`, assurance: "aal1" });
    const audit = JSON.stringify(
      (
        await db.engine.query(
          "select after_data from audit_logs where after_data->>'reason'='hosted_recovery_sign_in'",
        )
      ).rows,
    );
    expect(audit).toContain("hosted_recovery_sign_in");
    expect(audit).not.toContain(a.token!);
    expect(audit).not.toContain("password_changed");
  });
  it("revokes elevated admin sessions on recovery while preserving the enrolled factor and requiring MFA again", async () => {
    const state = setup(),
      admin = await state.login("admin"),
      mfa = state.factory.create(req()).mfaHttp;
    const prepared = await (
      await mfa.execute(req("/api/auth/mfa", admin.cookie, { action: "setup" }))
    ).json();
    const secret = new URL(prepared.provisioningUri).searchParams.get(
      "secret",
    )!;
    const verified = await mfa.execute(
      req("/api/auth/mfa", admin.cookie, {
        action: "verify",
        code: await generate({ secret }),
      }),
    );
    const recoveryCodes = (await verified.json()).recoveryCodes as string[];
    const elevated = `${names.session}=${verified.cookies.get(names.session)!.value}`,
      old = state.factory.create(req("/admin", elevated));
    expect((await old.auth.requireAdmin()).profile.id).toBe(ids.admin);
    const recovered = await state.login("admin", "recovery");
    expect(recovered.response.headers.get("location")).toBe(`${origin}/mfa`);
    expect(await old.identity.verify()).toBeNull();
    await expect(
      state.factory.create(req("/admin", recovered.cookie)).auth.requireAdmin(),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    const stillEnrolled = await (
      await mfa.execute(
        req("/api/auth/mfa", recovered.cookie, { action: "setup" }),
      )
    ).json();
    expect(stillEnrolled).toEqual({
      factorId: prepared.factorId,
      enrolled: true,
    });
    const stepped = await mfa.execute(
      req("/api/auth/mfa", recovered.cookie, {
        action: "recover",
        code: recoveryCodes[0],
      }),
    );
    expect(stepped.status).toBe(200);
    const fresh = `${names.session}=${stepped.cookies.get(names.session)!.value}`;
    expect(
      (await state.factory.create(req("/admin", fresh)).auth.requireAdmin())
        .profile.id,
    ).toBe(ids.admin);
  });
  it("revokes application sessions before requesting provider browser sign-out without leaking credentials", async () => {
    const state = setup(),
      a = await state.login("a"),
      other = await state.login("a"),
      scope = state.factory.create(req("/portal", a.cookie));
    const count = state.request.mock.calls.length;
    const response = await scope.authHttp.logoutBrowser(
      new Request(`${origin}/auth/entra/logout`, {
        method: "POST",
        headers: { Origin: origin, Cookie: a.cookie },
      }),
    );
    expect(response.status).toBe(303);
    const destination = new URL(response.headers.get("location")!);
    expect(`${destination.origin}${destination.pathname}`).toBe(
      `${authority}/${tenant}/oauth2/v2.0/logout`,
    );
    expect(Object.fromEntries(destination.searchParams)).toEqual({
      post_logout_redirect_uri: `${origin}/login`,
    });
    expect(response.cookies.get(names.session)?.maxAge).toBe(0);
    expect(response.cookies.get(names.binding)?.maxAge).toBe(0);
    expect(response.headers.get("x-middleware-set-cookie")).toBeNull();
    expect(await scope.identity.verify()).toBeNull();
    expect(
      await state.factory
        .create(req("/portal", other.cookie))
        .identity.verify(),
    ).toBeNull();
    expect(state.request).toHaveBeenCalledTimes(count);
    expect(response.headers.get("location")).not.toContain(a.token!);
  });
});
