import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generate } from "otplib";
import {
  MfaAuthenticator,
  MfaRecoveryCodes,
  MfaSecretProtector,
} from "@/server/providers/mfa-crypto";
import { AppError, ConfigurationError } from "@/server/errors";

const scope = {
  realmHash: "a".repeat(64),
  profileId: "10000000-0000-4000-8000-000000000001",
  factorId: "20000000-0000-4000-8000-000000000002",
};
const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const key = () => randomBytes(32).toString("base64url");
function unavailable(action: () => unknown) {
  expect(action).toThrow(AppError);
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({
      code: "MFA_UNAVAILABLE",
      status: 503,
      message: "Authentication could not be prepared or verified.",
    });
  }
}

describe("MFA secret encryption", () => {
  it("encrypts with fresh nonces and binds the factor, profile and realm", () => {
    const protector = new MfaSecretProtector("current", { current: key() });
    const envelope = protector.seal(secret, scope);
    expect(envelope).not.toContain(secret);
    expect(protector.seal(secret, scope)).not.toBe(envelope);
    expect(protector.open(envelope, scope)).toBe(secret);
    for (const other of [
      { ...scope, realmHash: "b".repeat(64) },
      { ...scope, profileId: scope.factorId },
      { ...scope, factorId: scope.profileId },
    ])
      unavailable(() => protector.open(envelope, other));
  });
  it.each([2, 3, 4])("authenticates envelope byte component %i", (part) => {
    const protector = new MfaSecretProtector("current", { current: key() });
    const parts = protector.seal(secret, scope).split(".");
    const bytes = Buffer.from(parts[part], "base64url");
    bytes[0] ^= 1;
    parts[part] = bytes.toString("base64url");
    unavailable(() => protector.open(parts.join("."), scope));
  });
  it("supports explicit rotation without fallback or key-id substitution", () => {
    const old = key(),
      current = key();
    const oldProtector = new MfaSecretProtector("old", { old });
    const envelope = oldProtector.seal(secret, scope);
    const rotated = new MfaSecretProtector("current", { old, current });
    expect(rotated.open(envelope, scope)).toBe(secret);
    expect(rotated.seal(secret, scope).split(".")[1]).toBe("current");
    unavailable(() =>
      new MfaSecretProtector("current", { current }).open(envelope, scope),
    );
    unavailable(() =>
      new MfaSecretProtector("alias", { alias: old }).open(
        envelope.replace(".old.", ".alias."),
        scope,
      ),
    );
  });
  it("rejects malformed envelopes and invalid plaintext/context safely", () => {
    const protector = new MfaSecretProtector("current", { current: key() });
    const envelope = protector.seal(secret, scope);
    for (const bad of [
      "",
      "x".repeat(257),
      `${envelope}.extra`,
      envelope.replace("v1.", "v2."),
      `${envelope}=`,
      envelope.replace(".current.", ".unknown."),
    ])
      unavailable(() => protector.open(bad, scope));
    unavailable(() => protector.seal(secret.toLowerCase(), scope));
    unavailable(() => protector.seal(secret, { ...scope, realmHash: "bad" }));
  });
  it("copies key material rather than retaining mutable configuration", () => {
    const keys = { current: key() };
    const protector = new MfaSecretProtector("current", keys);
    const envelope = protector.seal(secret, scope);
    keys.current = key();
    expect(protector.open(envelope, scope)).toBe(secret);
  });
  it("rejects missing, ambiguous, oversized or noncanonical keyrings", () => {
    const material = key();
    for (const [active, keys] of [
      ["current", {}],
      ["missing", { current: material }],
      ["a", { a: material, b: material }],
      ["a", { a: `${material}=` }],
      ["a", { a: "x".repeat(43) }],
      ["bad.id", { "bad.id": material }],
      ["a", { a: key(), b: key(), c: key(), d: key() }],
    ] as Array<[string, Record<string, string>]>)
      expect(() => new MfaSecretProtector(active, keys)).toThrow(
        ConfigurationError,
      );
  });
});

describe("MFA authenticator", () => {
  // RFC 6238 Appendix B SHA-1 vectors, truncated to this policy's six digits.
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ])(
    "matches the independent RFC vector at %i seconds",
    async (seconds, code) => {
      expect(
        await new MfaAuthenticator("NOVA", () => seconds * 1000).match(
          secret,
          code,
        ),
      ).toBe(Math.floor(seconds / 30));
    },
  );
  it("accepts one time step of drift and rejects codes outside it", async () => {
    const seconds = 1234567890;
    const auth = new MfaAuthenticator("NOVA", () => seconds * 1000);
    for (const drift of [-60, -30, 0, 30, 60]) {
      const code = await generate({
        secret,
        epoch: seconds + drift,
        digits: 6,
        period: 30,
        algorithm: "sha1",
      });
      expect(await auth.match(secret, code)).toBe(
        Math.abs(drift) <= 30 ? Math.floor((seconds + drift) / 30) : null,
      );
    }
  });
  it("returns a counter suitable for atomic replay prevention", async () => {
    const seconds = 1234567890,
      step = Math.floor(seconds / 30);
    const auth = new MfaAuthenticator("NOVA", () => seconds * 1000);
    expect(await auth.match(secret, "005924", step)).toBeNull();
    expect(await auth.match(secret, "005924", step - 1)).toBe(step);
    const future = await generate({ secret, epoch: seconds + 30 });
    expect(await auth.match(secret, future, step)).toBe(step + 1);
  });
  it("rejects malformed codes and fails closed for invalid clock or secret", async () => {
    const auth = new MfaAuthenticator();
    for (const code of ["", "12345", "1234567", " 005924", "abcdef"])
      expect(await auth.match(secret, code)).toBeNull();
    for (const time of [-1, NaN, Infinity, 1.5])
      await expect(
        new MfaAuthenticator("NOVA", () => time).match(secret, "005924"),
      ).rejects.toMatchObject({ code: "MFA_UNAVAILABLE", status: 503 });
    await expect(auth.match("bad", "005924")).rejects.toMatchObject({
      code: "MFA_UNAVAILABLE",
    });
    await expect(auth.match(secret, "005924", -1)).rejects.toMatchObject({
      code: "MFA_UNAVAILABLE",
    });
  });
  it("creates private local provisioning URIs and independent 160-bit secrets", () => {
    const auth = new MfaAuthenticator("Synthetic Admin");
    const secrets = Array.from({ length: 20 }, () => auth.createSecret());
    expect(new Set(secrets).size).toBe(20);
    for (const value of secrets) expect(value).toMatch(/^[A-Z2-7]{32}$/);
    const uri = new URL(auth.provisioningUri(secret, scope.profileId));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.hostname).toBe("totp");
    expect(decodeURIComponent(uri.pathname)).toContain(
      `Admin ${scope.profileId}`,
    );
    expect(Object.fromEntries(uri.searchParams)).toMatchObject({
      secret,
      issuer: "Synthetic Admin",
    });
    expect(uri.searchParams.get("algorithm") ?? "SHA1").toBe("SHA1");
    expect(uri.searchParams.get("digits") ?? "6").toBe("6");
    expect(uri.searchParams.get("period") ?? "30").toBe("30");
    unavailable(() => auth.provisioningUri(secret, "email@example.invalid"));
    expect(() => new MfaAuthenticator("bad\nissuer")).toThrow(
      ConfigurationError,
    );
  });
});

describe("MFA recovery secrets", () => {
  it("creates ten independent 128-bit codes with scope-bound digests", () => {
    const recovery = new MfaRecoveryCodes(),
      codes = recovery.create(scope);
    expect(codes).toHaveLength(10);
    expect(new Set(codes.map(({ code }) => code)).size).toBe(10);
    for (const item of codes) {
      expect(Object.isFrozen(item)).toBe(true);
      expect(item.code).toMatch(/^[A-F0-9]{4}(?:-[A-F0-9]{4}){7}$/);
      expect(item.digest).toMatch(/^[a-f0-9]{64}$/);
      expect(recovery.digest(item.code.toLowerCase(), scope)).toBe(item.digest);
      for (const other of [
        { ...scope, realmHash: "b".repeat(64) },
        { ...scope, profileId: scope.factorId },
        { ...scope, factorId: scope.profileId },
      ])
        expect(recovery.digest(item.code, other)).not.toBe(item.digest);
    }
    for (const invalid of [
      "",
      codes[0].code.replaceAll("-", ""),
      `${codes[0].code} `,
    ])
      unavailable(() => recovery.digest(invalid, scope));
    unavailable(() => recovery.create({ ...scope, factorId: "invalid" }));
  });
});
