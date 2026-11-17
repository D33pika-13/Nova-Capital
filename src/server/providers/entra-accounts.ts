import "server-only";
import type {
  AccountInvitationProvider,
  AccountInvitationContext,
} from "../modules/clients/invitation-service";
import type { EntraProvisioningService } from "../modules/clients/entra-provisioning-service";
import { AppError, ConfigurationError } from "../errors";
/** Hosted recovery is a public sign-in destination, never a bearer password link. */
export class EntraAccountInvitationProvider implements AccountInvitationProvider {
  private readonly link: string;
  constructor(
    private readonly provisioning: EntraProvisioningService,
    options: { applicationOrigin: string; recoveryMode: "hosted_sspr" },
  ) {
    try {
      const url = new URL(options.applicationOrigin);
      if (
        url.protocol !== "https:" ||
        url.origin !== options.applicationOrigin ||
        options.recoveryMode !== "hosted_sspr"
      )
        throw Error("configuration");
      this.link = new URL("/login", url).href;
    } catch {
      throw new ConfigurationError(["ENTRA_ACCOUNT_RECOVERY"]);
    }
  }
  async prepare(
    email: string,
    subject: string | null,
    purpose: "setup" | "reset",
    request?: AccountInvitationContext,
  ) {
    if (!request)
      throw new AppError(
        "PROVISIONING_CONTEXT",
        "Account preparation requires an authorized client request.",
        503,
      );
    const account = await this.provisioning.prepare(
      request.context,
      request.clientId,
      email,
      subject,
      purpose,
    );
    return {
      ...account,
      link: this.link,
      linkKind: "hosted_recovery" as const,
    };
  }
}
