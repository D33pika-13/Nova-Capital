import "server-only";
import type {
  IdentityProvider,
  ProfileRepository,
  Profile,
  VerifiedIdentity,
} from "@/server/contracts";
import { AppError } from "@/server/errors";
export interface AuthorizedContext {
  identity: VerifiedIdentity;
  profile: Profile;
  assurance: "aal1" | "aal2";
}
export class AuthorizationService {
  constructor(
    private readonly identity: IdentityProvider,
    private readonly profiles: ProfileRepository,
  ) {}
  async requireUser(
    options: { allowPendingMfa?: boolean } = {},
  ): Promise<AuthorizedContext> {
    const identity = await this.identity.verify();
    if (!identity)
      throw new AppError("UNAUTHENTICATED", "Please sign in to continue.", 401);
    const profile = await this.profiles.findByIdentity(identity);
    if (!profile || profile.status !== "active")
      throw new AppError(
        "FORBIDDEN",
        "This account does not have active access.",
        403,
      );
    if (
      identity.mfaEnrolled &&
      identity.assurance !== "aal2" &&
      !options.allowPendingMfa
    )
      throw new AppError(
        "MFA_REQUIRED",
        "Complete multi-factor authentication to continue.",
        403,
      );
    return { identity, profile, assurance: identity.assurance };
  }
  async requireAdmin(): Promise<AuthorizedContext> {
    const context = await this.requireUser();
    if (context.profile.role !== "admin")
      throw new AppError("FORBIDDEN", "Administrator access is required.", 403);
    if (context.assurance !== "aal2")
      throw new AppError(
        "MFA_REQUIRED",
        "Complete multi-factor authentication to continue.",
        403,
      );
    return context;
  }
}
