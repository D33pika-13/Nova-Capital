import "server-only";
import { z } from "zod";
import type { EmailProvider, RateLimiter } from "@/server/contracts";
import type {
  AuthorizationService,
  AuthorizedContext,
} from "@/server/modules/identity/authorization-service";
import { AppError, ConfigurationError } from "@/server/errors";
export interface PreparedInvitation {
  subject: string;
  provider: string;
  link: string;
  linkKind?: "single_use_password" | "hosted_recovery";
}
export interface AccountInvitationContext {
  context: AuthorizedContext;
  clientId: string;
  invitationId: string;
}
export interface AccountInvitationProvider {
  prepare(
    email: string,
    subject: string | null,
    purpose: "setup" | "reset",
    request?: AccountInvitationContext,
  ): Promise<PreparedInvitation>;
}
export interface InvitationClaim {
  id: string;
  status: string;
  claimed: boolean;
  email: string;
  subject: string | null;
}
export interface InvitationRepository {
  claim(
    context: AuthorizedContext,
    clientId: string,
    requestId: string,
    purpose: "setup" | "reset",
    acknowledgeDuplicateRisk: boolean,
  ): Promise<InvitationClaim>;
  attach(
    context: AuthorizedContext,
    clientId: string,
    invitation: PreparedInvitation,
  ): Promise<void>;
  finish(
    context: AuthorizedContext,
    id: string,
    status: "accepted" | "failed" | "unknown",
  ): Promise<void>;
}
export class InvitationService {
  private readonly companyName: string;
  constructor(
    private readonly auth: AuthorizationService,
    private readonly repository: InvitationRepository,
    private readonly accounts: AccountInvitationProvider,
    private readonly email: EmailProvider,
    private readonly limits: RateLimiter,
    companyName: string,
  ) {
    const name = z
      .string()
      .regex(/^[^\u0000-\u001f\u007f]+$/)
      .trim()
      .min(1)
      .max(200)
      .safeParse(companyName);
    if (!name.success) throw new ConfigurationError(["companyName"]);
    this.companyName = name.data;
  }
  async send(clientId: string, input: unknown) {
    const context = await this.auth.requireAdmin();
    const data = z
      .object({
        requestId: z.uuid(),
        purpose: z.enum(["setup", "reset"]),
        acknowledgeDuplicateRisk: z.boolean().default(false),
      })
      .strict()
      .safeParse(input);
    if (!z.uuid().safeParse(clientId).success || !data.success)
      throw new AppError("INVALID_INPUT", "Invalid invitation request.", 422);
    if (
      !(await this.limits.consume(
        `invite:admin:${context.profile.id}`,
        30,
        3600,
      )) ||
      !(await this.limits.consume(`invite:client:${clientId}`, 5, 3600))
    )
      throw new AppError(
        "RATE_LIMITED",
        "Too many invitation requests. Try again later.",
        429,
      );
    const claim = await this.repository.claim(
      context,
      clientId,
      data.data.requestId,
      data.data.purpose,
      data.data.acknowledgeDuplicateRisk,
    );
    if (!claim.claimed)
      return {
        status: claim.status,
        message:
          claim.status === "accepted"
            ? "The email service already accepted this request. Delivery is not confirmed."
            : "This request is processing or its delivery is uncertain. It has not been sent again.",
      };
    let sending = false;
    let sendAccepted = false;
    try {
      const invitation = await this.accounts.prepare(
        claim.email,
        claim.subject,
        data.data.purpose,
        { context, clientId, invitationId: claim.id },
      );
      if (
        invitation.linkKind !== undefined &&
        !["single_use_password", "hosted_recovery"].includes(
          invitation.linkKind,
        )
      )
        throw new AppError(
          "INVITATION_PROVIDER",
          "Account recovery could not be prepared.",
          503,
        );
      await this.repository.attach(context, clientId, invitation);
      sending = true;
      await this.email.send({
        to: claim.email,
        subject:
          data.data.purpose === "setup"
            ? `Your ${this.companyName} account invitation`
            : `Your ${this.companyName} password reset`,
        text:
          invitation.linkKind === "hosted_recovery"
            ? `Open the sign-in page below. Enter your account email and select "Forgot password?" on the identity provider's password page. Complete the verification there to set or reset your password.

${invitation.link}

Never send passwords or verification codes to your representative.`
            : `Use this secure, single-use link to set your password:\n\n${invitation.link}\n\nIf you did not expect this request, contact your representative. Never share your password or broker credentials.`,
      });
      sendAccepted = true;
      await this.repository.finish(context, claim.id, "accepted");
      return {
        status: "accepted",
        message:
          "The email service accepted this request. Delivery to the inbox is not confirmed.",
      };
    } catch (error) {
      if (sendAccepted)
        throw new AppError(
          "INVITATION_TRACKING_UNCERTAIN",
          "The email service accepted the message, but its saved status could not be confirmed. Check the inbox and request status before explicitly resending.",
          503,
        );
      await this.repository
        .finish(context, claim.id, sending ? "unknown" : "failed")
        .catch(() => {});
      if (
        !sending &&
        error instanceof AppError &&
        error.code === "ACCOUNT_PROVISIONING_UNCERTAIN"
      )
        throw new AppError(
          "ACCOUNT_PROVISIONING_UNCERTAIN",
          "Account preparation may have completed. No email send was attempted. Reconcile the directory before attempting another creation.",
          503,
        );
      throw new AppError(
        sending ? "DELIVERY_UNCERTAIN" : "INVITATION_FAILED",
        sending
          ? "Email acceptance could not be confirmed. Check the recipient inbox before explicitly retrying; another message may be sent."
          : "The invitation could not be prepared. No email send was attempted. Retry this request.",
        503,
      );
    }
  }
}
