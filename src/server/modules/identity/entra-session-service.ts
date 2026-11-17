import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { VerifiedIdentity } from "@/server/contracts";
import { AppError, ConfigurationError } from "@/server/errors";

export interface EntraSessionRepository {
  create(
    identity: VerifiedIdentity,
    tokenHash: string,
    realmHash: string,
  ): Promise<{ expiresAt: string } | null>;
  resolve(
    tokenHash: string,
    realmHash: string,
  ): Promise<VerifiedIdentity | null>;
  revokeVerified(
    identity: VerifiedIdentity,
    realmHash: string,
  ): Promise<boolean>;
  revoke(tokenHash: string, realmHash: string, all: boolean): Promise<void>;
}
export interface EntraSessionRealm {
  tenantId: string;
  clientId: string;
  issuer: string;
  applicationOrigin: string;
}
const opaque = /^[A-Za-z0-9_-]{43}$/;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** Server-only session coordinator; token values belong only in secure cookies. */
export class EntraSessionService {
  readonly realmHash: string;
  private readonly tenantId: string;
  constructor(
    private readonly repository: EntraSessionRepository,
    realm: EntraSessionRealm,
  ) {
    try {
      const issuer = new URL(realm.issuer);
      const origin = new URL(realm.applicationOrigin);
      if (
        !z.uuid().safeParse(realm.tenantId).success ||
        !z.uuid().safeParse(realm.clientId).success ||
        issuer.protocol !== "https:" ||
        issuer.username ||
        issuer.password ||
        issuer.search ||
        issuer.hash ||
        issuer.port ||
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ciamlogin\.com$/.test(
          issuer.hostname,
        ) ||
        issuer.pathname !== `/${realm.tenantId.toLowerCase()}/v2.0` ||
        issuer.href !== realm.issuer ||
        origin.protocol !== "https:" ||
        origin.origin !== realm.applicationOrigin
      )
        throw Error("realm");
    } catch {
      throw new ConfigurationError(["ENTRA_SESSION_REALM"]);
    }
    this.tenantId = realm.tenantId.toLowerCase();
    this.realmHash = hash(
      JSON.stringify([
        realm.issuer,
        realm.clientId.toLowerCase(),
        realm.applicationOrigin,
      ]),
    );
  }
  private accepts(identity: VerifiedIdentity, elevated = false) {
    return (
      identity.provider === "entra" &&
      (identity.assurance === "aal1" ||
        (elevated && identity.assurance === "aal2")) &&
      identity.subject.startsWith(`${this.tenantId}:`) &&
      z.uuid().safeParse(identity.subject.slice(37)).success
    );
  }
  async issue(identity: VerifiedIdentity, previousToken?: string) {
    if (!this.accepts(identity))
      throw new AppError(
        "UNAUTHENTICATED",
        "Sign-in could not be verified.",
        401,
      );
    // Revoke first. A failed replacement does not restore the old browser token.
    if (typeof previousToken === "string" && opaque.test(previousToken))
      await this.repository.revoke(hash(previousToken), this.realmHash, false);
    const token = randomBytes(32).toString("base64url");
    const session = await this.repository.create(
      identity,
      hash(token),
      this.realmHash,
    );
    if (!session)
      throw new AppError(
        "FORBIDDEN",
        "This account does not have active access.",
        403,
      );
    return {
      token,
      expiresAt: session.expiresAt,
      maxAgeSeconds: 28800 as const,
    };
  }
  async issueRecovery(identity: VerifiedIdentity, previousToken?: string) {
    if (!this.accepts(identity))
      throw new AppError(
        "UNAUTHENTICATED",
        "Sign-in could not be verified.",
        401,
      );
    // Commit revocation separately: a failed mint cannot restore old sessions.
    if (!(await this.repository.revokeVerified(identity, this.realmHash)))
      throw new AppError(
        "FORBIDDEN",
        "This account does not have active access.",
        403,
      );
    return this.issue(identity, previousToken);
  }
  async verify(token?: string): Promise<Readonly<VerifiedIdentity> | null> {
    if (typeof token !== "string" || !opaque.test(token)) return null;
    const identity = await this.repository.resolve(hash(token), this.realmHash);
    return identity && this.accepts(identity, true)
      ? Object.freeze({
          provider: "entra",
          subject: identity.subject,
          assurance: identity.assurance,
        })
      : null;
  }
  async revoke(token?: string, all = true) {
    if (typeof token === "string" && opaque.test(token))
      await this.repository.revoke(hash(token), this.realmHash, all);
  }
}
