import { beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { createHash } from "node:crypto";
import {
  EntraCodeExchange,
  type EntraExchangeOptions,
} from "@/server/providers/entra-code-exchange";
import type {
  OidcCodeExchange,
  OidcMetadata,
} from "@/server/modules/identity/oidc-login-contracts";
import { EntraDiscoveryProvider } from "@/server/providers/entra-discovery";
import { EntraLoginService } from "@/server/modules/identity/entra-login-service";
import { PostgresLoginTransactions } from "@/server/providers/postgres-login-transactions";
import {
  PostgresRateLimiter,
  PostgresProfileRepository,
} from "@/server/providers/postgres-database";
import { TestDatabase, ids } from "./fixtures/database";
import { EntraHttp } from "@/server/entra-http";
import {
  EntraCookies,
  entraCookieNames,
} from "@/server/providers/entra-cookies";
import { EntraSessionService } from "@/server/modules/identity/entra-session-service";
import { PostgresEntraSessions } from "@/server/providers/postgres-entra-sessions";
type Input = Parameters<OidcCodeExchange["exchange"]>[0];
const tenant = "10000000-0000-4000-8000-000000000001";
const client = "20000000-0000-4000-8000-000000000002";
const object = "30000000-0000-4000-8000-000000000003";
const origin = "https://synthetic.ciamlogin.com";
const metadata: OidcMetadata = {
  issuer: `${origin}/${tenant}/v2.0`,
  clientId: client,
  authorizationEndpoint: `${origin}/${tenant}/oauth2/v2.0/authorize`,
  tokenEndpoint: `${origin}/${tenant}/oauth2/v2.0/token`,
  jwksUri: `${origin}/${tenant}/discovery/v2.0/keys`,
  logoutEndpoint: `${origin}/${tenant}/oauth2/v2.0/logout`,
  tokenAuthenticationMethod: "client_secret_post",
};
const options: EntraExchangeOptions = {
  tenantId: tenant,
  clientId: client,
  tenantSubdomain: "synthetic",
  clientSecret: "synthetic-client-secret+&=reserved-characters",
  redirectUri: "https://app.example.test/auth/entra/callback",
};
const input: Input = {
  code: "synthetic-code+/?=",
  codeVerifier: "v".repeat(43),
  validatedState: "s".repeat(43),
  expectedNonce: "n".repeat(43),
  redirectUri: options.redirectUri,
  metadata,
};
let pair: Awaited<ReturnType<typeof generateKeyPair>>;
let other: Awaited<ReturnType<typeof generateKeyPair>>;
let key: Awaited<ReturnType<typeof exportJWK>>;
beforeAll(async () => {
  [pair, other] = await Promise.all([
    generateKeyPair("RS256"),
    generateKeyPair("RS256"),
  ]);
  key = {
    ...(await exportJWK(pair.publicKey)),
    kid: "synthetic-key",
    alg: "RS256",
    use: "sig",
  };
});
async function signed(
  claims: Record<string, unknown> = {},
  privateKey = pair.privateKey,
) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: metadata.issuer,
    aud: client,
    sub: "synthetic-pairwise-subject",
    oid: object,
    tid: tenant,
    ver: "2.0",
    nonce: input.expectedNonce,
    iat: now,
    nbf: now - 30,
    exp: now + 3600,
    ...claims,
  } as JWTPayload)
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: "synthetic-key" })
    .sign(privateKey);
}
async function setup(response?: Response, settings = options) {
  const tokens =
    response ??
    Response.json({
      token_type: "Bearer",
      access_token: "synthetic-access-token-not-retained",
      refresh_token: "synthetic-refresh-token-not-retained",
      expires_in: 3600,
      id_token: await signed(),
    });
  const request = vi.fn<typeof fetch>(async (url) => {
    if (String(url) === metadata.tokenEndpoint) return tokens;
    if (String(url) === metadata.jwksUri) return Response.json({ keys: [key] });
    throw Error("unapproved network request");
  });
  return { provider: new EntraCodeExchange(settings, request), request };
}

describe("Entra authorization-code exchange", () => {
  it.each([
    { clientSecret: "short" },
    { clientSecret: "synthetic-secret\nwith-controls" },
    { clientSecret: "x".repeat(4097) },
    { timeoutMs: 0 },
    { timeoutMs: 20001 },
    { redirectUri: "http://app.example.test/auth/entra/callback" },
  ])("rejects invalid confidential-client configuration (%#)", (change) => {
    expect(() => new EntraCodeExchange({ ...options, ...change })).toThrow();
  });
  it("uses actual OAuth form encoding and returns only the signature-verified identity", async () => {
    const { provider, request } = await setup();
    const result = await provider.exchange(input);
    expect(result).toEqual({
      provider: "entra",
      subject: `${tenant}:${object}`,
      assurance: "aal1",
    });
    expect(JSON.stringify(result)).not.toMatch(
      /access.token|refresh.token|client.secret|codeVerifier|expectedNonce/i,
    );
    expect(request).toHaveBeenCalledTimes(2);
    const [url, init] = request.mock.calls[0];
    expect(String(url)).toBe(metadata.tokenEndpoint);
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    const body = new URLSearchParams(String(init?.body));
    expect(Object.fromEntries(body)).toEqual({
      client_id: client,
      client_secret: options.clientSecret,
      code: input.code,
      code_verifier: input.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: options.redirectUri,
    });
    expect(new Headers(init?.headers).get("content-type")).toBe(
      "application/x-www-form-urlencoded;charset=UTF-8",
    );
    expect(String(request.mock.calls[1][0])).toBe(metadata.jwksUri);
    expect(request.mock.calls[1][1]?.body).toBeUndefined();
    expect(
      new Headers(request.mock.calls[1][1]?.headers).get("authorization"),
    ).toBeNull();
  });
  it.each([
    { code: "" },
    { codeVerifier: "short" },
    { expectedNonce: "short" },
    { validatedState: "short" },
    { redirectUri: "https://evil.example.test/auth/entra/callback" },
  ])(
    "rejects invalid saved context before sending credentials (%#)",
    async (change) => {
      const { provider, request } = await setup();
      await expect(
        provider.exchange({ ...input, ...change }),
      ).rejects.toMatchObject({ code: "IDENTITY_EXCHANGE_FAILED" });
      expect(request).not.toHaveBeenCalled();
    },
  );
  it.each([
    { issuer: "https://evil.example.test/v2.0" },
    { clientId: "forged-client" },
    { tokenEndpoint: "https://evil.example.test/token" },
    { jwksUri: "https://evil.example.test/keys" },
    { authorizationEndpoint: "https://evil.example.test/authorize" },
    { logoutEndpoint: "https://evil.example.test/logout" },
  ])(
    "revalidates discovered destinations before releasing the client secret (%#)",
    async (change) => {
      const { provider, request } = await setup();
      await expect(
        provider.exchange({ ...input, metadata: { ...metadata, ...change } }),
      ).rejects.toMatchObject({ status: 401 });
      expect(request).not.toHaveBeenCalled();
    },
  );
  it("does not accept a syntactically valid ID token signed by another key", async () => {
    const { provider, request } = await setup(
      Response.json({
        token_type: "Bearer",
        access_token: "synthetic-access",
        id_token: await signed({}, other.privateKey),
      }),
    );
    await expect(provider.exchange(input)).rejects.toMatchObject({
      message: "Sign-in could not be completed. Start sign-in again.",
    });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it.each([
    { nonce: "wrong-nonce" },
    { aud: "wrong-audience" },
    { tid: "40000000-0000-4000-8000-000000000004" },
    { exp: Math.floor(Date.now() / 1000) - 1 },
  ])(
    "denies invalid signed claims after token redemption (%#)",
    async (claims) => {
      const { provider } = await setup(
        Response.json({
          token_type: "Bearer",
          access_token: "synthetic-access",
          id_token: await signed(claims),
        }),
      );
      await expect(provider.exchange(input)).rejects.toMatchObject({
        code: "IDENTITY_EXCHANGE_FAILED",
      });
    },
  );
  it.each([
    () =>
      Response.json({
        token_type: "Bearer",
        access_token: "synthetic-no-id-token",
      }),
    () => new Response("private-error-and-secret", { status: 400 }),
    () => new Response("private-error-and-secret", { status: 503 }),
    () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.example.test" },
      }),
    () =>
      new Response("not-json", {
        headers: { "content-type": "application/json" },
      }),
    () =>
      new Response("<html>not-json</html>", {
        headers: { "content-type": "text/html" },
      }),
    () =>
      new Response("a".repeat(65537), {
        headers: { "content-type": "application/json" },
      }),
  ])(
    "does not retry redirects, provider refusals or malformed responses (%#)",
    async (response) => {
      const { provider, request } = await setup(response());
      await expect(provider.exchange(input)).rejects.toMatchObject({
        message: "Sign-in could not be completed. Start sign-in again.",
      });
      expect(request).toHaveBeenCalledOnce();
    },
  );
  it("cancels late token responses after the total operation deadline", async () => {
    let finish!: (value: Response) => void;
    const request = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const provider = new EntraCodeExchange(
      { ...options, timeoutMs: 20 },
      request,
    );
    await expect(provider.exchange(input)).rejects.toMatchObject({
      code: "IDENTITY_EXCHANGE_FAILED",
    });
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
    const cancel = vi.fn();
    finish(
      new Response(new ReadableStream({ cancel }), {
        headers: { "content-type": "application/json" },
      }),
    );
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  });
  it.each(["token", "keys"])(
    "cancels stalled %s response bodies under the same operation deadline",
    async (endpoint) => {
      const cancel = vi.fn();
      const jwt = await signed();
      const request = vi.fn<typeof fetch>(async (url) => {
        if (endpoint === "token" || String(url) === metadata.jwksUri)
          return new Response(new ReadableStream({ cancel }), {
            headers: { "content-type": "application/json" },
          });
        return Response.json({
          token_type: "Bearer",
          access_token: "synthetic-access",
          id_token: jwt,
        });
      });
      await expect(
        new EntraCodeExchange({ ...options, timeoutMs: 30 }, request).exchange(
          input,
        ),
      ).rejects.toMatchObject({ status: 401 });
      expect(cancel).toHaveBeenCalledOnce();
    },
  );
});

it("composes HTTP cookies, discovery, SQL one-use state, OAuth/RSA identity, application session and logout", async () => {
  const db = new TestDatabase();
  await db.initialize();
  let expectedNonce = "";
  let expectedChallenge = "";
  const request = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith("/.well-known/openid-configuration"))
      return Response.json({
        issuer: metadata.issuer,
        authorization_endpoint: metadata.authorizationEndpoint,
        token_endpoint: metadata.tokenEndpoint,
        jwks_uri: metadata.jwksUri,
        end_session_endpoint: metadata.logoutEndpoint,
        response_types_supported: ["code"],
        response_modes_supported: ["query"],
        id_token_signing_alg_values_supported: ["RS256"],
        subject_types_supported: ["pairwise"],
        scopes_supported: ["openid", "profile"],
        token_endpoint_auth_methods_supported: ["client_secret_post"],
      });
    if (String(url) === metadata.tokenEndpoint) {
      const body = new URLSearchParams(String(init?.body));
      expect(
        createHash("sha256")
          .update(body.get("code_verifier")!)
          .digest("base64url"),
      ).toBe(expectedChallenge);
      return Response.json({
        token_type: "Bearer",
        access_token: "synthetic-access",
        id_token: await signed({ nonce: expectedNonce }),
      });
    }
    if (String(url) === metadata.jwksUri) return Response.json({ keys: [key] });
    throw Error("unapproved request");
  });
  try {
    const service = new EntraLoginService(
      new EntraDiscoveryProvider(options, request),
      new PostgresLoginTransactions(db),
      new EntraCodeExchange(options, request),
      new PostgresRateLimiter(db),
      options.redirectUri,
    );
    await db.engine.query(
      "insert into provider_identities(profile_id,provider,subject) values($1,'entra',$2)",
      [ids.a, `${tenant}:${object}`],
    );
    const applicationOrigin = new URL(options.redirectUri).origin;
    const sessions = new EntraSessionService(new PostgresEntraSessions(db), {
      tenantId: tenant,
      clientId: client,
      issuer: metadata.issuer,
      applicationOrigin,
    });
    const http = new EntraHttp(
      service,
      sessions,
      new PostgresProfileRepository(db),
      new EntraCookies(),
      { event: vi.fn() },
      { applicationOrigin, authorityOrigin: origin },
    );
    const start = await http.start(
      new Request(`${applicationOrigin}/auth/entra/start`, {
        method: "POST",
        headers: { origin: applicationOrigin },
      }),
    );
    expect(start.status).toBe(303);
    const query = new URL(start.headers.get("location")!).searchParams;
    expectedNonce = query.get("nonce")!;
    expectedChallenge = query.get("code_challenge")!;
    const callback = new URLSearchParams({
      code: "synthetic-single-use-code",
      state: query.get("state")!,
    });
    const binding = `${entraCookieNames.binding}=${start.cookies.get(entraCookieNames.binding)!.value}`;
    const completed = await http.callback(
      new Request(`${options.redirectUri}?${callback}`, {
        headers: { cookie: binding },
      }),
    );
    expect(completed.headers.get("location")).toBe(
      `${applicationOrigin}/portal`,
    );
    expect(completed.headers.get("x-middleware-set-cookie")).toBeNull();
    const sessionToken = completed.cookies.get(entraCookieNames.session)!.value;
    const cookie = `${binding}; ${entraCookieNames.session}=${sessionToken}`;
    const current = () =>
      new Request(`${applicationOrigin}/portal`, { headers: { cookie } });
    expect(await http.verify(current())).toEqual({
      provider: "entra",
      subject: `${tenant}:${object}`,
      assurance: "aal1",
    });
    const replay = await http.callback(
      new Request(`${options.redirectUri}?${callback}`, {
        headers: { cookie },
      }),
    );
    expect(replay.headers.get("location")).toBe(
      `${applicationOrigin}/login?error=link`,
    );
    expect(replay.headers.get("set-cookie")).toBeNull();
    expect(await http.verify(current())).toMatchObject({
      subject: `${tenant}:${object}`,
    });
    const logout = await http.logout(
      new Request(`${applicationOrigin}/api/auth/logout`, {
        method: "POST",
        headers: { origin: applicationOrigin, cookie },
      }),
    );
    expect(logout.status).toBe(200);
    expect(logout.cookies.get(entraCookieNames.session)?.maxAge).toBe(0);
    expect(await http.verify(current())).toBeNull();
    expect(request).toHaveBeenCalledTimes(3);
  } finally {
    await db.close();
  }
});
