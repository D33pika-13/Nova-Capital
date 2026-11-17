import { z } from "zod";
import Decimal from "decimal.js";
import { amountSchema, supportedCurrencies } from "./portfolio-inputs";

export const withdrawalSchema = z
  .object({
    requestId: z.uuid(),
    clientId: z.uuid(),
    currency: z.enum(supportedCurrencies),
    amount: amountSchema.refine((value) => new Decimal(value).gt(0)),
    withdrawnAt: z.iso
      .datetime({ offset: true })
      .refine((value) => (value.match(/\.(\d+)/)?.[1].length ?? 0) <= 3)
      .transform((value) => new Date(value).toISOString()),
    reference: z.string().trim().min(1).max(300),
    correctionOf: z.uuid().nullable().default(null),
    correctionReason: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .nullable()
      .default(null),
  })
  .strict()
  .refine(
    (value) =>
      (value.correctionOf === null) === (value.correctionReason === null),
  );
export type NewWithdrawal = z.infer<typeof withdrawalSchema>;
export interface WithdrawalRecord {
  id: string;
  clientId: string;
  currency: string;
  amount: string;
  withdrawnAt: string;
  reference: string;
  createdAt: string;
  correctionOf: string | null;
  correctionReason: string | null;
  superseded: boolean;
}
