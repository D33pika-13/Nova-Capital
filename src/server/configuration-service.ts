import "server-only";
import { z } from "zod";
import { parseMonitorConnection } from "./monitor-settings";
import { parseEntraMfaKeys } from "./entra-settings";
import { ConfigurationError } from "./errors";
import { DatabaseConnectionSettings } from "./database-settings";
import { isKeyVaultEndpoint, parseSecretReferences } from "./secret-settings";
import {
  isAzureOpenAiEndpoint,
  azureOpenAiTokenScopes,
} from "./azure-settings";

const schema = z.object({
  APP_ENV: z
    .enum(["development", "test", "staging", "production"])
    .default("development"),
  APP_URL: z.url().default("http://127.0.0.1:3000"),
  SERVICES_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  AUTH_PROVIDER: z.enum(["supabase", "entra"]).default("supabase"),
  ENTRA_TENANT_ID: z.uuid().optional(),
  ENTRA_CLIENT_ID: z.uuid().optional(),
  ENTRA_TENANT_SUBDOMAIN: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/)
    .optional(),
  ENTRA_CLIENT_SECRET: z
    .string()
    .regex(/^[\x21-\x7e]{16,4096}$/)
    .optional(),
  ENTRA_MFA_ISSUER: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/)
    .optional(),
  ENTRA_MFA_ACTIVE_KEY_ID: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,32}$/)
    .optional(),
  ENTRA_MFA_ENCRYPTION_KEYS: z.string().max(2048).optional(),
  ENTRA_DIRECTORY_CLIENT_ID: z.uuid().optional(),
  ENTRA_DIRECTORY_CLIENT_SECRET: z
    .string()
    .regex(/^[\x21-\x7e]{16,4096}$/)
    .optional(),
  ENTRA_RECOVERY_MODE: z.literal("hosted_sspr").optional(),
  ENTRA_DIRECTORY_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(20000)
    .default(10000),
  ENTRA_DISCOVERY_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(10000)
    .default(5000),
  ENTRA_EXCHANGE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(20000)
    .default(10000),
  DATABASE_PROVIDER: z.literal("postgres").default("postgres"),
  STORAGE_PROVIDER: z.enum(["supabase", "azure"]).default("supabase"),
  EMAIL_PROVIDER: z.literal("smtp").default("smtp"),
  AI_PROVIDER: z.enum(["disabled", "openai", "azure"]).default("disabled"),
  RATE_LIMIT_PROVIDER: z.literal("postgres").default("postgres"),
  OBSERVABILITY_PROVIDER: z
    .enum(["console", "azure_monitor"])
    .default("console"),
  AZURE_MONITOR_CONNECTION_STRING: z.string().max(512).optional(),
  APPLICATION_INSIGHTS_NO_STATSBEAT: z.literal("true").optional(),
  SCHEDULER_PROVIDER: z
    .enum(["local", "external", "database"])
    .default("local"),
  SECRETS_PROVIDER: z.enum(["env", "azure_key_vault"]).default("env"),
  AZURE_KEY_VAULT_URL: z
    .string()
    .max(200)
    .refine(isKeyVaultEndpoint)
    .optional(),
  AZURE_KEY_VAULT_SECRET_MAP: z.string().max(8192).optional(),
  AZURE_KEY_VAULT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(20000)
    .default(10000),
  AZURE_STORAGE_ACCOUNT_NAME: z
    .string()
    .regex(/^[a-z0-9]{3,24}$/)
    .optional(),
  AZURE_STORAGE_ACCOUNT_RESOURCE_ID: z.string().max(300).optional(),
  AZURE_CREDENTIAL_MODE: z
    .enum(["managed_identity", "azure_cli"])
    .default("managed_identity"),
  AZURE_CLIENT_ID: z.uuid().optional(),
  AZURE_STORAGE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(20000)
    .default(10000),
  SUPABASE_URL: z.url().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  DATABASE_URL: z.url().max(16384).optional(),
  DATABASE_TLS_MODE: z.enum(["verify_full", "disable"]).default("verify_full"),
  DATABASE_CA_CERT: z.string().max(65536).optional(),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_ALLOW_INSECURE_LOCAL: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  EMAIL_FROM: z.email().optional(),
  SUPPORT_EMAIL: z.email().optional(),
  EDUCATION_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  CONTACT_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  CONTACT_HASH_SECRET: z.string().min(32).max(256).optional(),
  CONTACT_CLIENT_IP_HEADER: z.enum(["none", "x-real-ip"]).default("none"),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).max(200).optional(),
  AZURE_OPENAI_ENDPOINT: z
    .string()
    .max(200)
    .refine(isAzureOpenAiEndpoint)
    .optional(),
  AZURE_OPENAI_DEPLOYMENT: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
    .optional(),
  AZURE_OPENAI_API_VERSION: z.literal("v1").default("v1"),
  AZURE_OPENAI_TOKEN_SCOPE: z
    .enum(azureOpenAiTokenScopes)
    .default("https://cognitiveservices.azure.com/.default"),
  SUPPORT_AI_DAILY_REQUEST_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(1000),
  SUPPORT_AI_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(20000)
    .default(8000),
  SUPPORT_AI_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .min(64)
    .max(1024)
    .default(256),
  OFFER_IMAGE_BUCKET: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9-]+$/)
    .default("offer-images"),
  OFFER_IMAGE_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(5242880)
    .default(5242880),
  IMAGE_PROCESSING_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(500)
    .max(10000)
    .default(5000),
  REPORT_BUCKET: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9-]+$/)
    .default("client-reports"),
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(10485760)
    .default(5242880),
  DOWNLOAD_TTL_SECONDS: z.coerce.number().int().min(10).max(120).default(60),
  REPORT_TIME_ZONE: z
    .string()
    .default("Asia/Kolkata")
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }),
  MALWARE_SCANNER_PROVIDER: z.literal("clamav").default("clamav"),
  CLAMAV_HOST: z.string().min(1).max(253).optional(),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
  SCAN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(10000),
  PDF_VALIDATION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(500)
    .max(10000)
    .default(3000),
  MAX_REPORT_PAGES: z.coerce.number().int().min(1).max(2000).default(1000),
  MAINTENANCE_STALE_AFTER_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(86400)
    .default(2700),
  CRON_SECRET: z.string().min(32).max(256).optional(),
});
export type ServerConfig = z.infer<typeof schema>;
export class ConfigurationService {
  private readonly value: Readonly<ServerConfig>;
  constructor(env: Record<string, string | undefined>) {
    if (env.NODE_ENV === "production" && !env.APP_ENV)
      throw new ConfigurationError([
        "APP_ENV (required for production runtime)",
      ]);
    const clean = Object.fromEntries(
      Object.entries(env).filter(([, v]) => v !== ""),
    );
    const result = schema.safeParse(clean);
    if (!result.success)
      throw new ConfigurationError([
        ...new Set(result.error.issues.map((i) => String(i.path[0]))),
      ]);
    const c = result.data;
    const missing: string[] = [];
    if (c.OBSERVABILITY_PROVIDER === "azure_monitor") {
      if (!c.AZURE_MONITOR_CONNECTION_STRING)
        missing.push("AZURE_MONITOR_CONNECTION_STRING");
      else parseMonitorConnection(c.AZURE_MONITOR_CONNECTION_STRING);
      if (c.APPLICATION_INSIGHTS_NO_STATSBEAT !== "true")
        missing.push("APPLICATION_INSIGHTS_NO_STATSBEAT");
    }

    if (c.DATABASE_URL)
      new DatabaseConnectionSettings({
        url: c.DATABASE_URL,
        environment: c.APP_ENV,
        tlsMode: c.DATABASE_TLS_MODE,
        caCertificate: c.DATABASE_CA_CERT,
      });
    if (
      c.DATABASE_TLS_MODE === "disable" &&
      !["development", "test"].includes(c.APP_ENV)
    )
      missing.push(
        "DATABASE_TLS_MODE (verified TLS required for hosted environments)",
      );
    if (
      c.SMTP_ALLOW_INSECURE_LOCAL &&
      (!["development", "test"].includes(c.APP_ENV) ||
        !["localhost", "127.0.0.1", "::1", "mail", "mailpit"].includes(
          c.SMTP_HOST ?? "",
        ) ||
        c.SMTP_USER ||
        c.SMTP_PASSWORD)
    )
      missing.push(
        "SMTP_ALLOW_INSECURE_LOCAL (unauthenticated local mail capture only)",
      );
    if (c.OFFER_IMAGE_BUCKET === c.REPORT_BUCKET)
      missing.push("OFFER_IMAGE_BUCKET (must differ from REPORT_BUCKET)");
    if (c.APP_ENV === "staging" || c.APP_ENV === "production") {
      if (!c.SERVICES_ENABLED) missing.push("SERVICES_ENABLED");
      if (c.SUPABASE_URL && new URL(c.SUPABASE_URL).protocol !== "https:")
        missing.push("SUPABASE_URL (HTTPS required)");
      if (new URL(c.APP_URL).protocol !== "https:")
        missing.push("APP_URL (HTTPS required)");
    }
    if (c.SERVICES_ENABLED) {
      for (const key of [
        "DATABASE_URL",
        "SMTP_HOST",
        "EMAIL_FROM",
        "SUPPORT_EMAIL",
        "CLAMAV_HOST",
      ] as const) {
        if (!c[key]) missing.push(key);
      }
    }
    if (
      c.SERVICES_ENABLED &&
      (c.AUTH_PROVIDER === "supabase" || c.STORAGE_PROVIDER === "supabase")
    ) {
      for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const)
        if (!c[key]) missing.push(key);
      if (c.AUTH_PROVIDER === "supabase" && !c.SUPABASE_PUBLISHABLE_KEY)
        missing.push("SUPABASE_PUBLISHABLE_KEY");
    }
    if (c.SERVICES_ENABLED && c.AUTH_PROVIDER === "entra") {
      for (const key of [
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
      ] as const)
        if (!c[key]) missing.push(key);
      const url = new URL(c.APP_URL);
      if (url.protocol !== "https:" || url.origin !== c.APP_URL)
        missing.push("APP_URL (canonical HTTPS origin required for Entra)");
      if (c.ENTRA_MFA_ENCRYPTION_KEYS && c.ENTRA_MFA_ACTIVE_KEY_ID)
        parseEntraMfaKeys(
          c.ENTRA_MFA_ENCRYPTION_KEYS,
          c.ENTRA_MFA_ACTIVE_KEY_ID,
        );
    }
    if (c.CONTACT_ENABLED || c.EDUCATION_ENABLED) {
      if (!c.SERVICES_ENABLED)
        missing.push("SERVICES_ENABLED (required for public requests)");
      if (!c.CONTACT_HASH_SECRET) missing.push("CONTACT_HASH_SECRET");
      if (
        (c.APP_ENV === "staging" || c.APP_ENV === "production") &&
        c.CONTACT_CLIENT_IP_HEADER === "none"
      )
        missing.push("CONTACT_CLIENT_IP_HEADER (trusted proxy required)");
    }
    if (c.STORAGE_PROVIDER === "azure") {
      if (!c.AZURE_STORAGE_ACCOUNT_NAME)
        missing.push("AZURE_STORAGE_ACCOUNT_NAME");
      const match = c.AZURE_STORAGE_ACCOUNT_RESOURCE_ID?.match(
        /^\/subscriptions\/([^/]+)\/resourceGroups\/([A-Za-z0-9._()-]{1,90})\/providers\/Microsoft.Storage\/storageAccounts\/([a-z0-9]{3,24})$/,
      );
      if (
        !match ||
        !z.uuid().safeParse(match[1]).success ||
        match[2].endsWith(".") ||
        match[3] !== c.AZURE_STORAGE_ACCOUNT_NAME
      )
        missing.push("AZURE_STORAGE_ACCOUNT_RESOURCE_ID");
      for (const key of ["REPORT_BUCKET", "OFFER_IMAGE_BUCKET"] as const)
        if (
          !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(c[key]) ||
          c[key].includes("--")
        )
          missing.push(key + " (invalid Azure container)");
    }
    if (c.AI_PROVIDER === "openai") {
      if (!c.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
      if (!c.OPENAI_MODEL) missing.push("OPENAI_MODEL");
    }
    if (c.AI_PROVIDER === "azure") {
      if (!c.AZURE_OPENAI_ENDPOINT) missing.push("AZURE_OPENAI_ENDPOINT");
      if (!c.AZURE_OPENAI_DEPLOYMENT) missing.push("AZURE_OPENAI_DEPLOYMENT");
    }
    if (c.SECRETS_PROVIDER === "azure_key_vault") {
      if (!c.AZURE_KEY_VAULT_URL) missing.push("AZURE_KEY_VAULT_URL");
      if (!c.AZURE_KEY_VAULT_SECRET_MAP)
        missing.push("AZURE_KEY_VAULT_SECRET_MAP");
      else parseSecretReferences(c.AZURE_KEY_VAULT_SECRET_MAP);
    }
    if (
      (c.STORAGE_PROVIDER === "azure" ||
        c.AI_PROVIDER === "azure" ||
        c.OBSERVABILITY_PROVIDER === "azure_monitor" ||
        c.SECRETS_PROVIDER === "azure_key_vault") &&
      c.AZURE_CREDENTIAL_MODE === "azure_cli" &&
      !["development", "test"].includes(c.APP_ENV)
    )
      missing.push(
        "AZURE_CREDENTIAL_MODE (managed identity required for hosted environments)",
      );
    if (c.SCHEDULER_PROVIDER === "external" && !c.CRON_SECRET)
      missing.push("CRON_SECRET");
    if (missing.length) throw new ConfigurationError(missing);
    this.value = Object.freeze(c);
  }
  get(): Readonly<ServerConfig> {
    return this.value;
  }
}
