import { z } from "zod";
export const educationServices = {
  webinars: "Premium Webinars",
  mentorship: "Individual Mentorship Sessions",
} as const;
export const educationConfirmation =
  "Thank you for your interest! Our team has received your request and will contact you shortly.";
const singleLine = z
  .string()
  .trim()
  .min(1)
  .max(150)
  .refine((v) => !/[\x00-\x1f\x7f]/.test(v));
export const educationSchema = z
  .object({
    requestId: z.uuid(),
    name: singleLine,
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    phone: z
      .string()
      .trim()
      .min(7)
      .max(30)
      .regex(/^\+?[0-9() .-]+$/)
      .refine(
        (v) =>
          (v.match(/\d/g) ?? []).length >= 7 &&
          (v.match(/\d/g) ?? []).length <= 15,
      ),
    service: z.enum(["webinars", "mentorship"]),
    message: z
      .string()
      .trim()
      .max(3000)
      .refine((v) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v))
      .default(""),
    consent: z.literal(true),
    website: z.literal("").default(""),
  })
  .strict();
export const educationPageSchema = z
  .object({
    service: z.enum(["all", "webinars", "mentorship"]).default("all"),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict();
export type EducationInput = z.infer<typeof educationSchema>;
export type EducationPage = z.infer<typeof educationPageSchema>;
export interface EducationRequest {
  id: string;
  name: string;
  email: string;
  phone: string;
  service: keyof typeof educationServices;
  message: string;
  createdAt: string;
}
