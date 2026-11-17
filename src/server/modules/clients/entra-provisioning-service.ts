import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, ConfigurationError } from "@/server/errors";
import type { AuthorizedContext } from "../identity/authorization-service";
export interface EntraProvisioningClaim {
  mode: "check" | "reconcile" | "ready" | "busy";
  email: string;
  displayName: string;
  objectId: string | null;
}
export interface EntraProvisioningRepository {
  claim(
    context: AuthorizedContext,
    tenantId: string,
    domain: string,
    clientId: string,
    leaseId: string,
  ): Promise<EntraProvisioningClaim>;
  start(
    context: AuthorizedContext,
    tenantId: string,
    clientId: string,
    leaseId: string,
  ): Promise<boolean>;
  complete(
    context: AuthorizedContext,
    tenantId: string,
    clientId: string,
    leaseId: string,
    objectId: string,
  ): Promise<boolean>;
  release(
    context: AuthorizedContext,
    tenantId: string,
    clientId: string,
    leaseId: string,
    rejected: boolean,
  ): Promise<void>;
}
export interface EntraProvisioningDirectory {
  findByEmail(email: string): Promise<Readonly<{
    objectId: string;
    subject: string;
    email: string;
  }> | null>;
  getById(
    objectId: string,
    email: string,
  ): Promise<Readonly<{ objectId: string; subject: string; email: string }>>;
  createCustomer(
    email: string,
    displayName: string,
  ): Promise<Readonly<{ objectId: string; subject: string; email: string }>>;
}
const uncertain = () =>
  new AppError(
    "ACCOUNT_PROVISIONING_UNCERTAIN",
    "Account preparation may have completed. No email was sent. Reconcile the directory before attempting another creation.",
    503,
  );
/** Durable write intent survives crashes and email retries; uncertainty permits reads only. */
export class EntraProvisioningService {
  private readonly tenantId: string;
  private readonly domain: string;
  constructor(
    private readonly repository: EntraProvisioningRepository,
    private readonly directory: EntraProvisioningDirectory,
    options: { tenantId: string; tenantSubdomain: string },
  ) {
    if (
      !z.uuid().safeParse(options.tenantId).success ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(options.tenantSubdomain)
    )
      throw new ConfigurationError(["ENTRA_PROVISIONING_AUTHORITY"]);
    this.tenantId = options.tenantId.toLowerCase();
    this.domain = `${options.tenantSubdomain}.onmicrosoft.com`;
  }
  async prepare(
    context: AuthorizedContext,
    clientId: string,
    email: string,
    subject: string | null,
    purpose: "setup" | "reset",
  ) {
    if (
      context.profile.role !== "admin" ||
      context.profile.status !== "active" ||
      context.assurance !== "aal2" ||
      context.identity.assurance !== "aal2"
    )
      throw new AppError(
        "FORBIDDEN",
        "Administrator verification is required.",
        403,
      );
    if (
      !z.uuid().safeParse(clientId).success ||
      typeof email !== "string" ||
      !z.email().safeParse(email).success ||
      !["setup", "reset"].includes(purpose)
    )
      throw new AppError(
        "INVALID_INPUT",
        "Invalid account preparation request.",
        422,
      );
    if (
      subject !== null &&
      (typeof subject !== "string" ||
        !subject.startsWith(`${this.tenantId}:`) ||
        !z.uuid().safeParse(subject.slice(37)).success)
    )
      throw new AppError(
        "IDENTITY_CONFLICT",
        "The identity association does not match.",
        409,
      );
    if (purpose === "reset" && !subject)
      throw new AppError(
        "NOT_INVITED",
        "Send an account setup invitation first.",
        409,
      );
    const lease = randomUUID(),
      claim = await this.repository.claim(
        context,
        this.tenantId,
        this.domain,
        clientId,
        lease,
      );
    if (claim.mode === "busy")
      throw new AppError(
        "PROVISIONING_PENDING",
        "Account preparation is already processing.",
        409,
      );
    let creationStarted = false,
      rejectionProven = false;
    try {
      if (
        claim.email !== email.toLowerCase() ||
        (claim.objectId !== null &&
          subject !== null &&
          subject !== `${this.tenantId}:${claim.objectId}`)
      )
        throw new AppError(
          "IDENTITY_CONFLICT",
          "The identity association does not match.",
          409,
        );
      let account =
        claim.mode === "ready" && claim.objectId
          ? await this.directory.getById(claim.objectId, claim.email)
          : await this.directory.findByEmail(claim.email);
      if (!account) {
        if (claim.mode !== "check" || purpose !== "setup" || subject !== null)
          throw uncertain();
        if (
          !(await this.repository.start(
            context,
            this.tenantId,
            clientId,
            lease,
          ))
        )
          throw new AppError(
            "PROVISIONING_PENDING",
            "Account preparation changed. Reconcile before retrying.",
            409,
          );
        creationStarted = true;
        try {
          account = await this.directory.createCustomer(
            claim.email,
            claim.displayName,
          );
        } catch (error) {
          rejectionProven =
            error instanceof AppError &&
            [
              "DIRECTORY_UNAVAILABLE",
              "DIRECTORY_REJECTED",
              "DIRECTORY_RATE_LIMITED",
              "INVALID_DIRECTORY_REQUEST",
            ].includes(error.code);
          throw error;
        }
      }
      if (
        !z.uuid().safeParse(account.objectId).success ||
        account.email !== claim.email ||
        account.subject !== `${this.tenantId}:${account.objectId}` ||
        (subject !== null && account.subject !== subject)
      )
        throw new AppError(
          "IDENTITY_CONFLICT",
          "The identity association does not match.",
          409,
        );
      if (
        !(await this.repository.complete(
          context,
          this.tenantId,
          clientId,
          lease,
          account.objectId,
        ))
      )
        throw uncertain();
      return { subject: account.subject, provider: "entra" as const };
    } catch (error) {
      if ((creationStarted && !rejectionProven) || claim.mode === "reconcile")
        throw uncertain();
      throw error;
    } finally {
      await this.repository
        .release(context, this.tenantId, clientId, lease, rejectionProven)
        .catch(() => {});
    }
  }
}
