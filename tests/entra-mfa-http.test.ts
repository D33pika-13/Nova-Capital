import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { generate } from "otplib";
import { EntraMfaHttp, type EntraBrowserMfa } from "@/server/entra-mfa-http";
import {
  EntraCookies,
  entraCookieNames as names,
} from "@/server/providers/entra-cookies";
import { AppError } from "@/server/errors";
import { EntraSessionService } from "@/server/modules/identity/entra-session-service";
import { EntraMfaService } from "@/server/modules/identity/entra-mfa-service";
import { PostgresEntraSessions } from "@/server/providers/postgres-entra-sessions";
import { PostgresEntraMfa } from "@/server/providers/postgres-entra-mfa";
import {
  MfaAuthenticator,
  MfaSecretProtector,
  MfaRecoveryCodes,
} from "@/server/providers/mfa-crypto";
import { TestDatabase, ids } from "./fixtures/database";

const origin = "https://app.example.test",
  token = "t".repeat(43),
  previous = "p".repeat(43);
const factorId = "10000000-0000-4000-8000-000000000001";
const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const uri = `otpauth://totp/Synthetic:Admin?secret=${secret}&issuer=Synthetic`;
const codes = Array.from(
  { length: 10 },
  (_, i) =>
    `${i.toString(16).padStart(4, "0")}-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-0000`,
);
function setup(cookies = new EntraCookies()) {
  const mfa = {
    regenerate: vi.fn<EntraBrowserMfa["regenerate"]>(async () => ({
      token,
      expiresAt: new Date(Date.now() + 28800000).toISOString(),
      recoveryCodes: codes,
    })),
    remove: vi.fn<EntraBrowserMfa["remove"]>(async () => ({ removed: true })),
    prepare: vi.fn<EntraBrowserMfa["prepare"]>(async () => ({
      factorId,
      enrolled: false,
      provisioningUri: uri,
    })),
    verify: vi.fn<EntraBrowserMfa["verify"]>(async () => ({
      token,
      expiresAt: new Date(Date.now() + 28800000).toISOString(),
      recoveryCodes: codes,
    })),
  };
  const sessions = {
    revoke: vi.fn<(token?: string, all?: boolean) => Promise<void>>(
      async () => {},
    ),
  };
  const telemetry = { event: vi.fn() };
  return {
    mfa,
    sessions,
    telemetry,
    http: new EntraMfaHttp(mfa, sessions, cookies, telemetry, origin),
  };
}
function request(
  body: unknown = { action: "setup" },
  options: {
    headers?: Record<string, string>;
    url?: string;
    method?: string;
    raw?: string;
  } = {},
) {
  const method = options.method ?? "POST";
  return new Request(options.url ?? `${origin}/api/auth/mfa`, {
    method,
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: `${names.session}=${previous}`,
      ...options.headers,
    },
    ...(method === "GET" || method === "HEAD"
      ? {}
      : { body: options.raw ?? JSON.stringify(body) }),
  });
}
function privateHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.has("x-middleware-set-cookie")).toBe(false);
}

describe("Entra MFA HTTP boundary", () => {
  it("returns only setup fields with private headers and no session mutation", async () => {
    const state = setup();
    const response = await state.http.execute(request());
    privateHeaders(response);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      factorId,
      enrolled: false,
      provisioningUri: uri,
    });
    expect(state.mfa.prepare).toHaveBeenCalledExactlyOnceWith(previous);
    expect(state.mfa.verify).not.toHaveBeenCalled();
    expect(response.headers.has("set-cookie")).toBe(false);
  });
  it("omits provisioning material for an already enrolled factor", async () => {
    const state = setup();
    state.mfa.prepare.mockResolvedValue({
      factorId,
      enrolled: true,
      provisioningUri: uri,
    });
    expect(await (await state.http.execute(request())).json()).toEqual({
      factorId,
      enrolled: true,
    });
  });
  it.each(["GET", "HEAD", "PUT", "OPTIONS"])(
    "denies method %s before calling services",
    async (method) => {
      const state = setup(),
        response = await state.http.execute(request({}, { method }));
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      expect(state.mfa.prepare).not.toHaveBeenCalled();
      expect(state.mfa.verify).not.toHaveBeenCalled();
    },
  );
  it.each<Record<string, string>>([
    { Origin: "https://other.example.test" },
    { Origin: "" },
    { Host: "other.example.test" },
    { Origin: "null" },
    { Host: "app.example.test:444" },
    { Origin: `${origin}/` },
  ])("rejects untrusted Origin/Host %j", async (headers) => {
    const state = setup(),
      response = await state.http.execute(request({}, { headers }));
    expect(response.status).toBe(403);
    privateHeaders(response);
    expect(state.mfa.prepare).not.toHaveBeenCalled();
    expect(response.headers.has("set-cookie")).toBe(false);
  });
  it("uses preserved public Host with an internal listener URL and ignores forwarded-host", async () => {
    const state = setup();
    expect(
      (
        await state.http.execute(
          request(undefined, {
            url: "http://127.0.0.1:3000/api/auth/mfa",
            headers: {
              Host: "app.example.test",
              "X-Forwarded-Host": "evil.example.test",
            },
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await state.http.execute(
          request(undefined, {
            url: "http://127.0.0.1:3000/api/auth/mfa",
            headers: { "X-Forwarded-Host": "app.example.test" },
          }),
        )
      ).status,
    ).toBe(403);
  });
  it.each(["?next=https://evil.example.test", "#fragment", "/extra"])(
    "rejects unexpected URL component %s",
    async (suffix) => {
      const state = setup();
      expect(
        (
          await state.http.execute(
            request({}, { url: `${origin}/api/auth/mfa${suffix}` }),
          )
        ).status,
      ).toBe(400);
      expect(state.mfa.prepare).not.toHaveBeenCalled();
    },
  );
  it.each([
    "{}",
    "null",
    "[]",
    '{"action":"setup","profileId":"forged"}',
    '{"action":"verify","code":"123456","factorId":"forged"}',
    '{"action":"setup","action":"verify","code":"123456"}',
    '{"action":"setup","\\u0061ction":"setup"}',
    '{"action":"verify","code":"123456","code":"654321"}',
    '{"action":"verify","code":123456}',
    '{"action":"verify","code":"12345"}',
    '{"action":"recover","code":"123456"}',
    '{"action":"setup",}',
    '{"action":"setup"}{}',
    '{"action":{"nested":"setup"}}',
    '{"action":"setup","__proto__":"x"}',
    '{"action":"setup"}junk',
    "x".repeat(1025),
  ])(
    "rejects malformed/ambiguous input %# before service invocation",
    async (raw) => {
      const state = setup();
      const response = await state.http.execute(request(undefined, { raw }));
      expect(response.status).toBe(400);
      expect(state.mfa.prepare).not.toHaveBeenCalled();
      expect(state.mfa.verify).not.toHaveBeenCalled();
      expect(response.headers.has("set-cookie")).toBe(false);
    },
  );
  it.each<Record<string, string>>([
    { "Content-Type": "text/plain" },
    { "Content-Type": "application/json; charset=latin1" },
    { "Content-Type": "application/json", "Content-Encoding": "gzip" },
    { "Content-Length": "9999" },
    { "Content-Length": "-1" },
    { "Content-Length": "1e3" },
  ])("rejects unsupported transport %j", async (headers) => {
    const state = setup();
    expect(
      (await state.http.execute(request(undefined, { headers }))).status,
    ).toBe(400);
    expect(state.mfa.prepare).not.toHaveBeenCalled();
  });
  it("rejects missing/aborted bodies and invalid UTF-8", async () => {
    const state = setup();
    const headers = {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: `${names.session}=${previous}`,
    };
    const missing = new Request(`${origin}/api/auth/mfa`, {
      method: "POST",
      headers,
    });
    const invalid = new Request(`${origin}/api/auth/mfa`, {
      method: "POST",
      headers,
      body: new Uint8Array([0xff]),
    });
    const controller = new AbortController();
    controller.abort();
    const aborted = new Request(`${origin}/api/auth/mfa`, {
      method: "POST",
      headers,
      body: '{"action":"setup"}',
      signal: controller.signal,
    });
    for (const req of [missing, invalid, aborted])
      expect((await state.http.execute(req)).status).toBe(400);
    expect(state.mfa.prepare).not.toHaveBeenCalled();
  });
  it("accepts ordinary whitespace and encoded strings without accepting duplicate decoded keys", async () => {
    const state = setup();
    expect(
      (
        await state.http.execute(
          request(undefined, {
            raw: ' \n{ "\\u0061ction" : "set\\u0075p" } \n',
          }),
        )
      ).status,
    ).toBe(200);
  });
  it.each([
    "",
    `${names.session}=quoted`,
    `${names.session}=${previous}; ${names.session}=${token}`,
  ])("rejects missing or ambiguous cookies %j", async (Cookie) => {
    const state = setup();
    const response = await state.http.execute(
      request(undefined, { headers: { Cookie } }),
    );
    expect(response.status).toBe(Cookie ? 400 : 401);
    expect(state.mfa.prepare).not.toHaveBeenCalled();
    expect(response.headers.has("set-cookie")).toBe(false);
  });
  it("rotates cookies and returns recovery codes without a token in JSON or other headers", async () => {
    const state = setup();
    const response = await state.http.execute(
      request({ action: "verify", code: "123456" }),
    );
    expect(response.status).toBe(200);
    privateHeaders(response);
    expect(state.mfa.verify).toHaveBeenCalledExactlyOnceWith(
      previous,
      "123456",
      false,
    );
    expect(await response.json()).toEqual({
      redirect: "/admin",
      recoveryCodes: codes,
    });
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain(`${names.session}=${token}`);
    for (const value of ["Secure", "HttpOnly", "SameSite=lax", "Path=/"])
      expect(cookie).toContain(value);
    expect(cookie).not.toContain("Domain=");
    for (const [name, value] of response.headers)
      if (name !== "set-cookie") expect(value).not.toContain(token);
    expect(JSON.stringify(state.telemetry.event.mock.calls)).not.toContain(
      codes[0],
    );
    expect(state.sessions.revoke).not.toHaveBeenCalled();
  });
  it("selects recovery explicitly and returns no new recovery secrets", async () => {
    const state = setup();
    state.mfa.verify.mockResolvedValue({
      token,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      recoveryCodes: null,
    });
    const response = await state.http.execute(
      request({ action: "recover", code: codes[0] }),
    );
    expect(response.status).toBe(200);
    expect(state.mfa.verify).toHaveBeenCalledExactlyOnceWith(
      previous,
      codes[0],
      true,
    );
    expect(await response.json()).toEqual({
      redirect: "/admin",
      recoveryCodes: null,
    });
  });
  it.each([
    "https://evil.example.test/qr?secret=private",
    uri + "&secret=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    uri + "&algorithm=SHA256",
    uri + "&digits=8",
    uri + "&period=60",
    uri + "#fragment",
  ])(
    "does not expose invalid provisioning responses %#",
    async (provisioningUri) => {
      const state = setup();
      state.mfa.prepare.mockResolvedValue({
        factorId,
        enrolled: false,
        provisioningUri,
      });
      const response = await state.http.execute(request());
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(secret);
      expect(response.headers.has("set-cookie")).toBe(false);
    },
  );
  it("keeps a normal denied or rate-limited attempt from clearing the existing cookie", async () => {
    for (const code of ["MFA_DENIED", "RATE_LIMITED"]) {
      const state = setup();
      state.mfa.verify.mockRejectedValue(
        new AppError(code, `private ${secret}`, 403),
      );
      const response = await state.http.execute(
        request({ action: "verify", code: "123456" }),
      );
      expect(response.status).toBe(code === "MFA_DENIED" ? 403 : 429);
      expect(await response.text()).not.toContain(secret);
      expect(response.headers.has("set-cookie")).toBe(false);
      expect(state.sessions.revoke).not.toHaveBeenCalled();
    }
  });
  it("clears a possibly revoked cookie after uncertain service failure without exposing its error", async () => {
    const state = setup();
    state.mfa.verify.mockRejectedValue(Error(`private ${secret}`));
    const response = await state.http.execute(
      request({ action: "verify", code: "123456" }),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(secret);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it("revokes a minted session and clears cookies if cookie installation fails, even if cleanup telemetry fails", async () => {
    class FailingCookies extends EntraCookies {
      override session(): void {
        throw Error(`private ${secret}`);
      }
    }
    const state = setup(new FailingCookies());
    state.sessions.revoke.mockRejectedValue(Error("private cleanup"));
    state.telemetry.event.mockImplementation(() => {
      throw Error("private telemetry");
    });
    const response = await state.http.execute(
      request({ action: "verify", code: "123456" }),
    );
    expect(response.status).toBe(503);
    expect(state.sessions.revoke).toHaveBeenCalledExactlyOnceWith(token, false);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await response.text()).not.toContain(secret);
    privateHeaders(response);
  });
  it("revokes issued tokens on invalid recovery output rather than exposing it", async () => {
    const state = setup();
    state.mfa.verify.mockResolvedValue({
      token,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      recoveryCodes: [codes[0]],
    });
    const response = await state.http.execute(
      request({ action: "verify", code: "123456" }),
    );
    expect(response.status).toBe(503);
    expect(state.sessions.revoke).toHaveBeenCalledExactlyOnceWith(token, false);
    expect(await response.text()).not.toContain(codes[0]);
  });
  it.each(["totp", "recovery"] as const)(
    "regenerates using explicit %s verification and returns a rotated cookie",
    async (method) => {
      const state = setup();
      const code = method === "totp" ? "123456" : codes[0];
      const response = await state.http.execute(
        request({ action: "regenerate", method, code }),
      );
      expect(response.status).toBe(200);
      privateHeaders(response);
      expect(state.mfa.regenerate).toHaveBeenCalledExactlyOnceWith(
        previous,
        code,
        method === "recovery",
      );
      expect(await response.json()).toEqual({
        redirect: "/admin",
        recoveryCodes: codes,
      });
      expect(response.headers.get("set-cookie")).toContain(
        `${names.session}=${token}`,
      );
      expect(state.mfa.verify).not.toHaveBeenCalled();
    },
  );
  it("clears both cookies after verified factor removal without minting a replacement", async () => {
    const state = setup();
    const response = await state.http.execute(
      request({ action: "remove", method: "recovery", code: codes[0] }),
    );
    expect(response.status).toBe(200);
    privateHeaders(response);
    expect(state.mfa.remove).toHaveBeenCalledExactlyOnceWith(
      previous,
      codes[0],
      true,
    );
    expect(await response.json()).toEqual({
      redirect: "/login",
      removed: true,
    });
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) expect(cookie).toContain("Max-Age=0");
    expect(state.sessions.revoke).not.toHaveBeenCalled();
  });
  it.each([
    { action: "remove", code: "123456" },
    { action: "remove", method: "email", code: "123456" },
    { action: "regenerate", method: "totp", code: codes[0] },
    { action: "regenerate", method: "recovery", code: "123456" },
    {
      action: "remove",
      method: "recovery",
      code: codes[0],
      profileId: factorId,
    },
    { action: "remove", method: "totp", code: "123456", confirmed: true },
  ])("denies invalid lifecycle inputs %#", async (body) => {
    const state = setup();
    expect((await state.http.execute(request(body))).status).toBe(400);
    expect(state.mfa.remove).not.toHaveBeenCalled();
    expect(state.mfa.regenerate).not.toHaveBeenCalled();
  });
  it("keeps denied removal cookies and cleans a minted regeneration token if cookie installation fails", async () => {
    const state = setup();
    state.mfa.remove.mockRejectedValue(
      new AppError("MFA_DENIED", "private", 403),
    );
    const denied = await state.http.execute(
      request({ action: "remove", method: "totp", code: "123456" }),
    );
    expect(denied.status).toBe(403);
    expect(denied.headers.has("set-cookie")).toBe(false);
    class FailingCookies extends EntraCookies {
      override session(): void {
        throw Error("installation");
      }
    }
    const failed = setup(new FailingCookies());
    const response = await failed.http.execute(
      request({ action: "regenerate", method: "totp", code: "123456" }),
    );
    expect(response.status).toBe(503);
    expect(failed.sessions.revoke).toHaveBeenCalledExactlyOnceWith(
      token,
      false,
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

const db = new TestDatabase();
describe("composed Entra MFA HTTP and SQL flow", () => {
  beforeAll(() => db.initialize(), 20000);
  afterAll(() => db.close());
  it("enrolls, rotates, rejects replay, recovers once and revokes minted sessions on failed cookie installation", async () => {
    const tenant = "40000000-0000-4000-8000-000000000004";
    const identity = {
      provider: "entra",
      subject: `${tenant}:80000000-0000-4000-8000-000000000008`,
      assurance: "aal1" as const,
    };
    await db.engine.query(
      "insert into provider_identities(profile_id,provider,subject) values($1,'entra',$2)",
      [ids.admin, identity.subject],
    );
    const sessions = new EntraSessionService(new PostgresEntraSessions(db), {
      tenantId: tenant,
      clientId: "50000000-0000-4000-8000-000000000005",
      issuer: `https://synthetic.ciamlogin.com/${tenant}/v2.0`,
      applicationOrigin: origin,
    });
    const mfa = new EntraMfaService(
      new PostgresEntraMfa(db),
      {
        protector: new MfaSecretProtector("test", {
          test: randomBytes(32).toString("base64url"),
        }),
        authenticator: new MfaAuthenticator("Synthetic"),
        recovery: new MfaRecoveryCodes(),
      },
      sessions.realmHash,
    );
    const http = new EntraMfaHttp(
      mfa,
      sessions,
      new EntraCookies(),
      { event: vi.fn() },
      origin,
    );
    const first = await sessions.issue(identity);
    const send = (body: unknown, value: string) =>
      request(body, { headers: { Cookie: `${names.session}=${value}` } });
    const setupResponse = await http.execute(
      send({ action: "setup" }, first.token),
    );
    expect(setupResponse.status).toBe(200);
    const setup = await setupResponse.json();
    const secret = new URL(setup.provisioningUri).searchParams.get("secret")!;
    const code = await generate({ secret });
    const verified = await http.execute(
      send({ action: "verify", code }, first.token),
    );
    expect(verified.status).toBe(200);
    privateHeaders(verified);
    const recovery = (await verified.json()).recoveryCodes as string[];
    const elevated = verified.headers
      .get("set-cookie")!
      .split(";")[0]
      .split("=")[1];
    expect(await sessions.verify(first.token)).toBeNull();
    expect(await sessions.verify(elevated)).toMatchObject({
      assurance: "aal2",
    });
    const replay = await http.execute(
      send({ action: "verify", code }, elevated),
    );
    expect(replay.status).toBe(403);
    expect(replay.headers.has("set-cookie")).toBe(false);
    const recovered = await http.execute(
      send({ action: "recover", code: recovery[0] }, elevated),
    );
    expect(recovered.status).toBe(200);
    const final = recovered.headers
      .get("set-cookie")!
      .split(";")[0]
      .split("=")[1];
    expect(await sessions.verify(elevated)).toBeNull();
    expect(await sessions.verify(final)).toMatchObject({ assurance: "aal2" });
    expect(
      (
        await http.execute(
          send({ action: "recover", code: recovery[0] }, final),
        )
      ).status,
    ).toBe(403);
    class FailingCookies extends EntraCookies {
      override session(): void {
        throw Error("synthetic installation failure");
      }
    }
    const failing = new EntraMfaHttp(
      mfa,
      sessions,
      new FailingCookies(),
      { event: vi.fn() },
      origin,
    );
    const failed = await failing.execute(
      send({ action: "recover", code: recovery[1] }, final),
    );
    expect(failed.status).toBe(503);
    expect(failed.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await sessions.verify(final)).toBeNull();
    expect(
      (
        await db.engine.query(
          "select * from private.entra_sessions where revoked_at is null",
        )
      ).rows,
    ).toHaveLength(0);
    expect(await failed.text()).not.toContain(recovery[1]);
    const fresh = await sessions.issue(identity);
    const regenerated = await http.execute(
      send(
        { action: "regenerate", method: "recovery", code: recovery[2] },
        fresh.token,
      ),
    );
    expect(regenerated.status).toBe(200);
    const newCodes = (await regenerated.json()).recoveryCodes as string[];
    const newToken = regenerated.headers
      .get("set-cookie")!
      .split(";")[0]
      .split("=")[1];
    expect(await sessions.verify(fresh.token)).toBeNull();
    expect(await sessions.verify(newToken)).toMatchObject({
      assurance: "aal2",
    });
    const removed = await http.execute(
      send(
        { action: "remove", method: "recovery", code: newCodes[0] },
        newToken,
      ),
    );
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ redirect: "/login", removed: true });
    expect(await sessions.verify(newToken)).toBeNull();
    expect(
      (await db.engine.query("select * from private.entra_mfa_factors")).rows,
    ).toHaveLength(0);
  });
});
