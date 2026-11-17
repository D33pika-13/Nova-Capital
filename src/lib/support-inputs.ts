import { z } from "zod";
import { supportedCurrencies } from "./portfolio-inputs";
export const supportTopics = [
  "portfolio",
  "updates",
  "pnl",
  "allocation",
  "reports",
  "offers",
  "announcements",
  "funds",
  "reporting",
  "access",
  "risk",
  "support",
  "refuse",
  "unknown",
] as const;
export type SupportTopic = (typeof supportTopics)[number];
export const supportMessageSchema = z
  .object({
    message: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .refine((v) => !/[\u0000]/.test(v))
      .refine(
        (v) =>
          !/(?:\b(?:password|otp|api[_ -]?key|access[_ -]?token)\s*[:=]\s*\S+|\bsk-[A-Za-z0-9_-]{12,}|-----BEGIN[^-]*PRIVATE KEY|\bBearer\s+[A-Za-z0-9._~-]{12,})/i.test(
            v,
          ),
      ),
  })
  .strict();
export const supportPlanSchema = z
  .object({
    topics: z
      .array(z.enum(supportTopics))
      .min(1)
      .max(3)
      .transform((v) => [...new Set(v)]),
    currency: z.enum(supportedCurrencies).nullable(),
  })
  .strict();
export type SupportPlan = z.infer<typeof supportPlanSchema>;
export type SupportLink = {
  label: string;
  href:
    | "/portal"
    | "/portal/reports"
    | "/portal/announcements"
    | "/benefits"
    | "/contact"
    | "/login";
};
export interface SupportReply {
  text: string;
  links: SupportLink[];
  mode: "ai" | "faq" | "fallback";
  topics: SupportTopic[];
  currency: (typeof supportedCurrencies)[number] | null;
}
export const supportSuggestions = [
  "What is my current reported portfolio value?",
  "When was my portfolio last updated?",
  "What is my reported profit or loss?",
  "Can I view my investment breakdown?",
  "Where can I download my reports?",
  "What offers are currently available?",
  "How do I contact support?",
] as const;
