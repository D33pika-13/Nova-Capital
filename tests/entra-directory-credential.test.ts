import { describe, it, expect, vi } from "vitest";
import type { TokenCredential } from "@azure/identity";
import { EntraDirectoryCredential } from "@/server/providers/entra-directory-credential";
import { ConfigurationError } from "@/server/errors";
const tenant = "40000000-0000-4000-8000-000000000004",
  client = "50000000-0000-4000-8000-000000000005";
const settings = {
  tenantId: tenant,
  clientId: client,
  clientSecret: "synthetic-directory-secret-not-real",
};
describe("tenant-bound Graph application credential", () => {
  it("constructs one explicit credential with no ambient fallback and pins Graph scope/tenant", async () => {
    const getToken = vi.fn<TokenCredential["getToken"]>(async () => ({
      token: "synthetic",
      expiresOnTimestamp: Date.now() + 60000,
    }));
    const build = vi.fn(() => ({ getToken }));
    const credential = new EntraDirectoryCredential(settings, build);
    expect(build).toHaveBeenCalledExactlyOnceWith(
      tenant,
      client,
      settings.clientSecret,
      {
        authorityHost: "https://login.microsoftonline.com",
        additionallyAllowedTenants: [],
        retryOptions: { maxRetries: 0 },
        loggingOptions: {
          allowLoggingAccountIdentifiers: false,
          enableUnsafeSupportLogging: false,
        },
      },
    );
    const controller = new AbortController();
    await credential.getToken(["https://graph.microsoft.com/.default"], {
      abortSignal: controller.signal,
    });
    expect(getToken).toHaveBeenCalledExactlyOnceWith(
      "https://graph.microsoft.com/.default",
      { abortSignal: controller.signal, tenantId: tenant },
    );
  });
  it.each([
    "https://vault.azure.net/.default",
    "https://graph.microsoft.com/User.Read",
    [],
    ["https://graph.microsoft.com/.default", "extra"],
  ])("rejects another audience %# before SDK use", async (scope) => {
    const getToken = vi.fn();
    const credential = new EntraDirectoryCredential(settings, () => ({
      getToken,
    }));
    await expect(credential.getToken(scope)).rejects.toMatchObject({
      code: "DIRECTORY_CREDENTIAL_SCOPE",
    });
    expect(getToken).not.toHaveBeenCalled();
  });
  it("rejects cross-tenant overrides, cancellation and failed SDK credentials without fallback", async () => {
    const getToken = vi.fn<TokenCredential["getToken"]>(async () => {
        throw Error("synthetic SDK failure");
      }),
      build = vi.fn(() => ({ getToken })),
      credential = new EntraDirectoryCredential(settings, build);
    await expect(
      credential.getToken("https://graph.microsoft.com/.default", {
        tenantId: client,
      }),
    ).rejects.toMatchObject({ code: "DIRECTORY_CREDENTIAL_SCOPE" });
    expect(getToken).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    await expect(
      credential.getToken("https://graph.microsoft.com/.default", {
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(getToken).not.toHaveBeenCalled();
    await expect(
      credential.getToken("https://graph.microsoft.com/.default"),
    ).rejects.toThrow("synthetic SDK failure");
    expect(build).toHaveBeenCalledTimes(1);
    expect(getToken).toHaveBeenCalledTimes(1);
  });
  it.each([
    { tenantId: "common" },
    { clientId: "bad" },
    { clientSecret: "short" },
    { clientSecret: "bad\nsecret-long-enough" },
  ])(
    "rejects invalid settings %# before credential construction",
    (invalid) => {
      const build = vi.fn(() => ({ getToken: vi.fn() }));
      expect(
        () => new EntraDirectoryCredential({ ...settings, ...invalid }, build),
      ).toThrow(ConfigurationError);
      expect(build).not.toHaveBeenCalled();
    },
  );
});
