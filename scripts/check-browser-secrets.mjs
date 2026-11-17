import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
const keys = [
  "AZURE_MONITOR_CONNECTION_STRING",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "SMTP_PASSWORD",
  "OPENAI_API_KEY",
  "CRON_SECRET",
  "CONTACT_HASH_SECRET",
  "ENTRA_CLIENT_SECRET",
  "ENTRA_DIRECTORY_CLIENT_SECRET",
  "ENTRA_MFA_ENCRYPTION_KEYS",
];
const secrets = keys
  .filter((key) => process.env[key] && process.env[key].length >= 16)
  .map((key) => ({ key, value: process.env[key] }));
// A keyring can leak one material value without serializing the complete JSON.
try {
  const ring = JSON.parse(process.env.ENTRA_MFA_ENCRYPTION_KEYS ?? "{}");
  if (ring && typeof ring === "object" && !Array.isArray(ring))
    for (const value of Object.values(ring))
      if (typeof value === "string" && value.length >= 16)
        secrets.push({ key: "ENTRA_MFA_ENCRYPTION_KEYS material", value });
} catch {
  /* The server validator owns configuration errors; still scan the raw canary. */
}
if (!secrets.length) {
  console.error(
    "No secret canaries supplied. Build and run with at least one non-secret test canary to verify browser assets.",
  );
  process.exit(1);
}
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await scan(file);
      continue;
    }
    const content = await readFile(file, "utf8");
    for (const { key, value } of secrets) {
      if (content.includes(value)) {
        console.error(
          `Secret leakage detected for ${key} in browser build output.`,
        );
        process.exit(1);
      }
    }
  }
}
await scan(".next/static");
console.log(
  "Browser build contains none of the supplied privileged secret values.",
);
