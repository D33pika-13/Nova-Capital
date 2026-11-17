import { z } from "zod";
import Decimal from "decimal.js";
export const supportedCurrencies = [
  "INR",
  "USD",
  "EUR",
  "GBP",
  "AED",
  "JPY",
  "CAD",
  "AUD",
  "CHF",
  "SGD",
  "NZD",
  "HKD",
  "CNY",
  "KRW",
  "SAR",
  "QAR",
  "KWD",
  "BHD",
  "OMR",
  "ZAR",
  "BRL",
  "MXN",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "TRY",
  "ILS",
  "THB",
  "MYR",
  "IDR",
  "PHP",
  "VND",
  "PKR",
  "BDT",
  "LKR",
  "NPR",
  "EGP",
  "NGN",
  "KES",
] as const;
export const assetClasses = [
  "stocks",
  "forex",
  "commodities",
  "crypto",
] as const;
export const amountSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,4})?$/)
  .transform((value) => new Decimal(value).toFixed(4));
const reportedDateSchema = z.iso
  .datetime({ offset: true })
  .refine((value) => (value.match(/\.(\d+)/)?.[1].length ?? 0) <= 3)
  .transform((value) => new Date(value).toISOString());
const shared = {
  assetClass: z.enum(assetClasses),
  description: z.string().trim().min(1).max(500),
  investedAmount: amountSchema,
  reportedValue: amountSchema,
  reportedAt: reportedDateSchema,
};
export const investmentSchema = z
  .object({
    requestId: z.uuid(),
    clientId: z.uuid(),
    currency: z.enum(supportedCurrencies),
    ...shared,
  })
  .strict();
export const investmentEditSchema = z
  .object({
    requestId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    ...shared,
    correctionReason: z.string().trim().min(1).max(1000),
  })
  .strict();
export const archiveSchema = z
  .object({
    requestId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export const snapshotSchema = z
  .object({
    requestId: z.uuid(),
    clientId: z.uuid(),
    currency: z.enum(supportedCurrencies),
    adjustedBasis: amountSchema.nullable(),
    reportedValue: amountSchema,
    basisExplanation: z.string().trim().min(1).max(1000),
    reportedAt: reportedDateSchema,
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
export type NewInvestment = z.infer<typeof investmentSchema>;
export type EditInvestment = z.infer<typeof investmentEditSchema>;
export type ArchiveInvestment = z.infer<typeof archiveSchema>;
export type NewSnapshot = z.infer<typeof snapshotSchema>;
