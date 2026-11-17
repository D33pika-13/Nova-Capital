import "server-only";
import { z } from "zod";
import { supportMessageSchema } from "@/lib/support-inputs";
import type { AuthorizationService } from "../identity/authorization-service";
import type { ChatRepository } from "./chat-contracts";
import type { SupportClientAnswers, SupportFaq } from "./support-contracts";
import type { RateLimiter } from "@/server/contracts";
import { AppError } from "@/server/errors";
const inputSchema = supportMessageSchema
  .extend({ requestId: z.uuid(), sessionId: z.uuid().nullable().default(null) })
  .strict();
export class ChatService {
  constructor(
    private readonly auth: AuthorizationService,
    private readonly repository: ChatRepository,
    private readonly support: SupportClientAnswers,
    private readonly limits: RateLimiter,
    private readonly faq: SupportFaq,
  ) {}
  private async client() {
    const context = await this.auth.requireUser();
    if (context.profile.role !== "client")
      throw new AppError(
        "FORBIDDEN",
        "Client chat requires a client account.",
        403,
      );
    return context;
  }
  private id(id: string) {
    if (!z.uuid().safeParse(id).success)
      throw new AppError("CHAT_UNAVAILABLE", "Chat is unavailable.", 404);
  }
  async sessions(raw: unknown = {}) {
    const context = await this.client();
    const data = z
      .object({
        offset: z.coerce.number().int().min(0).max(1000000).default(0),
      })
      .strict()
      .safeParse(raw);
    if (!data.success)
      throw new AppError("INVALID_INPUT", "Invalid chat page.", 422);
    return this.repository.sessions(context, data.data.offset);
  }
  async history(id: string) {
    const context = await this.client();
    this.id(id);
    return this.repository.history(context, id);
  }
  async clear(id: string) {
    const context = await this.client();
    this.id(id);
    await this.repository.clear(context, id);
    return { cleared: true };
  }
  async send(raw: unknown) {
    const context = await this.client();
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError(
        "INVALID_INPUT",
        "Enter a question without credentials and a valid submission key.",
        422,
      );
    if (
      !(await this.limits.consume(
        `chat:attempt:${context.profile.id}`,
        30,
        60,
      )) ||
      !(await this.limits.consume(
        `chat:daily:${context.profile.id}`,
        200,
        86400,
      ))
    )
      throw new AppError(
        "RATE_LIMITED",
        "Chat request limit reached. Try later.",
        429,
      );
    const claim = await this.repository.claim(context, parsed.data);
    if (!claim.claimed) {
      if (claim.status === "completed" && claim.result) return claim.result;
      throw new AppError(
        claim.status === "processing" ? "CHAT_PENDING" : "CHAT_UNAVAILABLE",
        claim.status === "processing"
          ? "This message is processing. Retry the same submission shortly."
          : "This message was interrupted or cleared. Start a new chat.",
        409,
      );
    }
    const previous = await this.repository.previousTopics(
      context,
      claim.sessionId,
    );
    let reply;
    try {
      reply = await this.support.clientAnswer(
        { message: parsed.data.message },
        previous,
      );
    } catch (error) {
      if (
        error instanceof AppError &&
        (error.status === 401 || error.status === 403)
      )
        throw error;
      reply = this.faq.respond({ message: parsed.data.message }, "fallback");
    }
    return this.repository.finish(context, parsed.data.requestId, reply);
  }
}
