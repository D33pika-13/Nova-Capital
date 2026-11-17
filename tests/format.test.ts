import { it, expect } from "vitest";
import {
  formatMoney,
  formatDate,
  fromUtcInput,
  toUtcInput,
} from "@/lib/format";
import { amountSchema, investmentSchema } from "@/lib/portfolio-inputs";
it("preserves money beyond JavaScript's safe integer precision", () => {
  expect(formatMoney("9999999999999999.9999", "INR")).toBe(
    "INR 9,99,99,99,99,99,99,999.9999",
  );
  expect(formatMoney("-0.0001", "USD")).toBe("USD −0.0001");
  expect(formatMoney(null, "INR")).toBe("Not recorded");
});
it("normalizes decimal inputs without a floating-point round trip", () => {
  expect(amountSchema.parse("100.1")).toBe("100.1000");
  expect(amountSchema.safeParse(100.1).success).toBe(false);
});
it("labels dates explicitly in UTC and round-trips millisecond inputs", () => {
  const date = "2026-01-10T12:30:15.123Z";
  expect(fromUtcInput(toUtcInput(date))).toBe(date);
  expect(formatDate(date)).toContain("UTC");
});
it("normalizes reporting offsets and rejects unsupported submillisecond precision", () => {
  const input = {
    requestId: "20000000-0000-4000-8000-000000000001",
    clientId: "20000000-0000-4000-8000-000000000002",
    assetClass: "stocks",
    description: "Synthetic",
    currency: "USD",
    investedAmount: "1",
    reportedValue: "2",
    reportedAt: "2026-01-10T17:30:00+05:30",
  };
  expect(investmentSchema.parse(input).reportedAt).toBe(
    "2026-01-10T12:00:00.000Z",
  );
  expect(
    investmentSchema.safeParse({
      ...input,
      reportedAt: "2026-01-10T12:00:00.123456Z",
    }).success,
  ).toBe(false);
});
