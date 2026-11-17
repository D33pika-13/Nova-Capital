import "server-only";
import type { AuthorizedContext } from "../identity/authorization-service";
import type { SupportReply, SupportTopic } from "@/lib/support-inputs";
export interface ChatTurn {
  sessionId: string;
  requestId: string;
  reply: SupportReply;
  createdAt: string;
}
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  reply: SupportReply | null;
}
export interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
}
export interface ChatRepository {
  sessions(context: AuthorizedContext, offset: number): Promise<ChatSession[]>;
  history(context: AuthorizedContext, id: string): Promise<ChatMessage[]>;
  previousTopics(
    context: AuthorizedContext,
    id: string,
  ): Promise<SupportTopic[]>;
  claim(
    context: AuthorizedContext,
    input: { requestId: string; sessionId: string | null; message: string },
  ): Promise<{
    claimed: boolean;
    status: string;
    sessionId: string;
    result: ChatTurn | null;
  }>;
  finish(
    context: AuthorizedContext,
    requestId: string,
    reply: SupportReply,
  ): Promise<ChatTurn>;
  clear(context: AuthorizedContext, id: string): Promise<void>;
}
