import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import {
  educationSchema,
  educationPageSchema,
  educationConfirmation,
  type EducationInput,
  type EducationPage,
  type EducationRequest,
} from "@/lib/education-inputs";
import type { RateLimiter } from "@/server/contracts";
import type {
  AuthorizationService,
  AuthorizedContext,
} from "../identity/authorization-service";
import { AppError } from "@/server/errors";
export interface EducationRepository {
  submit(input: EducationInput, hash: string): Promise<void>;
  list(
    context: AuthorizedContext,
    page: EducationPage,
  ): Promise<EducationRequest[]>;
}
export class EducationService {
  constructor(
    private readonly repository: EducationRepository,
    private readonly auth: Pick<AuthorizationService, "requireAdmin">,
    private readonly limits: RateLimiter,
    private readonly options: { enabled: boolean; secret?: string },
  ) {}
  private digest(value: string) {
    return createHmac("sha256", this.options.secret!)
      .update(`education:${value}`)
      .digest("hex");
  }
  async submit(raw: unknown, address: string | null) {
    if (
      !this.options.enabled ||
      !this.options.secret ||
      this.options.secret.length < 32
    )
      throw new AppError(
        "EDUCATION_UNAVAILABLE",
        "Education requests are not available in this environment.",
        503,
      );
    if (address !== null && !isIP(address))
      throw new AppError(
        "EDUCATION_UNAVAILABLE",
        "The network context could not be verified.",
        503,
      );
    const parsed = educationSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError(
        "INVALID_INPUT",
        "Enter your name, valid email, phone number and preferred service, and confirm permission to contact you.",
        422,
      );
    const input = parsed.data;
    if (
      !(await this.limits.consume(
        `education:network:${this.digest(address ?? "local")}`,
        15,
        3600,
      )) ||
      !(await this.limits.consume(
        `education:email:${this.digest(input.email)}`,
        6,
        3600,
      )) ||
      !(await this.limits.consume("education:global", 100, 3600))
    )
      throw new AppError(
        "RATE_LIMITED",
        "Too many education requests. Please try again later.",
        429,
      );
    const payload = {
      name: input.name,
      email: input.email,
      phone: input.phone,
      service: input.service,
      message: input.message,
      consent: input.consent,
    };
    // Canonical, fixed field order; never persist raw addresses or log personal data.
    const hash = this.digest(JSON.stringify(payload));
    await this.repository.submit(input, hash);
    return {
      reference: input.requestId,
      status: "received" as const,
      message: educationConfirmation,
    };
  }
  async list(raw: unknown = {}) {
    const context = await this.auth.requireAdmin();
    const page = educationPageSchema.safeParse(raw);
    if (!page.success)
      throw new AppError(
        "INVALID_INPUT",
        "Invalid education request page.",
        422,
      );
    return this.repository.list(context, page.data);
  }
}
