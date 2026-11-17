import "server-only";
import { faqGuidance } from "@/lib/site-config";
import type {
  SupportReply,
  SupportTopic,
  SupportLink,
} from "@/lib/support-inputs";
import { supportMessageSchema } from "@/lib/support-inputs";
import { AppError } from "@/server/errors";
import type { SupportFaq } from "./support-contracts";
export class FaqResponder implements SupportFaq {
  guidance(topic: SupportTopic): { text: string; links: SupportLink[] } {
    switch (topic) {
      case "funds":
        return { text: faqGuidance[0].answer, links: [] };
      case "reporting":
        return {
          text: faqGuidance[1].answer,
          links: [{ label: "Client portal", href: "/portal" }],
        };
      case "access":
        return {
          text: faqGuidance[2].answer,
          links: [{ label: "Client Login", href: "/login" }],
        };
      case "risk":
        return {
          text: faqGuidance[3].answer,
          links: [{ label: "Contact support", href: "/contact" }],
        };
      case "reports":
        return {
          text: faqGuidance[4].answer,
          links: [{ label: "Private reports", href: "/portal/reports" }],
        };
      case "offers":
        return {
          text: "Current published benefits appear on the Benefits page. Review their validity, eligibility and terms.",
          links: [{ label: "Benefits", href: "/benefits" }],
        };
      case "support":
        return {
          text: "Use the contact form to ask the configured support team about services, account access or reports. Submission and email-service acceptance are distinct from inbox delivery or a human response.",
          links: [{ label: "Contact support", href: "/contact" }],
        };
      case "refuse":
        return {
          text: "I can explain recorded information and website processes. I cannot change investments or accounts, execute trades, provide personalized investment advice, guarantee returns or access another client's information. Contact an authorized human representative for help.",
          links: [{ label: "Contact support", href: "/contact" }],
        };
      default:
        return {
          text: "I can help with website FAQs, login, reports and contacting support. Sign in to the client portal to view your own recorded financial information.",
          links: [
            { label: "Client portal", href: "/portal" },
            { label: "Contact support", href: "/contact" },
          ],
        };
    }
  }
  topic(message: string): SupportTopic {
    const text = message.toLowerCase();
    if (
      /\b(buy|sell|execute|recommend|trade for me)\b|should i invest|(?:change|set|modify|delete).*(?:investment|allocation|portfolio value)|another client|other clients/.test(
        text,
      )
    )
      return "refuse";
    if (/password|login|log in|sign in|invitation|account access/.test(text))
      return "access";
    if (/guarantee|\brisk\b/.test(text)) return "risk";
    if (/funds held|custod|where.*fund|\bdeposit/.test(text)) return "funds";
    if (
      /\breport\b|\breports\b/.test(text) &&
      !/portfolio|value|profit|loss/.test(text)
    )
      return "reports";
    if (/offer|benefit|travel|promotion/.test(text)) return "offers";
    if (/how.*updat|live.*(?:data|feed)|manual/.test(text)) return "reporting";
    if (/contact|human|support/.test(text)) return "support";
    return "unknown";
  }
  respond(raw: unknown, mode: "faq" | "fallback" = "faq"): SupportReply {
    const input = supportMessageSchema.safeParse(raw);
    if (!input.success)
      throw new AppError(
        "INVALID_INPUT",
        "Enter a support question of up to 2000 characters.",
        422,
      );
    const topic = this.topic(input.data.message);
    const guidance = this.guidance(topic);
    return {
      text: `${mode === "faq" ? "FAQ-only support. Personalized AI answers are unavailable in this environment." : "AI support is temporarily unavailable. Here is approved website guidance."}\n\n${guidance.text}`,
      links: guidance.links,
      mode,
      topics: [topic],
      currency: null,
    };
  }
}
