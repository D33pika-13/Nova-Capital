import { describe, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { ConfigurationService } from "@/server/configuration-service";
import { RuntimeConfigurationLoader } from "@/server/runtime-configuration";
import { parseEntraMfaKeys } from "@/server/entra-settings";
import { secretKeys } from "@/server/secret-settings";
import { AuthenticationFactory } from "@/server/authentication-factory";
import { StorageFactory } from "@/server/providers/storage-factory";
import type { Database } from "@/server/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
const key = randomBytes(32).toString("base64url");
export const entraProfile = {
  APP_ENV: "test",
  SERVICES_ENABLED: "true",
  APP_URL: "https://app.example.test",
  AUTH_PROVIDER: "entra",
  STORAGE_PROVIDER: "azure",
  DATABASE_URL: "postgresql://test:test@localhost/test",
  SMTP_HOST: "127.0.0.1",
  EMAIL_FROM: "test@example.test",
  SUPPORT_EMAIL: "support@example.test",
  CLAMAV_HOST: "127.0.0.1",
  AZURE_STORAGE_ACCOUNT_NAME: "syntheticnova",
  AZURE_STORAGE_ACCOUNT_RESOURCE_ID:
    "/subscriptions/40000000-0000-4000-8000-000000000004/resourceGroups/synthetic/providers/Microsoft.Storage/storageAccounts/syntheticnova",
  ENTRA_TENANT_ID: "40000000-0000-4000-8000-000000000004",
  ENTRA_CLIENT_ID: "50000000-0000-4000-8000-000000000005",
  ENTRA_TENANT_SUBDOMAIN: "synthetic",
  ENTRA_CLIENT_SECRET: "synthetic-login-client-secret",
  ENTRA_MFA_ISSUER: "Synthetic",
  ENTRA_MFA_ACTIVE_KEY_ID: "current",
  ENTRA_MFA_ENCRYPTION_KEYS: JSON.stringify({ current: key }),
  ENTRA_DIRECTORY_CLIENT_ID: "60000000-0000-4000-8000-000000000006",
  ENTRA_DIRECTORY_CLIENT_SECRET: "synthetic-directory-client-secret",
  ENTRA_RECOVERY_MODE: "hosted_sspr",
};
describe("selected provider configuration", () => {
  it("selects Entra/Azure without any Supabase configuration and preserves disabled local shell", () => {
    const config = new ConfigurationService(entraProfile).get();
    expect(config.AUTH_PROVIDER).toBe("entra");
    expect(config.SUPABASE_URL).toBeUndefined();
    expect(Object.isFrozen(config)).toBe(true);
    expect(
      new ConfigurationService({ AUTH_PROVIDER: "entra" }).get()
        .SERVICES_ENABLED,
    ).toBe(false);
  });
  it.each([
    "ENTRA_TENANT_ID",
    "ENTRA_CLIENT_ID",
    "ENTRA_TENANT_SUBDOMAIN",
    "ENTRA_CLIENT_SECRET",
    "ENTRA_MFA_ISSUER",
    "ENTRA_MFA_ACTIVE_KEY_ID",
    "ENTRA_MFA_ENCRYPTION_KEYS",
    "ENTRA_DIRECTORY_CLIENT_ID",
    "ENTRA_DIRECTORY_CLIENT_SECRET",
    "ENTRA_RECOVERY_MODE",
  ] as const)("requires %s for enabled Entra", (field) => {
    expect(
      () => new ConfigurationService({ ...entraProfile, [field]: "" }),
    ).toThrow(field);
  });
  it("requires Supabase storage credentials independently from Entra identity", () => {
    expect(
      () =>
        new ConfigurationService({
          ...entraProfile,
          STORAGE_PROVIDER: "supabase",
        }),
    ).toThrow("SUPABASE_SERVICE_ROLE_KEY");
    const config = new ConfigurationService({
      ...entraProfile,
      STORAGE_PROVIDER: "supabase",
      SUPABASE_URL: "https://synthetic.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-role",
    }).get();
    expect(config.SUPABASE_PUBLISHABLE_KEY).toBeUndefined();
    expect(() => new StorageFactory(config).create()).toThrow(
      "SUPABASE_SERVICE_ROLE_KEY",
    );
  });
  it.each([
    "http://app.example.test",
    "https://app.example.test/",
    "https://app.example.test/nested",
    "https://user:secret@app.example.test",
  ])("requires a canonical HTTPS origin %s", (APP_URL) =>
    expect(
      () => new ConfigurationService({ ...entraProfile, APP_URL }),
    ).toThrow("APP_URL"),
  );
  it.each([
    "{}",
    JSON.stringify({ unknown: key }),
    JSON.stringify({ current: "bad" }),
    JSON.stringify({ current: key, other: key }),
    `{"current":"${key}","current":"${key}"}`,
    `{"current":"${key}","\\u0063urrent":"${key}"}`,
    JSON.stringify({
      current: key,
      a: randomBytes(32).toString("base64url"),
      b: randomBytes(32).toString("base64url"),
      c: randomBytes(32).toString("base64url"),
    }),
  ])(
    "rejects malformed/ambiguous MFA keyrings %#",
    (ENTRA_MFA_ENCRYPTION_KEYS) => {
      expect(
        () =>
          new ConfigurationService({
            ...entraProfile,
            ENTRA_MFA_ENCRYPTION_KEYS,
          }),
      ).toThrow("ENTRA_MFA_ENCRYPTION_KEYS");
    },
  );
  it("copies and freezes accepted keyrings without relying on object prototypes", () => {
    const ring = parseEntraMfaKeys(
      JSON.stringify({
        current: key,
        old: randomBytes(32).toString("base64url"),
      }),
      "current",
    );
    expect(Object.isFrozen(ring)).toBe(true);
    expect(ring.current).toBe(key);
    expect(Object.getPrototypeOf(ring)).toBeNull();
  });
  it("resolves all Entra secrets atomically from pinned vault references with no environment fallback", async () => {
    const values = Object.fromEntries(
      Object.entries(entraProfile).filter(([name]) =>
        secretKeys.includes(name as (typeof secretKeys)[number]),
      ),
    );
    const env = Object.fromEntries(
      Object.entries(entraProfile).filter(
        ([name]) => !Object.hasOwn(values, name),
      ),
    );
    const refs = Object.fromEntries(
      Object.keys(values).map((name, index) => [
        name,
        `synthetic-${index}/0123456789abcdef0123456789abcdef`,
      ]),
    );
    const vault = { resolve: vi.fn(async () => values) },
      settings = {
        ...env,
        SECRETS_PROVIDER: "azure_key_vault",
        AZURE_KEY_VAULT_URL: "https://synthetic-vault.vault.azure.net",
        AZURE_KEY_VAULT_SECRET_MAP: JSON.stringify(refs),
      };
    const config = await new RuntimeConfigurationLoader(settings, vault).load();
    expect(config.ENTRA_CLIENT_SECRET).toBe(entraProfile.ENTRA_CLIENT_SECRET);
    expect(config.ENTRA_MFA_ENCRYPTION_KEYS).toBe(
      entraProfile.ENTRA_MFA_ENCRYPTION_KEYS,
    );
    expect(vault.resolve).toHaveBeenCalledTimes(1);
    for (const field of [
      "ENTRA_CLIENT_SECRET",
      "ENTRA_DIRECTORY_CLIENT_SECRET",
      "ENTRA_MFA_ENCRYPTION_KEYS",
    ] as const) {
      const blocked = { resolve: vi.fn() };
      await expect(
        new RuntimeConfigurationLoader(
          { ...settings, [field]: entraProfile[field] },
          blocked,
        ).load(),
      ).rejects.toThrow("environment secret forbidden");
      expect(blocked.resolve).not.toHaveBeenCalled();
    }
  });
});

describe("configured identity composition", () => {
  const database: Database = {
    withIdentity: vi.fn(async () => {
      throw Error("unexpected SQL");
    }),
  };
  it("creates independent Entra scopes without a Supabase SDK/session or ambient credential fallback", async () => {
    const sessionClient = vi.fn(),
      request = vi.fn(),
      getToken = vi.fn();
    const factory = new AuthenticationFactory(
      new ConfigurationService(entraProfile).get(),
      database,
      undefined,
      { event: vi.fn() },
      { sessionClient, request, directoryCredential: () => ({ getToken }) },
    );
    const a = await factory.create(
        new Request("https://app.example.test/portal"),
      ),
      b = await factory.create(
        new Request("https://app.example.test/portal", {
          headers: { Cookie: "sb-unselected-token=ignored" },
        }),
      );
    expect(a.identity).not.toBe(b.identity);
    expect(a.auth).not.toBe(b.auth);
    expect(a.entra?.authHttp).toBe(b.entra?.authHttp);
    expect(a.accounts).toBe(b.accounts);
    expect(a.authCallback).toBeNull();
    expect(a.mfa).toBeNull();
    expect(await a.identity.verify()).toBeNull();
    expect(await b.identity.verify()).toBeNull();
    expect(sessionClient).not.toHaveBeenCalled();
    expect(getToken).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
  it("creates a new Supabase session adapter per request and never constructs Entra dependencies", async () => {
    const config = new ConfigurationService({
      ...entraProfile,
      AUTH_PROVIDER: "supabase",
      SUPABASE_URL: "https://synthetic.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-role",
    }).get();
    const sessionClient = vi.fn(
        async () => ({ auth: {} }) as unknown as SupabaseClient,
      ),
      request = vi.fn(),
      directoryCredential = vi.fn();
    const factory = new AuthenticationFactory(
      config,
      database,
      createClient(config.SUPABASE_URL!, config.SUPABASE_SERVICE_ROLE_KEY!),
      { event: vi.fn() },
      { sessionClient, request, directoryCredential },
    );
    const a = await factory.create(new Request("https://app.example.test")),
      b = await factory.create(new Request("https://app.example.test"));
    expect(a.entra).toBeNull();
    expect(a.authCallback).not.toBeNull();
    expect(a.mfa).not.toBeNull();
    expect(a.identity).not.toBe(b.identity);
    expect(sessionClient).toHaveBeenCalledTimes(2);
    expect(directoryCredential).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});
