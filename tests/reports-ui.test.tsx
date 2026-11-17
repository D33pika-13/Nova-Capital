import { renderToStaticMarkup } from "react-dom/server";
import { it, expect, vi } from "vitest";
import { ReportList } from "@/components/report-list";
import { ReportUploadForm } from "@/components/report-forms";
import { reportCalendarDay } from "@/lib/report-inputs";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
it("shows an honest empty state and client-safe download routes without storage credentials", () => {
  expect(
    renderToStaticMarkup(<ReportList reports={[]} ttlSeconds={60} />),
  ).toContain("No reports available");
  const html = renderToStaticMarkup(
    <ReportList
      reports={[
        {
          id: "synthetic-report",
          clientId: "client-a",
          title: "<script>fixture</script>",
          fileName: "report.pdf",
          periodStart: "2026-01-01",
          periodEnd: "2026-01-31",
          reportDate: "2026-02-01",
          status: "available",
          sizeBytes: 1000,
          pageCount: 1,
          createdAt: "2026-02-01T00:00:00Z",
          publishedAt: "2026-02-01T00:00:00Z",
          downloadable: true,
        },
      ]}
      ttlSeconds={60}
    />,
  );
  expect(html).toContain("/api/reports/synthetic-report/download");
  expect(html).not.toContain("token=");
  expect(html).toContain("&lt;script&gt;fixture&lt;/script&gt;");
  expect(html).toContain("60 seconds");
});
it("labels the original upload, limits and business report-date timezone", () => {
  const html = renderToStaticMarkup(
    <ReportUploadForm
      clientId="synthetic-client"
      maxBytes={5242880}
      timeZone="Asia/Kolkata"
    />,
  );
  expect(html).toContain("Original PDF report");
  expect(html).toContain("Report date (Asia/Kolkata)");
  expect(html).toContain("Maximum 5 MiB");
  expect(
    reportCalendarDay(new Date("2026-11-10T18:31:00Z"), "Asia/Kolkata"),
  ).toBe("2026-11-11");
});
