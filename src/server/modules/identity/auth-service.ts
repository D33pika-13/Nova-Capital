import "server-only";
import { z } from "zod";
import type { IdentityProvider, RateLimiter } from "@/server/contracts";
import { AppError } from "@/server/errors";
import type { AuthorizationService } from "./authorization-service";
export const loginSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((v) => v.trim().toLowerCase()),
    password: z.string().min(1).max(512),
  })
  .strict();
export const resetSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((v) => v.trim().toLowerCase()),
  })
  .strict();
export class AuthService {
  constructor(
    private readonly identity: IdentityProvider,
    private readonly authorization: AuthorizationService,
    private readonly limits: RateLimiter,
  ) {}
  private async limit(key: string) {
    if (
      !(await this.limits.consume("auth:global", 100, 60)) ||
      !(await this.limits.consume(key, 5, 900))
    )
      throw new AppError(
        "RATE_LIMITED",
        "Too many attempts. Please try again later.",
        429,
      );
  }
  async login(input: unknown) {
    const parsed = loginSchema.safeParse(input);
    if (!parsed.success)
      throw new AppError(
        "INVALID_INPUT",
        "Enter a valid email address and password.",
        422,
      );
    await this.limit(`login:${parsed.data.email}`);
    await this.identity.signIn(parsed.data.email, parsed.data.password);
    try {
      const context = await this.authorization.requireUser({
        allowPendingMfa: true,
      });
      if (
        (context.profile.role === "admin" || context.identity.mfaEnrolled) &&
        context.assurance !== "aal2"
      )
        return { redirect: "/mfa" };
      return {
        redirect: context.profile.role === "admin" ? "/admin" : "/portal",
      };
    } catch (error) {
      await this.identity.signOut();
      throw error;
    }
  }
  async reset(input: unknown) {
    const parsed = resetSchema.safeParse(input);
    if (!parsed.success)
      throw new AppError("INVALID_INPUT", "Enter a valid email address.", 422);
    await this.limit(`reset:${parsed.data.email}`);
    await this.identity.requestReset(parsed.data.email);
    return {
      message:
        "If the address is eligible, a password reset link will be sent.",
    };
  }
  async changePassword(input: unknown) {
    await this.authorization.requireUser();
    return this.setPassword(input);
  }
  async setPassword(input: unknown) {
    const identity = await this.identity.verify();
    if (!identity)
      throw new AppError(
        "UNAUTHENTICATED",
        "Use a valid invitation or password-reset link.",
        401,
      );
    if (identity.mfaEnrolled && identity.assurance !== "aal2")
      throw new AppError(
        "MFA_REQUIRED",
        "Complete multi-factor authentication before changing your password.",
        403,
      );
    const parsed = z
      .object({ password: z.string().min(12).max(128) })
      .strict()
      .safeParse(input);
    if (!parsed.success)
      throw new AppError(
        "INVALID_INPUT",
        "Use a password of 12–128 characters.",
        422,
      );
    if (!(await this.limits.consume(`password:${identity.subject}`, 5, 900)))
      throw new AppError("RATE_LIMITED", "Please try again later.", 429);
    await this.identity.setPassword(parsed.data.password);
    await this.identity.signOut();
    return { message: "Password updated. Please sign in.", redirect: "/login" };
  }
}
