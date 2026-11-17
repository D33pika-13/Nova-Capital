import { describe, expect, it, vi } from "vitest";
import { EntraAuthority } from "@/server/providers/entra-authority";
import { EntraDiscoveryProvider } from "@/server/providers/entra-discovery";
import { ConfigurationService } from "@/server/configuration-service";

const options = {
  tenantId: "10000000-0000-4000-8000-000000000001",
  clientId: "20000000-0000-4000-8000-000000000002",
  tenantSubdomain: "synthetic",
};
const authority = new EntraAuthority(options);
function metadata(change: Record<string, unknown> = {}) {
  return {
    issuer: authority.issuer,
    authorization_endpoint: `${authority.origin}/${options.tenantId}/oauth2/v2.0/authorize`,
    token_endpoint: `${authority.origin}/${options.tenantId}/oauth2/v2.0/token`,
    end_session_endpoint: `${authority.origin}/${options.tenantId}/oauth2/v2.0/logout`,
    jwks_uri: `${authority.origin}/${options.tenantId}/discovery/v2.0/keys`,
    response_types_supported: ["code", "id_token"],
    response_modes_supported: ["query", "form_post"],
    id_token_signing_alg_values_supported: ["RS256"],
    subject_types_supported: ["pairwise"],
    scopes_supported: ["openid", "profile", "email", "offline_access"],
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      "private_key_jwt",
    ],
    // No PKCE/grant-types advertisement is required in Microsoft metadata.
    ...change,
  };
}
function setup(body = metadata()) {
  const request = vi.fn<typeof fetch>(async () => Response.json(body));
  let now = Date.parse("2026-11-11T00:00:00Z");
  return {
    provider: new EntraDiscoveryProvider(options, request, () => now),
    request,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("Entra discovery security contract", () => {
  it("uses only the configured tenant discovery URL and publishes a minimal immutable snapshot", async () => {
    const { provider, request } = setup(
      metadata({
        userinfo_endpoint: "https://graph.microsoft.com/oidc/userinfo",
        private_extra: "untrusted-private-extra",
      }),
    );
    const result = await provider.load();
    expect(result).toEqual({
      issuer: authority.issuer,
      clientId: options.clientId,
      authorizationEndpoint: metadata().authorization_endpoint,
      tokenEndpoint: metadata().token_endpoint,
      logoutEndpoint: metadata().end_session_endpoint,
      jwksUri: metadata().jwks_uri,
      tokenAuthenticationMethod: "client_secret_post",
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(request.mock.calls[0][0]).toBe(authority.discoveryUrl);
    expect(request.mock.calls[0][1]).toMatchObject({
      method: "GET",
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    expect(JSON.stringify(result)).not.toContain("untrusted-private-extra");
  });
  it("coalesces concurrent requests and reuses only unexpired validated metadata", async () => {
    const { provider, request, advance } = setup();
    const values = await Promise.all(
      Array.from({ length: 10 }, () => provider.load()),
    );
    expect(values.every((value) => value === values[0])).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    advance(299999);
    expect(await provider.load()).toBe(values[0]);
    advance(1);
    expect(await provider.load()).toEqual(values[0]);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("does not serve stale metadata when revalidation fails, and bounds failure retries", async () => {
    const { provider, request, advance } = setup();
    await provider.load();
    advance(300000);
    request.mockResolvedValue(
      new Response("private-server-payload", { status: 503 }),
    );
    await expect(provider.load()).rejects.toMatchObject({
      code: "IDENTITY_DISCOVERY_UNAVAILABLE",
    });
    await expect(provider.load()).rejects.toMatchObject({ status: 503 });
    expect(request).toHaveBeenCalledTimes(2);
    advance(30000);
    request.mockImplementation(async () => Response.json(metadata()));
    await expect(provider.load()).resolves.toMatchObject({
      issuer: authority.issuer,
    });
    expect(request).toHaveBeenCalledTimes(3);
  });
  it.each([
    { issuer: "https://login.microsoftonline.com/common/v2.0" },
    { issuer: `${authority.origin}/{tenantid}/v2.0` },
    { authorization_endpoint: "https://evil.example.test/authorize" },
    { token_endpoint: "https://evil.example.test/token" },
    { end_session_endpoint: "https://evil.example.test/logout" },
    { jwks_uri: "https://evil.example.test/keys" },
    { token_endpoint: `${authority.origin}/common/oauth2/v2.0/token` },
    {
      token_endpoint: `${authority.origin}/another.onmicrosoft.com/oauth2/v2.0/token`,
    },
    { token_endpoint: `${metadata().token_endpoint}?redirect=evil` },
    { response_types_supported: ["id_token"] },
    { response_modes_supported: ["form_post"] },
    { id_token_signing_alg_values_supported: ["HS256"] },
    { subject_types_supported: ["public"] },
    { scopes_supported: ["openid"] },
    { token_endpoint_auth_methods_supported: ["none"] },
    { grant_types_supported: ["password"] },
    { code_challenge_methods_supported: ["plain"] },
    { response_types_supported: ["code", 1] },
    { scopes_supported: Array.from({ length: 129 }, () => "openid") },
  ])(
    "rejects untrusted endpoints or unsupported capabilities (%#)",
    async (change) => {
      const { provider } = setup(metadata(change));
      await expect(provider.load()).rejects.toMatchObject({
        message: "Identity configuration could not be verified.",
        status: 503,
      });
    },
  );
  it("accepts only the configured tenant domain's endpoint aliases", async () => {
    const { provider } = setup(
      metadata({
        token_endpoint: `${authority.origin}/synthetic.onmicrosoft.com/oauth2/v2.0/token`,
        authorization_endpoint: `${authority.origin}/synthetic.onmicrosoft.com/oauth2/v2.0/authorize`,
        end_session_endpoint: `${authority.origin}/synthetic.onmicrosoft.com/oauth2/v2.0/logout`,
        jwks_uri: `${authority.origin}/common/discovery/v2.0/keys`,
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
      }),
    );
    await expect(provider.load()).resolves.toMatchObject({
      tokenEndpoint: `${authority.origin}/synthetic.onmicrosoft.com/oauth2/v2.0/token`,
    });
  });
  it("does not enable incomplete Entra login through runtime configuration", () => {
    expect(
      () =>
        new ConfigurationService({
          APP_ENV: "test",
          AUTH_PROVIDER: "entra",
          SERVICES_ENABLED: "true",
        }),
    ).toThrow("ENTRA_TENANT_ID");
  });
  it.each([
    "http://synthetic.ciamlogin.com",
    "https://evil.example.test",
    "https://synthetic.ciamlogin.com:444",
    "https://user:secret@synthetic.ciamlogin.com",
  ])("rejects endpoint origin substitution (%#)", (origin) => {
    expect(() =>
      authority.endpoint(
        "token",
        `${origin}/${options.tenantId}/oauth2/v2.0/token`,
      ),
    ).toThrow();
  });
  it.each(["#fragment", "?query=value", "/extra"])(
    "rejects endpoint suffixes (%#)",
    (suffix) => {
      expect(() =>
        authority.endpoint(
          "authorize",
          `${metadata().authorization_endpoint}${suffix}`,
        ),
      ).toThrow();
    },
  );
});

describe("Entra discovery transport bounds", () => {
  it.each([
    () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.example.test" },
      }),
    () => new Response("private-error-details", { status: 503 }),
    () => new Response("not-json"),
    () => Response.json(null),
    () => Response.json([]),
    () => new Response("a".repeat(65537)),
  ])(
    "rejects redirects, errors and malformed/oversized responses (%#)",
    async (response) => {
      const request = vi.fn<typeof fetch>(async () => response());
      await expect(
        new EntraDiscoveryProvider(options, request).load(),
      ).rejects.toMatchObject({ code: "IDENTITY_DISCOVERY_UNAVAILABLE" });
      expect(request).toHaveBeenCalledOnce();
    },
  );
  it("aborts a hung fetch and cancels a response arriving after the deadline", async () => {
    let finish!: (response: Response) => void;
    const request = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const provider = new EntraDiscoveryProvider(
      { ...options, timeoutMs: 20 },
      request,
    );
    await expect(provider.load()).rejects.toMatchObject({ status: 503 });
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
    const cancel = vi.fn();
    finish(new Response(new ReadableStream({ cancel })));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  });
  it("cancels a stalled body without publishing partial metadata", async () => {
    const cancel = vi.fn();
    const request = vi.fn<typeof fetch>(
      async () => new Response(new ReadableStream({ cancel })),
    );
    await expect(
      new EntraDiscoveryProvider({ ...options, timeoutMs: 20 }, request).load(),
    ).rejects.toMatchObject({ status: 503 });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
