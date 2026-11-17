import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { AuthCallbackService } from "@/server/modules/identity/callback-service";
import { SupabaseCallbackProvider } from "@/server/providers/supabase-callback";
import type { RateLimiter } from "@/server/contracts";

function setup(allowed = true) {
  const provider = {
    exchangeCode: vi.fn(async () => {}),
    verifyLink: vi.fn(async () => {}),
  };
  const limits = {
    consume: vi.fn<RateLimiter["consume"]>(async () => allowed),
  };
  return {
    provider,
    limits,
    service: new AuthCallbackService(provider, limits),
  };
}

describe("authentication callback boundary", () => {
  it.each(["invite", "recovery"] as const)(
    "accepts a single %s link for password setup",
    async (type) => {
      const { service, provider, limits } = setup();
      expect(
        await service.complete(
          new URLSearchParams({ token_hash: "synthetic-link-secret", type }),
        ),
      ).toEqual({ redirect: "/password" });
      expect(provider.verifyLink).toHaveBeenCalledExactlyOnceWith(
        "synthetic-link-secret",
        type,
      );
      expect(provider.exchangeCode).not.toHaveBeenCalled();
      expect(JSON.stringify(limits.consume.mock.calls)).not.toContain(
        "synthetic-link-secret",
      );
      expect(limits.consume.mock.calls[1][0]).toMatch(
        /^auth:callback:[a-f0-9]{64}$/,
      );
    },
  );
  it.each([undefined, "/portal", "/password"])(
    "exchanges a PKCE code with safe next=%s",
    async (next) => {
      const { service, provider } = setup();
      const query = new URLSearchParams({ code: "synthetic-code" });
      if (next) query.set("next", next);
      expect(await service.complete(query)).toEqual({
        redirect: next === "/password" ? "/password" : "/portal",
      });
      expect(provider.exchangeCode).toHaveBeenCalledExactlyOnceWith(
        "synthetic-code",
      );
      expect(provider.verifyLink).not.toHaveBeenCalled();
    },
  );
  it.each([
    "",
    "code=",
    "token_hash=x",
    "token_hash=x&type=email",
    "code=x&type=invite",
    "code=x&token_hash=y&type=invite",
    "code=x&code=y",
    "token_hash=x&type=invite&type=recovery",
    "code=x&next=%2Fpassword&next=%2Fportal",
    "code=x&next=https%3A%2F%2Fevil.example.test",
    "code=x&next=%2F%2Fevil.example.test",
    "code=x&role=admin",
    "code=a%0Ab",
    "code=a+b",
    `code=${"a".repeat(2049)}`,
    `code=x&unknown=${"a".repeat(4096)}`,
  ])(
    "rejects malformed or ambiguous input before contacting dependencies (%#)",
    async (query) => {
      const { service, provider, limits } = setup();
      await expect(
        service.complete(new URLSearchParams(query)),
      ).rejects.toMatchObject({ code: "INVALID_AUTH_LINK" });
      expect(provider.exchangeCode).not.toHaveBeenCalled();
      expect(provider.verifyLink).not.toHaveBeenCalled();
      expect(limits.consume).not.toHaveBeenCalled();
    },
  );
  it("denies throttled callbacks without consuming a provider credential", async () => {
    const { service, provider } = setup(false);
    await expect(
      service.complete(new URLSearchParams({ code: "synthetic-code" })),
    ).rejects.toMatchObject({ status: 429 });
    expect(provider.exchangeCode).not.toHaveBeenCalled();
  });
  it("preserves a validated PKCE flow identifier", async () => {
    const { service, provider } = setup();
    await service.complete(
      new URLSearchParams({
        code: "synthetic-code",
        sb_flow_id: "synthetic-flow",
      }),
    );
    expect(provider.exchangeCode).toHaveBeenCalledExactlyOnceWith(
      "synthetic-code",
      "synthetic-flow",
    );
  });
  it.each([
    "code=x&sb_flow_id=short",
    "code=x&sb_flow_id=synthetic-flow&sb_flow_id=another-flow",
    "token_hash=x&type=invite&sb_flow_id=synthetic-flow",
  ])("rejects an invalid or ambiguous flow identifier (%#)", async (query) => {
    const { service, provider } = setup();
    await expect(
      service.complete(new URLSearchParams(query)),
    ).rejects.toMatchObject({ code: "INVALID_AUTH_LINK" });
    expect(provider.exchangeCode).not.toHaveBeenCalled();
    expect(provider.verifyLink).not.toHaveBeenCalled();
  });
  it("does not expose provider failures or the callback credential", async () => {
    const { service, provider } = setup();
    provider.exchangeCode.mockRejectedValue(
      new Error("private-provider-payload synthetic-code"),
    );
    await expect(
      service.complete(new URLSearchParams({ code: "synthetic-code" })),
    ).rejects.toMatchObject({
      message: "This secure link is invalid or expired.",
    });
  });
});

describe("Supabase callback SDK contract", () => {
  const user = {
    id: "00000000-0000-4000-8000-000000000001",
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic@example.test",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
  function sdk(body: unknown, status = 200) {
    const request = vi.fn<typeof fetch>(async () =>
      Response.json(body, { status }),
    );
    const storage = new Map<string, string>();
    storage.set(
      "nova-callback-test-code-verifier",
      JSON.stringify("synthetic-pkce-verifier"),
    );
    storage.set(
      "nova-callback-test-flow-synthetic-flow-code-verifier",
      JSON.stringify("flow-specific-verifier"),
    );
    const client = createClient(
      "https://synthetic.supabase.co",
      "synthetic-public-key",
      {
        auth: {
          autoRefreshToken: false,
          flowType: "pkce",
          persistSession: true,
          detectSessionInUrl: false,
          storageKey: "nova-callback-test",
          storage: {
            getItem: (key) => storage.get(key) ?? null,
            setItem: (key, value) => {
              storage.set(key, value);
            },
            removeItem: (key) => {
              storage.delete(key);
            },
          },
        },
        global: { fetch: request },
      },
    );
    return { provider: new SupabaseCallbackProvider(client), request };
  }
  const session = {
    access_token: "synthetic-access-token",
    refresh_token: "synthetic-refresh-token",
    expires_in: 3600,
    token_type: "bearer",
    user,
  };
  it("submits recovery hashes only through the OTP endpoint", async () => {
    const { provider, request } = sdk(session);
    await provider.verifyLink("synthetic-token-hash", "recovery");
    const [url, options] = request.mock.calls[0];
    expect(String(url)).toBe("https://synthetic.supabase.co/auth/v1/verify");
    expect(JSON.parse(String(options?.body))).toMatchObject({
      token_hash: "synthetic-token-hash",
      type: "recovery",
    });
  });
  it("uses the SDK's PKCE exchange rather than installing caller session tokens", async () => {
    const { provider, request } = sdk(session);
    await provider.exchangeCode("synthetic-code");
    const [url, options] = request.mock.calls[0];
    expect(String(url)).toBe(
      "https://synthetic.supabase.co/auth/v1/token?grant_type=pkce",
    );
    expect(JSON.parse(String(options?.body))).toMatchObject({
      auth_code: "synthetic-code",
      code_verifier: "synthetic-pkce-verifier",
    });
  });
  it("selects only the requested flow's verifier", async () => {
    const { provider, request } = sdk(session);
    await provider.exchangeCode("synthetic-code", "synthetic-flow");
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({
      code_verifier: "flow-specific-verifier",
    });
  });
  it("does not borrow the legacy verifier when the requested flow is missing", async () => {
    const { provider, request } = sdk(session);
    await expect(
      provider.exchangeCode("synthetic-code", "missing-flow"),
    ).rejects.toMatchObject({ code: "INVALID_AUTH_LINK" });
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    [{ user }, 200],
    [{ error: "otp_expired", message: "synthetic provider secret" }, 403],
  ] as const)(
    "rejects a missing or expired session (%#)",
    async (body, status) => {
      const { provider } = sdk(body, status);
      await expect(
        provider.verifyLink("synthetic-token-hash", "invite"),
      ).rejects.toMatchObject({ code: "INVALID_AUTH_LINK" });
    },
  );
});
