import { z } from "zod";
const fields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  category: z.enum(["member", "promotion", "travel"]),
  eligibility: z.string().trim().min(1).max(5000),
  terms: z.string().trim().min(1).max(10000),
  startsAt: z.iso
    .datetime({ offset: true })
    .transform((v) => new Date(v).toISOString()),
  endsAt: z.iso
    .datetime({ offset: true })
    .transform((v) => new Date(v).toISOString()),
  status: z.enum(["draft", "published", "expired"]),
};
export const offerSchema = z
  .object({ requestId: z.uuid(), ...fields })
  .strict()
  .refine((v) => v.endsAt > v.startsAt, { message: "End must follow start." });
export const offerEditSchema = z
  .object({
    requestId: z.uuid(),
    ...fields,
    expectedVersion: z.number().int().positive(),
  })
  .strict()
  .refine((v) => v.endsAt > v.startsAt, { message: "End must follow start." });
export type OfferInput = z.infer<typeof offerSchema>;
export type OfferEditInput = z.infer<typeof offerEditSchema>;
export interface Offer {
  id: string;
  title: string;
  description: string;
  category: "member" | "promotion" | "travel";
  eligibility: string;
  terms: string;
  startsAt: string;
  endsAt: string;
  status: "draft" | "published" | "expired";
  version: number;
  image?: { id: string; alt: string; width: number; height: number } | null;
}
