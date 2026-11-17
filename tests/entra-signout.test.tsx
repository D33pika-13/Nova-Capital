import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EntraLogoutDestination } from "@/server/providers/entra-logout-destination";
import {
  EntraHttp,
  type EntraBrowserFlow,
  type EntraBrowserSessions,
} from "@/server/entra-http";
import {
  EntraCookies,
  entraCookieNames as names,
} from "@/server/providers/entra-cookies";
import { EntraLogoutForm } from "@/components/entra-logout-form";
import type { OidcMetadata } from "@/server/modules/identity/oidc-login-contracts";
const tenant = "40000000-0000-4000-8000-000000000004",
  client = "50000000-0000-4000-8000-000000000005",
  app = "https://app.example.test",
  authority = "https://synthetic.ciamlogin.com";
const endpoint = `${authority}/${tenant}/oauth2/v2.0/logout`,
  destination = `${endpoint}?${new URLSearchParams({ post_logout_redirect_uri: `${app}/login` })}`;
const options = {
  tenantId: tenant,
  clientId: client,
  tenantSubdomain: "synthetic",
  applicationOrigin: app,
};
const metadata: OidcMetadata = {
  issuer: `${authority}/${tenant}/v2.0`,
  clientId: client,
  authorizationEndpoint: `${authority}/${tenant}/oauth2/v2.0/authorize`,
  tokenEndpoint: `${authority}/${tenant}/oauth2/v2.0/token`,
  jwksUri: `${authority}/${tenant}/discovery/v2.0/keys`,
  logoutEndpoint: endpoint,
  tokenAuthenticationMethod: "client_secret_post",
};
function setup(value = destination, include = true) {
  const order: string[] = [];
  const resolver = {
    load: vi.fn(async () => {
      order.push("destination");
      return value;
    }),
  };
  const sessions: EntraBrowserSessions = {
    issue: vi.fn(),
    issueRecovery: vi.fn(),
    verify: vi.fn(),
    revoke: vi.fn(async () => {
      order.push("revoked");
    }),
  };
  const flow: EntraBrowserFlow = { start: vi.fn(), completeFlow: vi.fn() };
  return {
    resolver,
    sessions,
    order,
    http: new EntraHttp(
      flow,
      sessions,
      { findByIdentity: vi.fn() },
      new EntraCookies(),
      { event: vi.fn() },
      { applicationOrigin: app, authorityOrigin: authority },
      include ? resolver : undefined,
    ),
  };
}
function request(
  path = "/auth/entra/logout",
  headers: Record<string, string> = {},
  method = "POST",
  body?: string,
) {
  return new Request(`${app}${path}`, {
    method,
    headers: {
      Origin: app,
      Cookie: `${names.session}=${"p".repeat(43)}`,
      ...headers,
    },
    body,
  });
}
function privateResponse(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.has("x-middleware-set-cookie")).toBe(false);
}

describe("validated browser provider sign-out", () => {
  it.each([
    endpoint,
    `${authority}/synthetic.onmicrosoft.com/oauth2/v2.0/logout`,
  ])(
    "builds only a fixed registered return URI from approved metadata %s",
    async (logoutEndpoint) => {
      const load = vi.fn(async () => ({ ...metadata, logoutEndpoint })),
        resolver = new EntraLogoutDestination({ load }, options);
      const url = new URL(await resolver.load());
      expect(`${url.origin}${url.pathname}`).toBe(logoutEndpoint);
      expect(Object.fromEntries(url.searchParams)).toEqual({
        post_logout_redirect_uri: `${app}/login`,
      });
      expect(load).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    { issuer: "https://evil.example.test/v2.0" },
    { clientId: tenant },
    { logoutEndpoint: "https://evil.example.test/logout" },
    { logoutEndpoint: `${authority}/common/oauth2/v2.0/logout` },
    { logoutEndpoint: `${authority}/${client}/oauth2/v2.0/logout` },
    { logoutEndpoint: `${endpoint}?logout_hint=private@example.test` },
    { logoutEndpoint: `${endpoint}#private` },
  ])(
    "rejects wrong scope/destination metadata %# with private errors",
    async (changes) => {
      const resolver = new EntraLogoutDestination(
        { load: async () => ({ ...metadata, ...changes }) },
        options,
      );
      await expect(resolver.load()).rejects.toMatchObject({
        code: "PROVIDER_LOGOUT_UNAVAILABLE",
        message: "Provider sign-out could not be started.",
      });
    },
  );
  it("copies the configured return origin and rejects noncanonical or insecure origins", async () => {
    const settings = { ...options },
      resolver = new EntraLogoutDestination(
        { load: async () => metadata },
        settings,
      );
    settings.applicationOrigin = "https://evil.example.test";
    expect(
      new URL(await resolver.load()).searchParams.get(
        "post_logout_redirect_uri",
      ),
    ).toBe(`${app}/login`);
    for (const applicationOrigin of [
      "http://app.example.test",
      `${app}/`,
      `${app}/other`,
      "https://user:secret@app.example.test",
    ])
      expect(
        () =>
          new EntraLogoutDestination(
            { load: vi.fn() },
            { ...options, applicationOrigin },
          ),
      ).toThrow("ENTRA_LOGOUT_RETURN_URI");
  });
  it("revokes first, clears cookies and directs the browser without claiming provider completion", async () => {
    const state = setup(),
      response = await state.http.logoutBrowser(request());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(destination);
    expect(state.order).toEqual(["revoked", "destination"]);
    expect(state.sessions.revoke).toHaveBeenCalledExactlyOnceWith(
      "p".repeat(43),
      true,
    );
    for (const cookie of response.headers.getSetCookie()) {
      expect(cookie).toContain("Max-Age=0");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("HttpOnly");
    }
    expect(await response.text()).not.toContain("completed");
    privateResponse(response);
  });
  it("does not start provider sign-out when local revocation is unconfirmed", async () => {
    const state = setup();
    vi.mocked(state.sessions.revoke).mockRejectedValue(
      Error("private database secret"),
    );
    const response = await state.http.logoutBrowser(request());
    expect(response.status).toBe(503);
    expect(state.resolver.load).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ code: "LOGOUT_UNAVAILABLE" });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(response.headers.has("location")).toBe(false);
  });
  it("reports local success and provider-initiation failure separately", async () => {
    const state = setup();
    state.resolver.load.mockRejectedValue(Error("private discovery secret"));
    const response = await state.http.logoutBrowser(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "PROVIDER_LOGOUT_UNAVAILABLE",
      applicationSignedOut: true,
    });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(state.order).toEqual(["revoked"]);
    privateResponse(response);
  });
  it("does not silently invent a destination if the dependency is not configured", async () => {
    const state = setup(destination, false),
      response = await state.http.logoutBrowser(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ applicationSignedOut: true });
    expect(response.headers.has("location")).toBe(false);
  });
  it.each([
    "https://evil.example.test/logout",
    `${endpoint}?post_logout_redirect_uri=https%3A%2F%2Fevil.example.test`,
    `${destination}&logout_hint=private@example.test`,
    `${destination}&post_logout_redirect_uri=${encodeURIComponent(`${app}/login`)}`,
    `${destination}#fragment`,
    `${authority}/${tenant}/oauth2/v2.0/authorize?post_logout_redirect_uri=${encodeURIComponent(`${app}/login`)}`,
  ])(
    "rejects unapproved producer response %# after local sign-out",
    async (value) => {
      const state = setup(value),
        response = await state.http.logoutBrowser(request());
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        applicationSignedOut: true,
      });
      expect(response.headers.has("location")).toBe(false);
    },
  );
  it.each<{
    path: string;
    headers?: Record<string, string>;
    method?: string;
    body?: string;
    status: number;
  }>([
    { path: "/auth/entra/logout", method: "GET", status: 405 },
    {
      path: "/auth/entra/logout",
      headers: { Origin: "https://evil.example.test" },
      status: 403,
    },
    {
      path: "/auth/entra/logout",
      headers: { Host: "evil.example.test" },
      status: 403,
    },
    { path: "/auth/entra/logout?next=https://evil.example.test", status: 400 },
    { path: "/auth/entra/logout#fragment", status: 400 },
    { path: "/api/auth/logout", status: 400 },
    { path: "/auth/entra/logout", body: "private-password", status: 400 },
  ])(
    "denies invalid browser sign-out input %# before changing sessions",
    async (value) => {
      const state = setup(),
        response = await state.http.logoutBrowser(
          request(value.path, value.headers, value.method, value.body),
        );
      expect(response.status).toBe(value.status);
      expect(state.sessions.revoke).not.toHaveBeenCalled();
      expect(state.resolver.load).not.toHaveBeenCalled();
      expect(response.headers.has("set-cookie")).toBe(false);
    },
  );
  it("renders a native same-origin navigation form without credentials or external URLs", () => {
    const html = renderToStaticMarkup(<EntraLogoutForm />);
    expect(html).toContain('action="/auth/entra/logout"');
    expect(html).toContain('method="post"');
    expect(html).not.toContain("<input");
    expect(html).not.toContain(authority);
  });
});
