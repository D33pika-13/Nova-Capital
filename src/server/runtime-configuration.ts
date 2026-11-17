import "server-only";
import { z } from "zod";
import {
  ConfigurationService,
  type ServerConfig,
} from "./configuration-service";
import type { SecretProvider } from "./contracts";
import {
  isKeyVaultEndpoint,
  parseSecretReferences,
  secretKeys,
} from "./secret-settings";
import { AppError, ConfigurationError } from "./errors";
import { AzureCredentialFactory } from "./providers/azure-credentials";
import { AzureKeyVaultSecrets } from "./providers/azure-key-vault";
import { EnvironmentSecrets } from "./providers/environment-secrets";
const bootstrapSchema = z.object({
  APP_ENV: z
    .enum(["development", "test", "staging", "production"])
    .default("development"),
  SECRETS_PROVIDER: z.enum(["env", "azure_key_vault"]).default("env"),
  AZURE_CREDENTIAL_MODE: z
    .enum(["managed_identity", "azure_cli"])
    .default("managed_identity"),
  AZURE_CLIENT_ID: z.uuid().optional(),
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
});
export class RuntimeConfigurationLoader {
  private readonly env: Readonly<Record<string, string | undefined>>;
  private pending?: Promise<Readonly<ServerConfig>>;
  constructor(
    env: Record<string, string | undefined>,
    private readonly vault?: SecretProvider,
  ) {
    this.env = Object.freeze(
      Object.fromEntries(
        Object.entries(env).filter(([, value]) => value !== ""),
      ),
    );
  }
  load(): Promise<Readonly<ServerConfig>> {
    // Cache success or failure per server instance. Recovery/rotation requires restart.
    return (this.pending ??= this.resolve().catch((error) => {
      if (error instanceof ConfigurationError) throw error;
      throw new AppError(
        "SECRETS_UNAVAILABLE",
        "Server secrets could not be verified.",
        503,
      );
    }));
  }
  private async resolve() {
    if (this.env.NODE_ENV === "production" && !this.env.APP_ENV)
      throw new ConfigurationError([
        "APP_ENV (required for production runtime)",
      ]);
    const parsed = bootstrapSchema.safeParse(this.env);
    if (!parsed.success)
      throw new ConfigurationError([
        ...new Set(parsed.error.issues.map((issue) => String(issue.path[0]))),
      ]);
    const c = parsed.data;
    if (c.SECRETS_PROVIDER === "env") {
      return new ConfigurationService({
        ...this.env,
        ...(await new EnvironmentSecrets(this.env).resolve()),
      }).get();
    }
    if (!c.AZURE_KEY_VAULT_URL || !c.AZURE_KEY_VAULT_SECRET_MAP)
      throw new ConfigurationError([
        "AZURE_KEY_VAULT_URL",
        "AZURE_KEY_VAULT_SECRET_MAP",
      ]);
    if (
      c.AZURE_CREDENTIAL_MODE === "azure_cli" &&
      !["development", "test"].includes(c.APP_ENV)
    )
      throw new ConfigurationError([
        "AZURE_CREDENTIAL_MODE (managed identity required for hosted environments)",
      ]);
    const references = parseSecretReferences(c.AZURE_KEY_VAULT_SECRET_MAP);
    for (const key of secretKeys)
      if (this.env[key])
        throw new ConfigurationError([
          `${key} (environment secret forbidden with Azure Key Vault)`,
        ]);
    const provider =
      this.vault ??
      new AzureKeyVaultSecrets(
        {
          endpoint: c.AZURE_KEY_VAULT_URL,
          references: c.AZURE_KEY_VAULT_SECRET_MAP,
          timeoutMs: c.AZURE_KEY_VAULT_TIMEOUT_MS,
        },
        new AzureCredentialFactory(c).create(c.AZURE_KEY_VAULT_TIMEOUT_MS),
      );
    const values = await provider.resolve();
    if (
      Object.keys(values).length !== Object.keys(references).length ||
      Object.entries(values).some(
        ([key, value]) =>
          !Object.hasOwn(references, key) ||
          typeof value !== "string" ||
          !value,
      )
    )
      throw new ConfigurationError([
        "AZURE_KEY_VAULT_SECRET_MAP (secret result mismatch)",
      ]);
    return new ConfigurationService({ ...this.env, ...values }).get();
  }
}
