import { describe, expect, it } from "vitest";
import { ConfigurationService } from "@/server/config";
import { ConfigurationError } from "@/server/errors";
const profile = {
  APP_ENV: "staging",
  APP_URL: "https://staging.example.test",
  SERVICES_ENABLED: "true",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "test-public",
  SUPABASE_SERVICE_ROLE_KEY: "secret-test-value",
  DATABASE_URL: "postgresql://test:test@localhost/test",
  SMTP_HOST: "localhost",
  CLAMAV_HOST: "127.0.0.1",
  EMAIL_FROM: "test@example.test",
  SUPPORT_EMAIL: "support@example.test",
};
describe("provider configuration", () => {
  it("allows explicit local Docker mail capture without permitting remote or authenticated plaintext SMTP", () => {
    expect(
      new ConfigurationService({
        APP_ENV: "test",
        SMTP_HOST: "mail",
        SMTP_ALLOW_INSECURE_LOCAL: "true",
      }).get().SMTP_ALLOW_INSECURE_LOCAL,
    ).toBe(true);
    for (const override of [
      { SMTP_HOST: "smtp.example.test" },
      { APP_ENV: "staging" },
      { SMTP_USER: "synthetic-user" },
      { SMTP_PASSWORD: "synthetic-password" },
    ])
      expect(
        () =>
          new ConfigurationService({
            ...profile,
            APP_ENV: "test",
            SMTP_HOST: "mail",
            SMTP_ALLOW_INSECURE_LOCAL: "true",
            ...override,
          }),
      ).toThrow(/SMTP_ALLOW_INSECURE_LOCAL/);
  });
  it("allows explicit local public-shell mode without fabricated dependencies", () => {
    const c = new ConfigurationService({}).get();
    expect(c.SERVICES_ENABLED).toBe(false);
    expect(c.AI_PROVIDER).toBe("disabled");
    expect(Object.isFrozen(c)).toBe(true);
  });
  it("rejects disabled services in production", () => {
    expect(
      () =>
        new ConfigurationService({
          APP_ENV: "production",
          APP_URL: "https://example.test",
        }),
    ).toThrow(ConfigurationError);
  });
  it("rejects unsupported providers instead of falling back", () => {
    expect(() => new ConfigurationService({ AUTH_PROVIDER: "azure" })).toThrow(
      /AUTH_PROVIDER/,
    );
  });
  it("requires credentials when services are enabled", () => {
    expect(
      () => new ConfigurationService({ SERVICES_ENABLED: "true" }),
    ).toThrow(/DATABASE_URL/);
  });
  it("accepts a complete staging profile", () => {
    expect(new ConfigurationService(profile).get().SERVICES_ENABLED).toBe(true);
  });
  it("requires HTTPS in staging", () => {
    expect(
      () =>
        new ConfigurationService({
          ...profile,
          APP_URL: "http://example.test",
        }),
    ).toThrow(/HTTPS/);
  });
  it("requires both model and key for enabled AI", () => {
    expect(() => new ConfigurationService({ AI_PROVIDER: "openai" })).toThrow(
      /OPENAI_MODEL/,
    );
  });
  it("never includes secret values in validation errors", () => {
    try {
      new ConfigurationService({
        ...profile,
        DATABASE_URL: "private-broken-connection",
      });
    } catch (error) {
      expect(String(error)).not.toContain("private-broken");
      expect(String(error)).not.toContain("secret-test-value");
    }
  });
  it("bounds signed-download lifetime", () => {
    expect(
      () => new ConfigurationService({ DOWNLOAD_TTL_SECONDS: "3600" }),
    ).toThrow(/DOWNLOAD_TTL_SECONDS/);
  });
  it("requires a scanner host and disallows a disabled scanner provider", () => {
    expect(
      () => new ConfigurationService({ ...profile, CLAMAV_HOST: "" }),
    ).toThrow(/CLAMAV_HOST/);
    expect(
      () => new ConfigurationService({ MALWARE_SCANNER_PROVIDER: "disabled" }),
    ).toThrow(/MALWARE_SCANNER_PROVIDER/);
  });
  it("validates report timezone and remote HTTPS configuration", () => {
    expect(
      () => new ConfigurationService({ REPORT_TIME_ZONE: "Invalid/Zone" }),
    ).toThrow(/REPORT_TIME_ZONE/);
    expect(
      () =>
        new ConfigurationService({
          ...profile,
          SUPABASE_URL: "http://remote.example.test",
        }),
    ).toThrow(/HTTPS/);
  });
});

it("bounds scheduler credentials and requires them for external execution", () => {
  expect(
    () => new ConfigurationService({ SCHEDULER_PROVIDER: "external" }),
  ).toThrow(/CRON_SECRET/);
  expect(
    () => new ConfigurationService({ CRON_SECRET: "x".repeat(257) }),
  ).toThrow(/CRON_SECRET/);
  expect(
    new ConfigurationService({
      SCHEDULER_PROVIDER: "external",
      CRON_SECRET: "x".repeat(32),
    }).get().SCHEDULER_PROVIDER,
  ).toBe("external");
});

it("keeps image/report storage separate and bounds image upload/processing settings", () => {
  expect(
    () => new ConfigurationService({ OFFER_IMAGE_BUCKET: "client-reports" }),
  ).toThrow(/OFFER_IMAGE_BUCKET/);
  expect(
    () => new ConfigurationService({ OFFER_IMAGE_MAX_BYTES: "5242881" }),
  ).toThrow(/OFFER_IMAGE_MAX_BYTES/);
  expect(
    () => new ConfigurationService({ IMAGE_PROCESSING_TIMEOUT_MS: "10001" }),
  ).toThrow(/IMAGE_PROCESSING_TIMEOUT_MS/);
  expect(new ConfigurationService({}).get().OFFER_IMAGE_BUCKET).toBe(
    "offer-images",
  );
});
it("requires explicit contact enablement, a private hash key and a configured trusted proxy in hosted environments", () => {
  expect(new ConfigurationService({}).get().CONTACT_ENABLED).toBe(false);
  expect(
    () => new ConfigurationService({ ...profile, CONTACT_ENABLED: "true" }),
  ).toThrow(/CONTACT_HASH_SECRET/);
  expect(
    () =>
      new ConfigurationService({
        ...profile,
        CONTACT_ENABLED: "true",
        CONTACT_HASH_SECRET: "x".repeat(32),
      }),
  ).toThrow(/CONTACT_CLIENT_IP_HEADER/);
  expect(
    new ConfigurationService({
      ...profile,
      CONTACT_ENABLED: "true",
      CONTACT_HASH_SECRET: "x".repeat(32),
      CONTACT_CLIENT_IP_HEADER: "x-real-ip",
    }).get().CONTACT_ENABLED,
  ).toBe(true);
  expect(
    () =>
      new ConfigurationService({
        CONTACT_ENABLED: "true",
        CONTACT_HASH_SECRET: "x".repeat(32),
      }),
  ).toThrow(/SERVICES_ENABLED/);
});
it("bounds AI support deadlines, daily allowance and output tokens without selecting a model implicitly", () => {
  for (const settings of [
    { SUPPORT_AI_TIMEOUT_MS: "20001" },
    { SUPPORT_AI_MAX_OUTPUT_TOKENS: "1025" },
    { SUPPORT_AI_DAILY_REQUEST_LIMIT: "10001" },
  ])
    expect(() => new ConfigurationService(settings)).toThrow();
  expect(new ConfigurationService({}).get().OPENAI_MODEL).toBeUndefined();
});

it("selects a hybrid Azure storage profile with explicit account identity and hosted managed credentials", () => {
  const azure = {
    ...profile,
    STORAGE_PROVIDER: "azure",
    AZURE_STORAGE_ACCOUNT_NAME: "syntheticnova",
    AZURE_STORAGE_ACCOUNT_RESOURCE_ID:
      "/subscriptions/10000000-0000-4000-8000-000000000001/resourceGroups/rg-test/providers/Microsoft.Storage/storageAccounts/syntheticnova",
  };
  const config = new ConfigurationService(azure).get();
  expect(config.AUTH_PROVIDER).toBe("supabase");
  expect(config.STORAGE_PROVIDER).toBe("azure");
  expect(config.AZURE_CREDENTIAL_MODE).toBe("managed_identity");
  for (const change of [
    { AZURE_STORAGE_ACCOUNT_NAME: "differentaccount" },
    { AZURE_STORAGE_ACCOUNT_RESOURCE_ID: "https://attacker.example.test" },
    { AZURE_CREDENTIAL_MODE: "azure_cli" },
    { REPORT_BUCKET: "public--reports" },
    { OFFER_IMAGE_BUCKET: "Images" },
    { AZURE_STORAGE_TIMEOUT_MS: "20001" },
    { AZURE_CLIENT_ID: "not-a-uuid" },
  ])
    expect(() => new ConfigurationService({ ...azure, ...change })).toThrow(
      ConfigurationError,
    );
  expect(
    new ConfigurationService({
      ...azure,
      APP_ENV: "test",
      AZURE_CREDENTIAL_MODE: "azure_cli",
    }).get().AZURE_CREDENTIAL_MODE,
  ).toBe("azure_cli");
});

it("selects direct database scheduling without an HTTP shared secret", () => {
  expect(
    new ConfigurationService({ SCHEDULER_PROVIDER: "database" }).get()
      .SCHEDULER_PROVIDER,
  ).toBe("database");
});
