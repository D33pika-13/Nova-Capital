import "server-only";
import { createHash } from "node:crypto";
import type { Database } from "../database";
import type { AuthorizedContext } from "../modules/identity/authorization-service";
import type {
  ChatRepository,
  ChatTurn,
  ChatSession,
  ChatMessage,
} from "../modules/support/chat-contracts";
import { supportPlanSchema, type SupportReply } from "@/lib/support-inputs";
import { AppError } from "../errors";
const stamp = (field: string) =>
  `to_char(${field} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
export class PostgresChatRepository implements ChatRepository {
  constructor(private readonly db: Database) {}
  private error(error: unknown) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    if (code === "P0002")
      return new AppError(
        "CHAT_UNAVAILABLE",
        "Chat is unavailable or was cleared.",
        404,
      );
    if (code === "23505")
      return new AppError(
        "REQUEST_CONFLICT",
        "This request key was used for another message.",
        409,
      );
    if (code === "55P03")
      return new AppError(
        "CHAT_PENDING",
        "Another message is processing. Retry shortly.",
        409,
      );
    if (code === "54000")
      return new AppError(
        "CHAT_FULL",
        "This conversation is full. Start a new chat.",
        409,
      );
    if (code === "42501")
      return new AppError(
        "FORBIDDEN",
        "Active client access is required.",
        403,
      );
    return error;
  }
  async sessions(context: AuthorizedContext, offset: number) {
    return this.db.withIdentity(
      context.identity,
      async (sql) =>
        (
          await sql.query<ChatSession>(
            `select id,title,${stamp("updated_at")} as "updatedAt" from public.chat_sessions where client_id=$1 and cleared_at is null order by updated_at desc,id limit 20 offset $2`,
            [context.profile.id, offset],
          )
        ).rows,
    );
  }
  async history(context: AuthorizedContext, id: string) {
    return this.db.withIdentity(context.identity, async (sql) => {
      if (
        !(
          await sql.query(
            "select id from public.chat_sessions where id=$1 and client_id=$2 and cleared_at is null",
            [id, context.profile.id],
          )
        ).rows.length
      )
        throw new AppError(
          "CHAT_UNAVAILABLE",
          "Chat is unavailable or was cleared.",
          404,
        );
      return (
        await sql.query<ChatMessage>(
          `select id,role,content,${stamp("created_at")} as "createdAt",reply from public.chat_messages where session_id=$1 and client_id=$2 order by ordinal limit 100`,
          [id, context.profile.id],
        )
      ).rows;
    });
  }
  async previousTopics(context: AuthorizedContext, id: string) {
    const history = await this.history(context, id);
    const last = history
      .filter((m) => m.role === "assistant" && m.reply)
      .at(-1)?.reply;
    const parsed = supportPlanSchema.safeParse(
      last ? { topics: last.topics, currency: last.currency } : null,
    );
    return parsed.success ? parsed.data.topics : [];
  }
  async claim(
    context: AuthorizedContext,
    input: { requestId: string; sessionId: string | null; message: string },
  ) {
    const hash = createHash("sha256")
      .update(
        JSON.stringify({ sessionId: input.sessionId, message: input.message }),
      )
      .digest("hex");
    try {
      return await this.db.withIdentity(
        context.identity,
        async (sql) =>
          (
            await sql.query<{
              value: {
                claimed: boolean;
                status: string;
                sessionId: string;
                result: ChatTurn | null;
              };
            }>("select private.claim_chat($1,$2,$3,$4) as value", [
              input.requestId,
              hash,
              input.sessionId,
              input.message,
            ])
          ).rows[0].value,
      );
    } catch (error) {
      throw this.error(error);
    }
  }
  async finish(context: AuthorizedContext, id: string, reply: SupportReply) {
    try {
      return await this.db.withIdentity(
        context.identity,
        async (sql) =>
          (
            await sql.query<{ value: ChatTurn }>(
              "select private.finish_chat($1,$2::jsonb) as value",
              [id, JSON.stringify(reply)],
            )
          ).rows[0].value,
      );
    } catch (error) {
      throw this.error(error);
    }
  }
  async clear(context: AuthorizedContext, id: string) {
    try {
      await this.db.withIdentity(context.identity, async (sql) => {
        await sql.query("select private.clear_chat($1)", [id]);
      });
    } catch (error) {
      throw this.error(error);
    }
  }
}
