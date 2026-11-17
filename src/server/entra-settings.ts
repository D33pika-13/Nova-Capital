import "server-only";
import { ConfigurationError } from "./errors";
import { parseFlatStringObject } from "./flat-json";
export function parseEntraMfaKeys(
  value: string,
  activeKeyId: string,
): Readonly<Record<string, string>> {
  try {
    const keys = parseFlatStringObject(value, 2048),
      entries = Object.entries(keys),
      materials = new Set<string>();
    if (
      entries.length < 1 ||
      entries.length > 3 ||
      !Object.hasOwn(keys, activeKeyId)
    )
      throw Error("keys");
    for (const [id, material] of entries) {
      if (
        !/^[A-Za-z0-9_-]{1,32}$/.test(id) ||
        !/^[A-Za-z0-9_-]{43}$/.test(material) ||
        Buffer.from(material, "base64url").length !== 32 ||
        Buffer.from(material, "base64url").toString("base64url") !== material ||
        materials.has(material)
      )
        throw Error("key");
      materials.add(material);
    }
    return Object.freeze(keys);
  } catch {
    throw new ConfigurationError(["ENTRA_MFA_ENCRYPTION_KEYS"]);
  }
}
