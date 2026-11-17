import { z } from "zod";
export const offerImageSchema = z
  .object({
    requestId: z.uuid(),
    expectedVersion: z.number().int().positive().max(2147483647),
    alt: z.string().trim().min(1).max(200),
  })
  .strict();
export const removeOfferImageSchema = z
  .object({
    requestId: z.uuid(),
    expectedVersion: z.number().int().positive().max(2147483647),
  })
  .strict();
export type OfferImageInput = z.infer<typeof offerImageSchema>;
