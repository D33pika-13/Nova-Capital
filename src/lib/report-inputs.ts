import { z } from "zod";
export const reportMetadataSchema = z
  .object({
    requestId: z.uuid(),
    title: z.string().trim().min(1).max(200),
    fileName: z
      .string()
      .min(5)
      .max(200)
      .regex(/^[^/\\\u0000-\u001f\u007f]+\.pdf$/i),
    periodStart: z.iso.date(),
    periodEnd: z.iso.date(),
    reportDate: z.iso.date(),
  })
  .strict()
  .refine(
    (data) =>
      data.periodStart <= data.periodEnd && data.periodEnd <= data.reportDate,
  );

export function reportCalendarDay(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
