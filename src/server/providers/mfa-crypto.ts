import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { generateSecret, generateURI, verify } from "otplib";
import { z } from "zod";
import { AppError, ConfigurationError } from "../errors";

export interface MfaSecretContext {
  realmHash: string;
  profileId: string;
  factorId: string;
}
const secretPattern = /^[A-Z2-7]{32}$/;
function context(value: MfaSecretContext) {
  if (
    !/^[a-f0-9]{64}$/.test(value.realmHash) ||
    !z.uuid().safeParse(value.profileId).success ||
    !z.uuid().safeParse(value.factorId).success
  )
    throw Error("context");
  return [
    value.realmHash,
    value.profileId.toLowerCase(),
    value.factorId.toLowerCase(),
  ];
}
function unavailable() {
  return new AppError(
    "MFA_UNAVAILABLE",
    "Authentication could not be prepared or verified.",
    503,
  );
}

/** Versioned authenticated encryption; no environment-key or plaintext fallback. */
export class MfaSecretProtector {
  private readonly keys = new Map<string, Buffer>();
  constructor(
    private readonly activeKeyId: string,
    keys: Readonly<Record<string, string>>,
  ) {
    try {
      if (
        !keys ||
        typeof keys !== "object" ||
        Array.isArray(keys) ||
        Object.keys(keys).length < 1 ||
        Object.keys(keys).length > 3
      )
        throw Error("keys");
      const seen = new Set<string>();
      for (const [id, value] of Object.entries(keys)) {
        if (
          !/^[A-Za-z0-9_-]{1,32}$/.test(id) ||
          typeof value !== "string" ||
          !/^[A-Za-z0-9_-]{43}$/.test(value)
        )
          throw Error("key");
        const key = Buffer.from(value, "base64url");
        if (
          key.length !== 32 ||
          key.toString("base64url") !== value ||
          seen.has(value)
        )
          throw Error("key");
        seen.add(value);
        this.keys.set(id, key);
      }
      if (!this.keys.has(activeKeyId)) throw Error("active");
    } catch {
      throw new ConfigurationError(["ENTRA_MFA_ENCRYPTION_KEYS"]);
    }
  }
  private aad(keyId: string, value: MfaSecretContext) {
    return Buffer.from(
      JSON.stringify(["nova-entra-totp", "v1", keyId, ...context(value)]),
      "utf8",
    );
  }
  seal(secret: string, value: MfaSecretContext) {
    try {
      if (typeof secret !== "string" || !secretPattern.test(secret))
        throw Error("secret");
      const iv = randomBytes(12);
      const cipher = createCipheriv(
        "aes-256-gcm",
        this.keys.get(this.activeKeyId)!,
        iv,
        { authTagLength: 16 },
      );
      cipher.setAAD(this.aad(this.activeKeyId, value));
      const ciphertext = Buffer.concat([
        cipher.update(secret, "utf8"),
        cipher.final(),
      ]);
      return [
        "v1",
        this.activeKeyId,
        iv.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
        ciphertext.toString("base64url"),
      ].join(".");
    } catch {
      throw unavailable();
    }
  }
  open(envelope: string, value: MfaSecretContext) {
    let plaintext: Buffer | undefined;
    const chunks: Buffer[] = [];
    try {
      if (typeof envelope !== "string" || envelope.length > 256)
        throw Error("envelope");
      const parts = envelope.split(".");
      if (
        parts.length !== 5 ||
        parts[0] !== "v1" ||
        !/^[A-Za-z0-9_-]{1,32}$/.test(parts[1])
      )
        throw Error("envelope");
      const key = this.keys.get(parts[1]);
      if (!key) throw Error("key");
      const decode = (part: string, length: number) => {
        if (!/^[A-Za-z0-9_-]+$/.test(part)) throw Error("encoding");
        const bytes = Buffer.from(part, "base64url");
        if (bytes.length !== length || bytes.toString("base64url") !== part)
          throw Error("encoding");
        return bytes;
      };
      const iv = decode(parts[2], 12),
        tag = decode(parts[3], 16),
        ciphertext = decode(parts[4], 32);
      const decipher = createDecipheriv("aes-256-gcm", key, iv, {
        authTagLength: 16,
      });
      decipher.setAAD(this.aad(parts[1], value));
      decipher.setAuthTag(tag);
      chunks.push(decipher.update(ciphertext));
      chunks.push(decipher.final());
      plaintext = Buffer.concat(chunks);
      const secret = plaintext.toString("utf8");
      if (!secretPattern.test(secret)) throw Error("secret");
      return secret;
    } catch {
      throw unavailable();
    } finally {
      plaintext?.fill(0);
      for (const chunk of chunks) chunk.fill(0);
    }
  }
}

/** Six-digit SHA-1/30-second authenticator policy, with a one-period drift window. */
export class MfaAuthenticator {
  constructor(
    private readonly issuer = "NOVA CAPITAL",
    private readonly now: () => number = Date.now,
  ) {
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(issuer))
      throw new ConfigurationError(["MFA_ISSUER"]);
  }
  createSecret() {
    return generateSecret({ length: 20 });
  }
  provisioningUri(secret: string, profileId: string) {
    try {
      if (!secretPattern.test(secret) || !z.uuid().safeParse(profileId).success)
        throw Error("input");
      return generateURI({
        issuer: this.issuer,
        label: `Admin ${profileId.toLowerCase()}`,
        secret,
        algorithm: "sha1",
        digits: 6,
        period: 30,
      });
    } catch {
      throw unavailable();
    }
  }
  async match(
    secret: string,
    code: string,
    lastAcceptedStep: number | null = null,
  ): Promise<number | null> {
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
    try {
      const time = this.now();
      if (
        !secretPattern.test(secret) ||
        !Number.isSafeInteger(time) ||
        time < 0 ||
        (lastAcceptedStep !== null &&
          (!Number.isSafeInteger(lastAcceptedStep) || lastAcceptedStep < 0))
      )
        throw Error("input");
      const result = await verify({
        secret,
        token: code,
        strategy: "totp",
        algorithm: "sha1",
        digits: 6,
        period: 30,
        epoch: Math.floor(time / 1000),
        epochTolerance: 30,
        ...(lastAcceptedStep === null
          ? {}
          : { afterTimeStep: lastAcceptedStep }),
      });
      if (!result.valid || !("timeStep" in result)) return null;
      if (
        !Number.isSafeInteger(result.timeStep) ||
        result.timeStep < 0 ||
        (lastAcceptedStep !== null && result.timeStep <= lastAcceptedStep)
      )
        return null;
      return result.timeStep;
    } catch {
      throw unavailable();
    }
  }
}

/** High-entropy recovery secrets; persistence must consume a digest atomically. */
export class MfaRecoveryCodes {
  create(value: MfaSecretContext) {
    try {
      context(value);
      return Array.from({ length: 10 }, () => {
        const code = randomBytes(16)
          .toString("hex")
          .toUpperCase()
          .match(/.{4}/g)!
          .join("-");
        return Object.freeze({ code, digest: this.digest(code, value) });
      });
    } catch {
      throw unavailable();
    }
  }
  digest(code: string, value: MfaSecretContext) {
    try {
      if (
        typeof code !== "string" ||
        !/^[A-Fa-f0-9]{4}(?:-[A-Fa-f0-9]{4}){7}$/.test(code)
      )
        throw Error("code");
      return createHash("sha256")
        .update(
          JSON.stringify([
            "nova-entra-mfa-recovery",
            "v1",
            ...context(value),
            code.replaceAll("-", "").toLowerCase(),
          ]),
        )
        .digest("hex");
    } catch {
      throw unavailable();
    }
  }
}
