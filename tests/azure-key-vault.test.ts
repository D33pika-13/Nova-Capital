import { it, expect, vi } from "vitest";
import type { TokenCredential } from "@azure/identity";
import { AzureKeyVaultSecrets } from "@/server/providers/azure-key-vault";
import { RuntimeConfigurationLoader } from "@/server/runtime-configuration";
import { ConfigurationService } from "@/server/config";
const endpoint = "https://synthetic-vault.vault.azure.net";
const version = "0123456789abcdef0123456789abcdef";
const reference = `nova-password/${version}`;
const references = JSON.stringify({ SMTP_PASSWORD: reference });
const settings = { endpoint, references, timeoutMs: 1000 };
const credential: TokenCredential = {
  getToken: async () => ({
    token: "synthetic-vault-token",
    expiresOnTimestamp: Date.now() + 60000,
  }),
};
const bundle = () => ({
  id: `${endpoint}/secrets/${reference}`,
  value: "synthetic-vault-secret",
  attributes: { enabled: true },
});
const env = {
  APP_ENV: "test",
  SECRETS_PROVIDER: "azure_key_vault",
  AZURE_KEY_VAULT_URL: endpoint,
  AZURE_KEY_VAULT_SECRET_MAP: references,
};

it("reads only pinned allowlisted secrets with a fixed HTTPS vault audience and bounded no-redirect requests", async () => {
  const getToken = vi.fn(credential.getToken);
  const request = vi.fn<typeof fetch>(async (url, input) => {
    expect(url).toBe(`${endpoint}/secrets/${reference}?api-version=2025-07-01`);
    expect(input?.redirect).toBe("error");
    expect(new Headers(input?.headers).get("authorization")).toBe(
      "Bearer synthetic-vault-token",
    );
    return Response.json(bundle());
  });
  const values = await new AzureKeyVaultSecrets(
    settings,
    { getToken },
    request,
  ).resolve();
  expect(values).toEqual({ SMTP_PASSWORD: "synthetic-vault-secret" });
  expect(Object.isFrozen(values)).toBe(true);
  expect(getToken).toHaveBeenCalledExactlyOnceWith(
    "https://vault.azure.net/.default",
    { abortSignal: expect.any(AbortSignal) },
  );
  expect(request).toHaveBeenCalledTimes(1);
});
it("rejects unsafe vault locations, unpinned references and configuration or identity overrides before I/O", async () => {
  for (const url of [
    "http://synthetic-vault.vault.azure.net",
    "https://user:password@synthetic-vault.vault.azure.net",
    "https://synthetic-vault.vault.azure.net.attacker.test",
    "https://synthetic-vault.vault.azure.net:444",
    `${endpoint}/path`,
    `${endpoint}?query`,
    `${endpoint}/#fragment`,
    "https://127.0.0.1",
  ]) {
    expect(
      () =>
        new AzureKeyVaultSecrets({ ...settings, endpoint: url }, credential),
    ).toThrow(/configuration/);
    await expect(
      new RuntimeConfigurationLoader({
        ...env,
        AZURE_KEY_VAULT_URL: url,
      }).load(),
    ).rejects.toThrow(/AZURE_KEY_VAULT_URL/);
  }
  for (const map of [
    "not-json",
    "{}",
    "[]",
    JSON.stringify({ AUTH_PROVIDER: reference }),
    JSON.stringify({ NEXT_PUBLIC_SECRET: reference }),
    JSON.stringify({ SMTP_PASSWORD: "unversioned-name" }),
    JSON.stringify({ SMTP_PASSWORD: `../secret/${version}` }),
    JSON.stringify({ SMTP_PASSWORD: `${endpoint}/secrets/${reference}` }),
  ]) {
    expect(
      () =>
        new AzureKeyVaultSecrets({ ...settings, references: map }, credential),
    ).toThrow(/AZURE_KEY_VAULT_SECRET_MAP/);
    await expect(
      new RuntimeConfigurationLoader({
        ...env,
        AZURE_KEY_VAULT_SECRET_MAP: map,
      }).load(),
    ).rejects.toThrow(/AZURE_KEY_VAULT_SECRET_MAP/);
  }
});
it("fails closed for disabled, expired, future, malformed or mismatched secrets and never returns partial values", async () => {
  const valid = bundle();
  for (const value of [
    { ...valid, attributes: { enabled: false } },
    { ...valid, attributes: {} },
    { ...valid, attributes: { enabled: true, exp: Date.now() / 1000 - 1 } },
    { ...valid, attributes: { enabled: true, nbf: Date.now() / 1000 + 1000 } },
    { ...valid, attributes: { enabled: true, exp: "forever" } },
    { ...valid, id: `${endpoint}/secrets/nova-password/${"a".repeat(32)}` },
    { ...valid, value: "" },
    { ...valid, value: "x".repeat(16385) },
    { ...valid, value: "bad\0value" },
  ])
    await expect(
      new AzureKeyVaultSecrets(settings, credential, async () =>
        Response.json(value),
      ).resolve(),
    ).rejects.toMatchObject({
      code: "SECRETS_UNAVAILABLE",
      message: "Server secrets could not be verified.",
    });
  let reads = 0;
  const provider = new AzureKeyVaultSecrets(
    {
      ...settings,
      references: JSON.stringify({
        SMTP_PASSWORD: reference,
        OPENAI_API_KEY: `second/${version}`,
      }),
    },
    credential,
    async () => {
      reads++;
      return reads === 1
        ? Response.json(valid)
        : new Response("sensitive denial", { status: 403 });
    },
  );
  await expect(provider.resolve()).rejects.toMatchObject({
    code: "SECRETS_UNAVAILABLE",
  });
  expect(reads).toBe(2);
});
it("redacts token/transport/provider errors and bounds response bytes without retry", async () => {
  for (const response of [
    new Response("provider secret detail", { status: 403 }),
    new Response("x".repeat(65537)),
    new Response("{ invalid synthetic secret detail"),
  ]) {
    const request = vi.fn<typeof fetch>(async () => response);
    await expect(
      new AzureKeyVaultSecrets(settings, credential, request).resolve(),
    ).rejects.toMatchObject({
      message: "Server secrets could not be verified.",
    });
    expect(request).toHaveBeenCalledTimes(1);
  }
  for (const getToken of [
    async () => null,
    async () => ({ token: "expired", expiresOnTimestamp: 0 }),
    async () => {
      throw Error("private identity detail");
    },
  ]) {
    const request = vi.fn<typeof fetch>();
    await expect(
      new AzureKeyVaultSecrets(settings, { getToken }, request).resolve(),
    ).rejects.toMatchObject({ code: "SECRETS_UNAVAILABLE" });
    expect(request).not.toHaveBeenCalled();
  }
});
it("aborts stalled credentials and cannot start a secret read after the deadline", async () => {
  let complete:
    | ((token: Awaited<ReturnType<TokenCredential["getToken"]>>) => void)
    | undefined;
  let signal: AbortSignal | undefined;
  const request = vi.fn<typeof fetch>();
  const getToken: TokenCredential["getToken"] = async (_scope, input) => {
    signal = input?.abortSignal as AbortSignal;
    return new Promise((resolve) => {
      complete = resolve;
    });
  };
  await expect(
    new AzureKeyVaultSecrets(
      { ...settings, timeoutMs: 5 },
      { getToken },
      request,
    ).resolve(),
  ).rejects.toMatchObject({ code: "SECRETS_UNAVAILABLE" });
  expect(signal?.aborted).toBe(true);
  complete!({ token: "late-token", expiresOnTimestamp: Date.now() + 60000 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(request).not.toHaveBeenCalled();
});
it("cancels a stalled response stream at the whole-profile deadline", async () => {
  const cancel = vi.fn();
  const request: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        cancel,
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"value":'));
        },
      }),
    );
  await expect(
    new AzureKeyVaultSecrets(
      { ...settings, timeoutMs: 5 },
      credential,
      request,
    ).resolve(),
  ).rejects.toMatchObject({ code: "SECRETS_UNAVAILABLE" });
  expect(cancel).toHaveBeenCalledTimes(1);
});
it("resolves and validates the whole profile once across concurrent loads without mutating environment state", async () => {
  const raw = { ...env };
  const resolve = vi.fn(async () => ({
    SMTP_PASSWORD: "synthetic-resolved-value",
  }));
  const loader = new RuntimeConfigurationLoader(raw, { resolve });
  raw.APP_ENV = "production";
  const [a, b, c] = await Promise.all([
    loader.load(),
    loader.load(),
    loader.load(),
  ]);
  expect(a).toBe(b);
  expect(b).toBe(c);
  expect(Object.isFrozen(a)).toBe(true);
  expect(a.APP_ENV).toBe("test");
  expect(a.SMTP_PASSWORD).toBe("synthetic-resolved-value");
  expect(raw).not.toHaveProperty("SMTP_PASSWORD");
  expect(resolve).toHaveBeenCalledTimes(1);
});
it("caches failures and rejects fallback credentials or provider result overrides", async () => {
  const resolve = vi.fn(async () => {
    throw Error("private failure detail");
  });
  const loader = new RuntimeConfigurationLoader(env, { resolve });
  for (let i = 0; i < 3; i++)
    await expect(loader.load()).rejects.toMatchObject({
      code: "SECRETS_UNAVAILABLE",
      message: "Server secrets could not be verified.",
    });
  expect(resolve).toHaveBeenCalledTimes(1);
  await expect(
    new RuntimeConfigurationLoader(
      { ...env, SMTP_PASSWORD: "forbidden-env-fallback" },
      { resolve },
    ).load(),
  ).rejects.toThrow(/environment secret forbidden/);
  expect(resolve).toHaveBeenCalledTimes(1);
  for (const values of [
    {},
    { SMTP_PASSWORD: "value", AUTH_PROVIDER: "evil" },
    { DATABASE_URL: "postgresql://synthetic:synthetic@localhost/test" },
  ] as Record<string, string>[])
    await expect(
      new RuntimeConfigurationLoader(env, {
        resolve: async () => values,
      }).load(),
    ).rejects.toThrow(/secret result mismatch/);
  await expect(
    new RuntimeConfigurationLoader(
      { ...env, APP_ENV: "production", AZURE_CREDENTIAL_MODE: "azure_cli" },
      { resolve },
    ).load(),
  ).rejects.toThrow(/managed identity/);
});
it("preserves local environment mode and validates missing vault settings without remote calls", async () => {
  const resolve = vi.fn(async () => ({}));
  const config = await new RuntimeConfigurationLoader(
    { APP_ENV: "test", SMTP_PASSWORD: "synthetic-env" },
    { resolve },
  ).load();
  expect(config.SMTP_PASSWORD).toBe("synthetic-env");
  expect(config.SECRETS_PROVIDER).toBe("env");
  expect(resolve).not.toHaveBeenCalled();
  expect(
    () => new ConfigurationService({ SECRETS_PROVIDER: "azure_key_vault" }),
  ).toThrow(/AZURE_KEY_VAULT_URL/);
  await expect(
    new RuntimeConfigurationLoader(
      { SECRETS_PROVIDER: "azure_key_vault" },
      { resolve },
    ).load(),
  ).rejects.toThrow(/AZURE_KEY_VAULT_SECRET_MAP/);
  await expect(
    new RuntimeConfigurationLoader(
      { NODE_ENV: "production" },
      { resolve },
    ).load(),
  ).rejects.toThrow(/APP_ENV/);
});
it("validates an enabled hybrid service profile only after all pinned secrets resolve", async () => {
  const values: Record<string, string> = {
    database: "postgresql://synthetic:synthetic@localhost/test",
    service: "synthetic-supabase-service-key",
  };
  const map = JSON.stringify({
    DATABASE_URL: `database/${version}`,
    SUPABASE_SERVICE_ROLE_KEY: `service/${version}`,
  });
  const vault = new AzureKeyVaultSecrets(
    { ...settings, references: map },
    credential,
    async (url) => {
      const location = new URL(String(url));
      const name = location.pathname.split("/")[2];
      return Response.json({
        id: `${endpoint}/secrets/${name}/${version}`,
        value: values[name],
        attributes: { enabled: true },
      });
    },
  );
  const profile = await new RuntimeConfigurationLoader(
    {
      ...env,
      AZURE_KEY_VAULT_SECRET_MAP: map,
      SERVICES_ENABLED: "true",
      SUPABASE_URL: "https://synthetic.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "synthetic-public",
      SMTP_HOST: "127.0.0.1",
      EMAIL_FROM: "sender@example.test",
      SUPPORT_EMAIL: "support@example.test",
      CLAMAV_HOST: "127.0.0.1",
    },
    vault,
  ).load();
  expect(profile.SERVICES_ENABLED).toBe(true);
  expect(profile.DATABASE_URL).toBe(values.database);
  expect(profile.SUPABASE_SERVICE_ROLE_KEY).toBe(values.service);
  expect(profile.AUTH_PROVIDER).toBe("supabase");
  expect(profile.EMAIL_PROVIDER).toBe("smtp");
});
