import "server-only";
import type {
  SupportPlan,
  SupportReply,
  SupportTopic,
} from "@/lib/support-inputs";
import type { AuthorizedContext } from "../identity/authorization-service";
import type { InvestmentRecord } from "@/lib/models";
export interface SupportFaq {
  guidance(topic: SupportTopic): Pick<SupportReply, "text" | "links">;
  respond(raw: unknown, mode?: "faq" | "fallback"): SupportReply;
}
export interface SupportClientAnswers {
  clientAnswer(
    raw: unknown,
    previousTopics?: SupportTopic[],
  ): Promise<SupportReply>;
}
export interface SupportPlanner {
  readonly enabled: boolean;
  plan(message: string, previousTopics: SupportTopic[]): Promise<SupportPlan>;
}
export interface SupportSnapshot {
  currency: string;
  reportedValue: string;
  adjustedBasis: string | null;
  reportedAt: string;
  basisExplanation: string;
}
export type SupportHolding = Pick<
  InvestmentRecord,
  "assetClass" | "currency" | "reportedValue" | "archivedAt"
>;
export interface SupportFacts {
  snapshots(
    context: AuthorizedContext,
    currency: string | null,
  ): Promise<SupportSnapshot[]>;
  lastUpdate(
    context: AuthorizedContext,
  ): Promise<{ recordedAt: string; reportedAt: string } | null>;
  holdings(
    context: AuthorizedContext,
    currency: string | null,
  ): Promise<SupportHolding[]>;
  reports(
    context: AuthorizedContext,
  ): Promise<{ title: string; reportDate: string }[]>;
  offers(): Promise<{ title: string; endsAt: string }[]>;
  announcements(
    context: AuthorizedContext,
  ): Promise<{ title: string; body: string }[]>;
}
