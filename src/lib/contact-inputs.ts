import { z } from "zod";
export const contactTopics = {
  general: "Service enquiry",
  account: "Account access",
  reports: "Client reports",
  other: "Other",
} as const;
export const contactSchema = z
  .object({
    requestId: z.uuid(),
    name: z
      .string()
      .trim()
      .min(1)
      .max(150)
      .refine((v) => !/[\r\n\u0000]/.test(v)),
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    topic: z.enum(["general", "account", "reports", "other"]),
    message: z
      .string()
      .trim()
      .min(10)
      .max(5000)
      .refine((v) => !/[\u0000]/.test(v)),
    consent: z.literal(true),
    website: z
      .string()
      .max(200)
      .default("")
      .refine((v) => v === ""),
  })
  .strict();
export type ContactInput = z.infer<typeof contactSchema>;
export type ContactStatus = "processing" | "accepted" | "unknown";
export interface ContactResult {
  reference: string;
  status: ContactStatus;
  message: string;
}
