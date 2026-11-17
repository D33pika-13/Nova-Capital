import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { PortfolioView } from "@/components/portfolio-view";
import { InvestmentForm, SnapshotForm } from "@/components/investment-form";
import type { PortfolioView as View } from "@/lib/models";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const empty: View = {
  lastRecordedAt: null,
  investments: [],
  snapshots: [],
  revisions: [],
  summaries: [],
  allocation: [],
  holdingTotals: [],
};
describe("portfolio presentation boundaries", () => {
  it("renders an honest empty account without a fabricated balance or return", () => {
    const html = renderToStaticMarkup(<PortfolioView data={empty} />);
    expect(html).toContain("No portfolio snapshot recorded");
    expect(html).toContain("No investment records have been entered");
    expect(html).not.toContain("INR 0");
    expect(html).not.toContain("USD 0");
    expect(html).not.toContain("0.0000%");
    expect(html).not.toContain("Return = (reported value");
    expect(html).toContain("No portfolio update has been recorded.");
  });
  it("shows exact recorded values, missing basis and escaped descriptions", () => {
    const html = renderToStaticMarkup(
      <PortfolioView
        data={{
          ...empty,
          investments: [
            {
              id: "i",
              clientId: "c",
              assetClass: "stocks",
              description: "<script>private-payload</script>",
              currency: "USD",
              investedAmount: "100.1001",
              reportedValue: "110.2002",
              profitLoss: "10.1001",
              reportedAt: "2026-01-01T00:00:00.000Z",
              archivedAt: null,
              version: 1,
              correctionReason: null,
            },
          ],
          summaries: [
            {
              currency: "USD",
              reportedValue: "110.2002",
              adjustedBasis: null,
              profitLoss: null,
              returnPercent: null,
              reportedAt: "2026-01-01T00:00:00.000Z",
              basisExplanation: "Basis not supplied",
            },
          ],
        }}
      />,
    );
    expect(html).toContain("USD 110.2002");
    expect(html).toContain("USD 10.1001");
    expect(html).toContain("Not calculable");
    expect(html).toContain("&lt;script&gt;private-payload&lt;/script&gt;");
    expect(html).not.toContain("<script>private-payload");
  });
  it("provides native required fields and explicit UTC/currency semantics", () => {
    const html = renderToStaticMarkup(
      <InvestmentForm clientId="synthetic-client" />,
    );
    expect(html).toContain('id="investment-description" required=""');
    expect(html).toContain("Reporting date/time (UTC)");
    expect(html).toContain("Valuation currency");
    const snapshot = renderToStaticMarkup(
      <SnapshotForm clientId="synthetic-client" />,
    );
    expect(snapshot).toContain("Adjusted cost basis (optional)");
    expect(snapshot).toContain("Basis and cash-flow explanation");
    expect(snapshot).toContain('id="snapshot-basis-explanation" required=""');
  });
});
