import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AppError, ConfigurationError } from "@/server/errors";

export interface EntraMfaScope {
  realmHash: string;
  profileId: string;
  factorId: string;
}
export interface EntraMfaFactor {
  factorId: string;
  profileId: string;
  encryptedSecret: string | null;
  enrolled: boolean;
}
export interface EntraMfaChallenge extends EntraMfaFactor {
  lastStep: number | null;
}
export type EntraMfaAction = "regenerate" | "remove";
export interface EntraMfaRepository {
  profile(tokenHash: string, realmHash: string): Promise<string | null>;
  prepare(
    tokenHash: string,
    realmHash: string,
    factorId: string,
    encryptedSecret: string,
  ): Promise<EntraMfaFactor | null>;
  begin(
    tokenHash: string,
    realmHash: string,
    proofHash: string,
    recovery: boolean,
  ): Promise<EntraMfaChallenge | null>;
  beginAction(
    tokenHash: string,
    realmHash: string,
    proofHash: string,
    recovery: boolean,
    operation: EntraMfaAction,
  ): Promise<EntraMfaChallenge | null>;
  finishAction(input: {
    tokenHash: string;
    realmHash: string;
    proofHash: string;
    operation: EntraMfaAction;
    step: number | null;
    recoveryDigest: string | null;
    newTokenHash: string | null;
    recoveryDigests: string[] | null;
  }): Promise<{ expiresAt: string | null; removed: boolean } | null>;
  finish(input: {
    tokenHash: string;
    realmHash: string;
    proofHash: string;
    step: number | null;
    recoveryDigest: string | null;
    newTokenHash: string;
    recoveryDigests: string[] | null;
  }): Promise<{ expiresAt: string } | null>;
}
export interface EntraMfaCryptography {
  protector: {
    seal(secret: string, scope: EntraMfaScope): string;
    open(envelope: string, scope: EntraMfaScope): string;
  };
  authenticator: {
    createSecret(): string;
    provisioningUri(secret: string, profileId: string): string;
    match(
      secret: string,
      code: string,
      lastStep: number | null,
    ): Promise<number | null>;
  };
  recovery: {
    create(
      scope: EntraMfaScope,
    ): ReadonlyArray<Readonly<{ code: string; digest: string }>>;
    digest(code: string, scope: EntraMfaScope): string;
  };
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const denied = () =>
  new AppError(
    "MFA_DENIED",
    "Authentication could not be verified. Sign in again or try later.",
    403,
  );

/** Cookie proof owns every operation. No caller-supplied profile, role or factor is trusted. */
export class EntraMfaService {
  constructor(
    private readonly repository: EntraMfaRepository,
    private readonly crypto: EntraMfaCryptography,
    private readonly realmHash: string,
  ) {
    if (!/^[a-f0-9]{64}$/.test(realmHash))
      throw new ConfigurationError(["ENTRA_SESSION_REALM"]);
  }
  private tokenHash(token: string) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw denied();
    return hash(token);
  }
  async prepare(token: string) {
    const tokenHash = this.tokenHash(token);
    const profileId = await this.repository.profile(tokenHash, this.realmHash);
    if (!profileId) throw denied();
    const scope = {
      realmHash: this.realmHash,
      profileId,
      factorId: randomUUID(),
    };
    const envelope = this.crypto.protector.seal(
      this.crypto.authenticator.createSecret(),
      scope,
    );
    const factor = await this.repository.prepare(
      tokenHash,
      this.realmHash,
      scope.factorId,
      envelope,
    );
    if (!factor) throw denied();
    if (factor.enrolled)
      return { factorId: factor.factorId, enrolled: true as const };
    if (!factor.encryptedSecret) throw denied();
    const secret = this.crypto.protector.open(factor.encryptedSecret, {
      ...scope,
      profileId: factor.profileId,
      factorId: factor.factorId,
    });
    return {
      factorId: factor.factorId,
      enrolled: false as const,
      provisioningUri: this.crypto.authenticator.provisioningUri(
        secret,
        factor.profileId,
      ),
    };
  }
  async verify(token: string, code: string, recovery = false) {
    const tokenHash = this.tokenHash(token);
    if (
      typeof recovery !== "boolean" ||
      typeof code !== "string" ||
      !(recovery ? /^[A-Fa-f0-9]{4}(?:-[A-Fa-f0-9]{4}){7}$/ : /^\d{6}$/).test(
        code,
      )
    )
      throw denied();
    const proofHash = hash(randomBytes(32).toString("base64url"));
    const factor = await this.repository.begin(
      tokenHash,
      this.realmHash,
      proofHash,
      recovery,
    );
    if (!factor) throw denied();
    const scope = {
      realmHash: this.realmHash,
      profileId: factor.profileId,
      factorId: factor.factorId,
    };
    const recoveryDigest = recovery
      ? this.crypto.recovery.digest(code, scope)
      : null;
    const step = recovery
      ? null
      : await this.crypto.authenticator.match(
          this.crypto.protector.open(factor.encryptedSecret!, scope),
          code,
          factor.lastStep,
        );
    const codes =
      !factor.enrolled && step !== null
        ? this.crypto.recovery.create(scope)
        : null;
    const newToken = randomBytes(32).toString("base64url");
    const session = await this.repository.finish({
      tokenHash,
      realmHash: this.realmHash,
      proofHash,
      step,
      recoveryDigest,
      newTokenHash: hash(newToken),
      recoveryDigests: codes?.map(({ digest }) => digest) ?? null,
    });
    if (!session) throw denied();
    // Only a committed enrollment returns recovery plaintext, once, to the caller.
    return {
      token: newToken,
      expiresAt: session.expiresAt,
      recoveryCodes: codes?.map(({ code }) => code) ?? null,
    };
  }
  async regenerate(token: string, code: string, recovery = false) {
    const result = await this.change(token, code, recovery, "regenerate");
    if (result.removed) throw denied();
    return result;
  }
  async remove(token: string, code: string, recovery = false) {
    const result = await this.change(token, code, recovery, "remove");
    if (!result.removed) throw denied();
    return { removed: true as const };
  }
  private async change(
    token: string,
    code: string,
    recovery: boolean,
    operation: EntraMfaAction,
  ) {
    const tokenHash = this.tokenHash(token);
    if (
      typeof recovery !== "boolean" ||
      typeof code !== "string" ||
      !(recovery ? /^[A-Fa-f0-9]{4}(?:-[A-Fa-f0-9]{4}){7}$/ : /^\d{6}$/).test(
        code,
      )
    )
      throw denied();
    const proofHash = hash(randomBytes(32).toString("base64url"));
    const factor = await this.repository.beginAction(
      tokenHash,
      this.realmHash,
      proofHash,
      recovery,
      operation,
    );
    if (!factor || !factor.enrolled) throw denied();
    const scope = {
      realmHash: this.realmHash,
      profileId: factor.profileId,
      factorId: factor.factorId,
    };
    const recoveryDigest = recovery
      ? this.crypto.recovery.digest(code, scope)
      : null;
    const step = recovery
      ? null
      : await this.crypto.authenticator.match(
          this.crypto.protector.open(factor.encryptedSecret!, scope),
          code,
          factor.lastStep,
        );
    const codes =
      operation === "regenerate" && (step !== null || recoveryDigest !== null)
        ? this.crypto.recovery.create(scope)
        : null;
    const newToken =
      operation === "regenerate" ? randomBytes(32).toString("base64url") : null;
    const result = await this.repository.finishAction({
      tokenHash,
      realmHash: this.realmHash,
      proofHash,
      operation,
      step,
      recoveryDigest,
      newTokenHash: newToken ? hash(newToken) : null,
      recoveryDigests: codes?.map(({ digest }) => digest) ?? null,
    });
    if (!result) throw denied();
    if (operation === "remove") {
      if (!result.removed || result.expiresAt !== null) throw denied();
      return { removed: true as const };
    }
    if (result.removed || !result.expiresAt || !newToken || !codes)
      throw denied();
    return {
      removed: false as const,
      token: newToken,
      expiresAt: result.expiresAt,
      recoveryCodes: codes.map(({ code }) => code),
    };
  }
}
