import { describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import {
  EntraHttp,
  type EntraBrowserFlow,
  type EntraBrowserSessions,
} from "@/server/entra-http";
import {
  EntraCookies,
  entraCookieNames as names,
} from "@/server/providers/entra-cookies";
import type {
  Profile,
  ProfileRepository,
  VerifiedIdentity,
} from "@/server/contracts";
import { AppError } from "@/server/errors";
const app = "https://app.example.test";
const authority = "https://synthetic.ciamlogin.com";
const binding = "b".repeat(43),
  previous = "p".repeat(43),
  token = "t".repeat(43);
const identity: VerifiedIdentity = {
  provider: "entra",
  subject: "synthetic-verified-identity",
  assurance: "aal1",
};
const profile: Profile = {
  id: "10000000-0000-4000-8000-000000000001",
  externalSubject: identity.subject,
  role: "client",
  status: "active",
  clientId: "INV-1001",
  displayName: "SYNTHETIC A",
};
function setup(cookies = new EntraCookies()) {
  const flow = {
    start: vi.fn<EntraBrowserFlow["start"]>(async (existing, purpose) => ({
      authorizationUrl: `${authority}/10000000-0000-4000-8000-000000000001/oauth2/v2.0/authorize?state=synthetic-state&nonce=synthetic-nonce${purpose === "recovery" ? "&prompt=login" : ""}`,
      browserBinding: existing ?? binding,
      maxAgeSeconds: 600,
    })),
    completeFlow: vi.fn<EntraBrowserFlow["completeFlow"]>(async () => ({
      identity,
      purpose: "login",
    })),
  };
  const sessions = {
    issueRecovery: vi.fn<EntraBrowserSessions["issueRecovery"]>(async () => ({
      token,
      expiresAt: new Date(Date.now() + 28800000).toISOString(),
      maxAgeSeconds: 28800,
    })),
    issue: vi.fn<EntraBrowserSessions["issue"]>(async () => ({
      token,
      expiresAt: new Date(Date.now() + 28800000).toISOString(),
      maxAgeSeconds: 28800,
    })),
    verify: vi.fn<EntraBrowserSessions["verify"]>(async (value) =>
      value === token || value === previous ? identity : null,
    ),
    revoke: vi.fn<EntraBrowserSessions["revoke"]>(async () => {}),
  };
  const profiles = {
    findByIdentity: vi.fn<ProfileRepository["findByIdentity"]>(
      async () => profile,
    ),
  };
  const telemetry = { event: vi.fn() };
  return {
    flow,
    sessions,
    profiles,
    telemetry,
    http: new EntraHttp(flow, sessions, profiles, cookies, telemetry, {
      applicationOrigin: app,
      authorityOrigin: authority,
    }),
  };
}
function request(
  path: string,
  method = "POST",
  cookie?: string,
  origin: string | null = app,
  body?: string,
) {
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  if (cookie) headers.set("cookie", cookie);
  return new Request(`${app}${path}`, { method, headers, body });
}
function assertPrivate(response: NextResponse) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-middleware-set-cookie")).toBeNull();
}
function assertCookie(response: NextResponse, name: string, value: string) {
  expect(response.cookies.get(name)).toMatchObject({
    value,
    secure: true,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    priority: "high",
  });
  expect(response.cookies.get(name)?.domain).toBeUndefined();
}

describe("Entra cookie transport", () => {
  it("reads only opaque selected cookies and ignores unrelated cookies", () => {
    expect(
      new EntraCookies().read(
        request(
          "/portal",
          "GET",
          `analytics=unrelated; ${names.binding}=${binding}; ${names.session}=${token}`,
        ),
      ),
    ).toEqual({ binding, session: token });
  });
  it.each([
    `${names.session}=short`,
    `${names.binding}=`,
    `${names.session}=${token}; ${names.session}=${token}`,
    `${names.binding}=${binding}; ${names.binding}=${binding}`,
    `${names.session}="${token}"`,
    `${names.session}=%74${"t".repeat(42)}`,
    `unknown=${"x".repeat(16385)}`,
  ])("rejects malformed, duplicated or oversized cookies (%#)", (cookie) => {
    expect(() =>
      new EntraCookies().read(request("/portal", "GET", cookie)),
    ).toThrow();
  });
  it("uses host-only secure cookies and clamps browser lifetime to server expiry", () => {
    const response = NextResponse.json({ ok: true });
    const cookies = new EntraCookies();
    cookies.binding(response, binding);
    cookies.session(response, {
      token,
      expiresAt: new Date(Date.now() + 90000).toISOString(),
      maxAgeSeconds: 28800,
    });
    assertCookie(response, names.binding, binding);
    assertCookie(response, names.session, token);
    expect(response.cookies.get(names.binding)?.maxAge).toBe(600);
    expect(response.cookies.get(names.session)?.maxAge).toBeGreaterThan(0);
    expect(response.cookies.get(names.session)?.maxAge).toBeLessThanOrEqual(90);
    expect(response.headers.get("x-middleware-set-cookie")).toBeNull();
    for (const [name, value] of response.headers)
      if (name !== "set-cookie") expect(value).not.toContain(token);
  });
  it("rejects expired or invalid session values without installing a cookie", () => {
    for (const change of [
      { token: "short" },
      { expiresAt: "invalid-date" },
      { expiresAt: new Date(Date.now() - 1000).toISOString() },
      { maxAgeSeconds: 0 },
    ]) {
      const response = NextResponse.json({});
      expect(() =>
        new EntraCookies().session(response, {
          token,
          expiresAt: new Date(Date.now() + 10000).toISOString(),
          maxAgeSeconds: 28800,
          ...change,
        }),
      ).toThrow();
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });
});

describe("Entra HTTP initiation and logout CSRF", () => {
  it.each(["start", "logout"] as const)(
    "rejects non-POST %s without side effects",
    async (action) => {
      const s = setup();
      const result = await s.http[action](
        request(`/auth/entra/${action}`, "GET", undefined, null),
      );
      expect(result.status).toBe(405);
      expect(result.headers.get("allow")).toBe("POST");
      expect(result.headers.get("set-cookie")).toBeNull();
      assertPrivate(result);
      expect(s.flow.start).not.toHaveBeenCalled();
      expect(s.sessions.revoke).not.toHaveBeenCalled();
    },
  );
  it.each([null, "https://evil.example.test"])(
    "denies missing/foreign Origin %s",
    async (origin) => {
      const s = setup();
      for (const action of ["start", "logout"] as const) {
        const result = await s.http[action](
          request(
            `/auth/entra/${action}`,
            "POST",
            `${names.session}=${previous}`,
            origin,
          ),
        );
        expect(result.status).toBe(403);
        expect(result.headers.get("set-cookie")).toBeNull();
      }
      expect(s.flow.start).not.toHaveBeenCalled();
      expect(s.sessions.revoke).not.toHaveBeenCalled();
    },
  );
  it.each(["start", "logout"] as const)(
    "rejects caller input on %s",
    async (action) => {
      const s = setup();
      for (const req of [
        request(`/auth/entra/${action}?next=https://evil.example.test`),
        request(
          `/auth/entra/${action}`,
          "POST",
          undefined,
          app,
          '{"role":"admin"}',
        ),
      ]) {
        const response = await s.http[action](req);
        expect(response.status).toBe(400);
        expect(response.headers.get("set-cookie")).toBeNull();
      }
      expect(s.flow.start).not.toHaveBeenCalled();
      expect(s.sessions.revoke).not.toHaveBeenCalled();
    },
  );
  it("writes binding only as a secure cookie and redirects to the approved authority", async () => {
    const s = setup();
    const result = await s.http.start(request("/auth/entra/start"));
    expect(result.status).toBe(303);
    expect(new URL(result.headers.get("location")!).origin).toBe(authority);
    assertCookie(result, names.binding, binding);
    assertPrivate(result);
    expect(result.headers.get("location")).not.toContain(binding);
    expect(await result.text()).not.toContain(binding);
  });
  it("reuses an established binding for parallel login flows", async () => {
    const s = setup();
    await s.http.start(
      request("/auth/entra/start", "POST", `${names.binding}=${binding}`),
    );
    expect(s.flow.start).toHaveBeenCalledExactlyOnceWith(binding);
  });
  it.each([
    "https://evil.example.test/authorize",
    "javascript:alert(1)",
    `${authority}/not-authorize`,
  ])("does not emit an unapproved redirect (%#)", async (url) => {
    const s = setup();
    s.flow.start.mockResolvedValue({
      authorizationUrl: url,
      browserBinding: binding,
      maxAgeSeconds: 600,
    });
    const result = await s.http.start(request("/auth/entra/start"));
    expect(result.status).toBe(503);
    expect(result.headers.get("location")).toBeNull();
    expect(result.headers.get("set-cookie")).toBeNull();
  });
  it("returns safe rate-limit/provider failures without leaking dependency messages", async () => {
    const s = setup();
    s.flow.start.mockRejectedValue(
      new AppError("RATE_LIMITED", "private-provider-secret", 429),
    );
    const limited = await s.http.start(request("/auth/entra/start"));
    expect(limited.status).toBe(429);
    expect(await limited.text()).not.toContain("private-provider-secret");
    s.flow.start.mockRejectedValue(Error("private-provider-secret"));
    const unavailable = await s.http.start(request("/auth/entra/start"));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain("private-provider-secret");
  });
  it("clears invalid cookies on same-origin initiation so a subsequent retry can recover", async () => {
    const s = setup();
    const result = await s.http.start(
      request("/auth/entra/start", "POST", `${names.binding}=short`),
    );
    expect(result.status).toBe(400);
    assertCookie(result, names.binding, "");
    assertCookie(result, names.session, "");
    expect(result.cookies.get(names.binding)?.maxAge).toBe(0);
    expect(s.flow.start).not.toHaveBeenCalled();
  });
  it("revokes before clearing both cookies on logout", async () => {
    const s = setup();
    const result = await s.http.logout(
      request(
        "/api/auth/logout",
        "POST",
        `${names.binding}=${binding}; ${names.session}=${previous}`,
      ),
    );
    expect(s.sessions.revoke).toHaveBeenCalledExactlyOnceWith(previous, true);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ redirect: "/login" });
    assertCookie(result, names.binding, "");
    assertCookie(result, names.session, "");
    assertPrivate(result);
  });
  it("reports failed logout rather than claiming confirmed revocation", async () => {
    const s = setup();
    s.sessions.revoke.mockRejectedValue(Error("private-db-secret"));
    const result = await s.http.logout(
      request("/api/auth/logout", "POST", `${names.session}=${previous}`),
    );
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("private-db-secret");
    assertCookie(result, names.session, "");
    assertPrivate(result);
  });
});

describe("Entra callback and request identity transport", () => {
  const callback = () =>
    request(
      "/auth/entra/callback?state=synthetic-state&code=synthetic-code",
      "GET",
      `${names.binding}=${binding}; ${names.session}=${previous}`,
      null,
    );
  it.each(["client", "admin"] as const)(
    "routes %s to the appropriate protected destination without credential JSON",
    async (role) => {
      const s = setup();
      s.profiles.findByIdentity.mockResolvedValue({ ...profile, role });
      const result = await s.http.callback(callback());
      expect(result.headers.get("location")).toBe(
        `${app}${role === "admin" ? "/mfa" : "/portal"}`,
      );
      expect(s.sessions.issue).toHaveBeenCalledExactlyOnceWith(
        identity,
        previous,
      );
      assertCookie(result, names.session, token);
      assertPrivate(result);
      expect(result.cookies.get(names.binding)).toBeUndefined();
      expect(await result.text()).not.toContain(token);
      expect(result.headers.get("location")).not.toContain("synthetic-code");
    },
  );
  it("does not redeem a callback without a browser binding", async () => {
    const s = setup();
    const result = await s.http.callback(
      request(
        "/auth/entra/callback?code=synthetic-code",
        "GET",
        `${names.session}=${previous}`,
        null,
      ),
    );
    expect(result.headers.get("location")).toBe(`${app}/login?error=link`);
    expect(s.flow.completeFlow).not.toHaveBeenCalled();
    expect(result.headers.get("set-cookie")).toBeNull();
  });
  it("preserves an existing application session when a callback fails before replacement", async () => {
    const s = setup();
    s.flow.completeFlow.mockRejectedValue(Error("private-callback-secret"));
    const result = await s.http.callback(callback());
    expect(result.status).toBe(303);
    expect(result.headers.get("location")).toBe(`${app}/login?error=link`);
    expect(result.headers.get("set-cookie")).toBeNull();
    expect(s.sessions.revoke).not.toHaveBeenCalled();
    expect(await result.text()).not.toContain("private-callback-secret");
    assertPrivate(result);
  });
  it.each([
    null,
    { ...profile, status: "suspended" as const },
    { ...profile, externalSubject: "another-subject" },
  ])(
    "does not issue a session for an unapproved application mapping (%#)",
    async (found) => {
      const s = setup();
      s.profiles.findByIdentity.mockResolvedValue(found);
      const result = await s.http.callback(callback());
      expect(result.headers.get("location")).toBe(`${app}/login?error=link`);
      expect(s.sessions.issue).not.toHaveBeenCalled();
      expect(result.headers.get("set-cookie")).toBeNull();
    },
  );
  it("clears a possibly replaced browser cookie when session issuance fails", async () => {
    const s = setup();
    s.sessions.issue.mockRejectedValue(Error("private-db-secret"));
    const result = await s.http.callback(callback());
    expect(result.headers.get("location")).toBe(`${app}/login?error=link`);
    assertCookie(result, names.session, "");
    expect(result.cookies.get(names.binding)).toBeUndefined();
  });
  it("revokes an issued session if secure cookie installation fails", async () => {
    class BrokenCookies extends EntraCookies {
      override session(...args: Parameters<EntraCookies["session"]>) {
        super.session(...args);
        throw Error("private-install-secret");
      }
    }
    const s = setup(new BrokenCookies());
    s.sessions.revoke.mockRejectedValue(Error("private-revoke-secret"));
    s.telemetry.event.mockImplementation(() => {
      throw Error("private-logger-secret");
    });
    const result = await s.http.callback(callback());
    expect(s.sessions.revoke).toHaveBeenCalledExactlyOnceWith(token, false);
    expect(s.telemetry.event).toHaveBeenCalledExactlyOnceWith(
      "auth.session_cleanup_failed",
      { provider: "entra", status: "unavailable" },
    );
    expect(result.headers.get("location")).toBe(`${app}/login?error=link`);
    assertCookie(result, names.session, "");
    expect(result.headers.get("set-cookie")).not.toContain(token);
    expect(await result.text()).not.toContain("private");
  });
  it("reads identity from the selected cookie only, without falling back to URL credentials", async () => {
    const s = setup();
    expect(
      await s.http.verify(
        request("/portal?token=forged", "GET", `${names.session}=${token}`),
      ),
    ).toEqual(identity);
    expect(
      await s.http.verify(request(`/portal?token=${token}`, "GET")),
    ).toBeNull();
    expect(
      await s.http.verify(request("/portal", "GET", `${names.session}=short`)),
    ).toBeNull();
    expect(s.sessions.verify).toHaveBeenCalledTimes(2);
  });
  it("rejects a forged request host without calling identity dependencies", async () => {
    const s = setup();
    const response = await s.http.callback(
      new Request("https://evil.example.test/auth/entra/callback?code=private"),
    );
    expect(response.status).toBe(403);
    expect(s.flow.completeFlow).not.toHaveBeenCalled();
  });
  it("accepts the configured public Host behind an internal Next listener URL", async () => {
    const s = setup();
    const result = await s.http.callback(
      new Request(
        "http://0.0.0.0:3000/auth/entra/callback?state=synthetic-state&code=synthetic-code",
        {
          headers: {
            host: "app.example.test",
            cookie: `${names.binding}=${binding}`,
          },
        },
      ),
    );
    expect(result.headers.get("location")).toBe(`${app}/portal`);
    assertPrivate(result);
    assertCookie(result, names.session, token);
  });
  it("does not accept a forwarded host in place of the actual configured Host", async () => {
    const s = setup();
    const result = await s.http.start(
      new Request("http://0.0.0.0:3000/auth/entra/start", {
        method: "POST",
        headers: {
          host: "evil.example.test",
          "x-forwarded-host": "app.example.test",
          origin: app,
        },
      }),
    );
    expect(result.status).toBe(403);
    expect(s.flow.start).not.toHaveBeenCalled();
  });
  it("starts recovery with explicit fresh-sign-in purpose and retains existing sessions until callback", async () => {
    const state = setup();
    const response = await state.http.recover(
      request(
        "/auth/entra/recover",
        "POST",
        `${names.binding}=${binding}; ${names.session}=${previous}`,
      ),
    );
    expect(response.status).toBe(303);
    expect(
      new URL(response.headers.get("location")!).searchParams.get("prompt"),
    ).toBe("login");
    expect(state.flow.start).toHaveBeenCalledExactlyOnceWith(
      binding,
      "recovery",
    );
    expect(response.cookies.get(names.session)).toBeUndefined();
    expect(state.sessions.issueRecovery).not.toHaveBeenCalled();
    assertPrivate(response);
  });
  it.each([
    ["/auth/entra/recover", "GET", app, undefined, 405],
    [
      "/auth/entra/recover",
      "POST",
      "https://evil.example.test",
      undefined,
      403,
    ],
    [
      "/auth/entra/recover?email=private@example.test",
      "POST",
      app,
      undefined,
      400,
    ],
    ["/auth/entra/recover", "POST", app, "password=private", 400],
    ["/auth/entra/start", "POST", app, undefined, 400],
  ] as const)(
    "denies invalid recovery initiation %#",
    async (path, method, origin, body, status) => {
      const state = setup(),
        response = await state.http.recover(
          request(path, method, undefined, origin, body),
        );
      expect(response.status).toBe(status);
      expect(state.flow.start).not.toHaveBeenCalled();
      expect(state.sessions.issueRecovery).not.toHaveBeenCalled();
    },
  );
  it.each(["", "&prompt=none", "&prompt=login&prompt=none"])(
    "rejects a recovery producer that omits/ambiguates fresh sign-in %j",
    async (prompt) => {
      const state = setup();
      state.flow.start.mockResolvedValue({
        authorizationUrl: `${authority}/10000000-0000-4000-8000-000000000001/oauth2/v2.0/authorize?state=synthetic${prompt}`,
        browserBinding: binding,
        maxAgeSeconds: 600,
      });
      expect(
        (await state.http.recover(request("/auth/entra/recover"))).status,
      ).toBe(503);
      expect(state.sessions.issueRecovery).not.toHaveBeenCalled();
    },
  );
  it.each(["client", "admin"] as const)(
    "uses persisted recovery purpose for %s callback, with fixed routing",
    async (role) => {
      const state = setup();
      state.flow.completeFlow.mockResolvedValue({
        identity,
        purpose: "recovery",
      });
      state.profiles.findByIdentity.mockResolvedValue({ ...profile, role });
      const response = await state.http.callback(callback());
      expect(state.sessions.issueRecovery).toHaveBeenCalledExactlyOnceWith(
        identity,
        previous,
      );
      expect(state.sessions.issue).not.toHaveBeenCalled();
      expect(response.headers.get("location")).toBe(
        `${app}${role === "admin" ? "/mfa" : "/portal"}`,
      );
      expect(await response.text()).not.toContain("password changed");
      assertCookie(response, names.session, token);
    },
  );
  it("rejects unrecognized completed flow purposes before replacing a cookie", async () => {
    const state = setup();
    state.flow.completeFlow.mockResolvedValue({
      identity,
      purpose: "forged" as never,
    });
    const response = await state.http.callback(callback());
    expect(response.headers.get("location")).toBe(`${app}/login?error=link`);
    expect(state.sessions.issue).not.toHaveBeenCalled();
    expect(state.sessions.issueRecovery).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
