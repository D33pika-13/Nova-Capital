import "server-only";
import { z } from "zod";
import { AppError } from "@/server/errors";
import type { RateLimiter } from "@/server/contracts";
import type { AuthorizationService } from "./authorization-service";
export interface MfaProvider {
  prepare(): Promise<{
    factorId: string;
    enrolled: boolean;
    qrCode?: string;
    setupKey?: string;
  }>;
  verify(factorId: string, code: string): Promise<void>;
}
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setup") }).strict(),
  z
    .object({
      action: z.literal("verify"),
      factorId: z.uuid(),
      code: z.string().regex(/^\d{6}$/),
    })
    .strict(),
]);
export class MfaService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly provider: MfaProvider,
    private readonly limits: RateLimiter,
  ) {}
  async execute(input: unknown) {
    const context = await this.authorization.requireUser({
      allowPendingMfa: true,
    });
    if (!(await this.limits.consume(`mfa:${context.profile.id}`, 10, 900)))
      throw new AppError(
        "RATE_LIMITED",
        "Too many attempts. Try again later.",
        429,
      );
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success)
      throw new AppError(
        "INVALID_INPUT",
        "Enter a valid six-digit authentication code.",
        422,
      );
    if (parsed.data.action === "setup") return this.provider.prepare();
    await this.provider.verify(parsed.data.factorId, parsed.data.code);
    return {
      redirect:
        context.profile.role === "admin" ? "/admin" : "/portal/security",
    };
  }
}
