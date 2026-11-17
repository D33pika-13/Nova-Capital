import "server-only";
import {
  supportMessageSchema,
  supportPlanSchema,
  type SupportReply,
  type SupportTopic,
  type SupportLink,
  type SupportPlan,
} from "@/lib/support-inputs";
import type {
  AuthorizationService,
  AuthorizedContext,
} from "../identity/authorization-service";
import type { RateLimiter } from "@/server/contracts";
import type {
  SupportPlanner,
  SupportFacts,
  SupportFaq,
  SupportClientAnswers,
} from "./support-contracts";
import { FinancialCalculator } from "../portfolio/financial-calculator";
import { AppError } from "@/server/errors";
import { formatMoney } from "@/lib/format";
export class SupportService implements SupportClientAnswers {
  constructor(
    private readonly auth: AuthorizationService,
    private readonly facts: SupportFacts,
    private readonly planner: SupportPlanner,
    private readonly limits: RateLimiter,
    private readonly calculator: FinancialCalculator,
    private readonly faq: SupportFaq,
    private readonly globalAiLimit = 1000,
  ) {}
  private input(raw: unknown) {
    const parsed = supportMessageSchema.safeParse(raw);
    if (!parsed.success)
      throw new AppError(
        "INVALID_INPUT",
        "Enter a support question up to 2000 characters without credentials or tokens.",
        422,
      );
    return parsed.data.message;
  }
  private async limit(key: string) {
    if (
      !(await this.limits.consume(`support:${key}`, 10, 60)) ||
      !(await this.limits.consume(`support:daily:${key}`, 100, 86400))
    )
      throw new AppError(
        "RATE_LIMITED",
        "Support request limit reached. Try later or use the portal directly.",
        429,
      );
    if (
      this.planner.enabled &&
      !(await this.limits.consume(
        "support:global-ai",
        this.globalAiLimit,
        86400,
      ))
    )
      throw new AppError(
        "RATE_LIMITED",
        "The AI support allowance has been reached. Use the portal or contact support.",
        429,
      );
  }
  async publicAnswer(raw: unknown) {
    const message = this.input(raw);
    await this.limit("public");
    return this.answer(message, null, []);
  }
  async clientAnswer(raw: unknown, previousTopics: SupportTopic[] = []) {
    const context = await this.auth.requireUser();
    if (context.profile.role !== "client")
      throw new AppError(
        "FORBIDDEN",
        "Client support requires a client account.",
        403,
      );
    const message = this.input(raw);
    await this.limit(context.profile.id);
    const reply = await this.answer(message, context, previousTopics);
    // Revocation during an AI/database request must not disclose a completed answer.
    const current = await this.auth.requireUser();
    if (
      current.profile.id !== context.profile.id ||
      current.profile.role !== "client"
    )
      throw new AppError(
        "FORBIDDEN",
        "Client access changed. Sign in again.",
        403,
      );
    return reply;
  }
  private async answer(
    message: string,
    context: AuthorizedContext | null,
    previousTopics: SupportTopic[],
  ): Promise<SupportReply> {
    if (!this.planner.enabled) return this.faq.respond({ message });
    let plan: SupportPlan;
    try {
      const parsed = supportPlanSchema.safeParse(
        await this.planner.plan(message, previousTopics),
      );
      if (!parsed.success) throw new Error("invalid");
      plan = parsed.data;
    } catch {
      return this.faq.respond({ message }, "fallback");
    }
    if (plan.topics.includes("refuse")) {
      const safe = this.faq.guidance("refuse");
      return { ...safe, mode: "ai", topics: ["refuse"], currency: null };
    }
    const blocks: string[] = [];
    const links: SupportLink[] = [];
    for (const topic of plan.topics) {
      const personal = [
        "portfolio",
        "updates",
        "pnl",
        "allocation",
        "reports",
        "announcements",
      ].includes(topic);
      if (personal && !context) {
        blocks.push(
          "Sign in to your client account to view your own recorded information. Public support cannot access personal financial records.",
        );
        links.push({ label: "Client Login", href: "/login" });
        continue;
      }
      if (topic === "portfolio" || topic === "pnl") {
        const snapshots = await this.facts.snapshots(context!, plan.currency);
        if (!snapshots.length)
          blocks.push(
            "No portfolio snapshot is recorded for this account and currency selection. A missing value is not a zero balance.",
          );
        for (const row of snapshots) {
          if (topic === "portfolio")
            blocks.push(
              `Your manually reported portfolio value is ${formatMoney(row.reportedValue, row.currency)}, as at ${row.reportedAt}. This is not a live broker valuation.`,
            );
          else {
            const returns = this.calculator.returns(
              row.reportedValue,
              row.adjustedBasis,
            );
            blocks.push(
              `Your ${row.currency} snapshot at ${row.reportedAt}: reported value ${formatMoney(row.reportedValue, row.currency)}; adjusted basis ${formatMoney(row.adjustedBasis, row.currency)}; reported profit/loss ${formatMoney(returns.profitLoss, row.currency)}. ${returns.returnPercent === null ? "A percentage return is unavailable because the basis is zero or unrecorded." : `Simple non-annualized return: ${returns.returnPercent}%.`} Basis explanation excerpt: ${row.basisExplanation}. These are recorded facts, not a forecast.`,
            );
          }
        }
        links.push({
          label: "Portfolio details and calculation basis",
          href: "/portal",
        });
      } else if (topic === "updates") {
        const update = await this.facts.lastUpdate(context!);
        blocks.push(
          update
            ? `Your latest portfolio snapshot entry was recorded at ${update.recordedAt}; its reporting date is ${update.reportedAt}. Recording time and valuation date are different; information is entered manually.`
            : "No portfolio snapshot update has been recorded for this account.",
        );
        links.push({ label: "Snapshot history", href: "/portal" });
      } else if (topic === "allocation") {
        const allocation = this.calculator.allocation(
          await this.facts.holdings(context!, plan.currency),
        );
        blocks.push(
          allocation.length
            ? "Your active investment records, grouped by currency and asset class (separate from portfolio snapshots):\n" +
                allocation
                  .map(
                    (row) =>
                      `${row.assetClass}: ${formatMoney(row.reportedValue, row.currency)}${row.sharePercent === null ? " (percentage unavailable for a zero total)" : ` (${row.sharePercent}% of recorded ${row.currency} holdings)`}`,
                  )
                  .join("\n")
            : "No active investment records are available for this currency selection.",
        );
        links.push({
          label: "Investment records and allocation",
          href: "/portal",
        });
      } else if (topic === "reports") {
        const rows = await this.facts.reports(context!);
        blocks.push(
          rows.length
            ? "Your available reports (up to five):\n" +
                rows
                  .slice(0, 5)
                  .map((row) => `${row.title} — report date ${row.reportDate}`)
                  .join("\n") +
                (rows.length > 5
                  ? "\nMore reports are available on the reports page."
                  : "")
            : "No available reports are assigned to your account.",
        );
        links.push({
          label: "Private reports and authorized downloads",
          href: "/portal/reports",
        });
      } else if (topic === "offers") {
        const rows = await this.facts.offers();
        blocks.push(
          rows.length
            ? "Current published offers (up to five):\n" +
                rows
                  .slice(0, 5)
                  .map(
                    (row) =>
                      `${row.title} — valid until ${row.endsAt} (end excluded)`,
                  )
                  .join("\n") +
                "\nReview full eligibility and terms on the Benefits page."
            : "No current published offers are available.",
        );
        links.push({
          label: "Benefits, eligibility and terms",
          href: "/benefits",
        });
      } else if (topic === "announcements") {
        const rows = await this.facts.announcements(context!);
        blocks.push(
          rows.length
            ? "Published announcements addressed to your account (up to three, excerpts):\n" +
                rows
                  .slice(0, 3)
                  .map((row) => `${row.title}: ${row.body}`)
                  .join("\n")
            : "No published announcements are addressed to your account.",
        );
        links.push({
          label: "Full announcements and read status",
          href: "/portal/announcements",
        });
      } else {
        const guidance = this.faq.guidance(topic);
        blocks.push(guidance.text);
        links.push(...guidance.links);
      }
    }
    let text = "";
    for (const block of blocks) {
      if ((text + "\n\n" + block).length > 7000) {
        text += "\n\nOpen the linked portal pages for additional details.";
        break;
      }
      text += (text ? "\n\n" : "") + block;
    }
    return {
      text,
      links: [...new Map(links.map((link) => [link.href, link])).values()],
      mode: "ai",
      topics: plan.topics,
      currency: plan.currency,
    };
  }
}
