import "server-only";
import { z } from "zod";
import { ConfigurationError } from "./errors";
export const secretKeys = [
  "AZURE_MONITOR_CONNECTION_STRING",
  "ENTRA_CLIENT_SECRET",
  "ENTRA_DIRECTORY_CLIENT_SECRET",
  "ENTRA_MFA_ENCRYPTION_KEYS",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "SMTP_PASSWORD",
  "OPENAI_API_KEY",
  "CRON_SECRET",
  "CONTACT_HASH_SECRET",
] as const;
export type SecretKey = (typeof secretKeys)[number];
export function isKeyVaultEndpoint(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/" &&
      /^[a-z][a-z0-9-]{1,22}[a-z0-9]\.vault\.azure\.net$/.test(url.hostname) &&
      !url.hostname.split(".")[0].includes("--")
    );
  } catch {
    return false;
  }
}
const referenceSchema = z
  .string()
  .regex(/^[A-Za-z0-9-]{1,127}\/[a-fA-F0-9]{32}$/);
export function parseSecretReferences(
  value: string,
): Readonly<Partial<Record<SecretKey, string>>> {
  try {
    if (value.length > 8192) throw Error("size");
    const parsed = z
      .partialRecord(z.enum(secretKeys), referenceSchema)
      .parse(JSON.parse(value));
    if (Object.keys(parsed).length === 0) throw Error("empty");
    return Object.freeze(parsed);
  } catch {
    throw new ConfigurationError(["AZURE_KEY_VAULT_SECRET_MAP"]);
  }
}
