import "server-only";
import Decimal from "decimal.js";
import type {
  InvestmentRecord,
  PortfolioSnapshot,
  PortfolioSummary,
  Allocation,
} from "@/lib/models";
const Exact = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export class FinancialCalculator {
  returns(value: string, basis: string | null) {
    if (basis === null) return { profitLoss: null, returnPercent: null };
    const cost = new Exact(basis);
    const profit = new Exact(value).minus(cost);
    return {
      profitLoss: profit.toFixed(4),
      returnPercent: cost.gt(0) ? profit.div(cost).mul(100).toFixed(4) : null,
    };
  }
  summaries(snapshots: PortfolioSnapshot[]): PortfolioSummary[] {
    const latest = new Map<string, PortfolioSnapshot>();
    for (const snapshot of snapshots
      .filter((s) => !s.superseded)
      .sort(
        (a, b) =>
          new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime() ||
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ))
      if (!latest.has(snapshot.currency))
        latest.set(snapshot.currency, snapshot);
    return [...latest.values()].map((s) => ({
      currency: s.currency,
      reportedValue: s.reportedValue,
      adjustedBasis: s.adjustedBasis,
      reportedAt: s.reportedAt,
      basisExplanation: s.basisExplanation,
      ...this.returns(s.reportedValue, s.adjustedBasis),
    }));
  }
  allocation(
    investments: Pick<
      InvestmentRecord,
      "archivedAt" | "currency" | "assetClass" | "reportedValue"
    >[],
  ): Allocation[] {
    const totals = new Map<string, Decimal>();
    const groups = new Map<
      string,
      {
        currency: string;
        assetClass: InvestmentRecord["assetClass"];
        value: Decimal;
      }
    >();
    for (const i of investments.filter((i) => !i.archivedAt)) {
      totals.set(
        i.currency,
        (totals.get(i.currency) ?? new Exact(0)).plus(i.reportedValue),
      );
      const key = `${i.currency}:${i.assetClass}`;
      const group = groups.get(key) ?? {
        currency: i.currency,
        assetClass: i.assetClass,
        value: new Exact(0),
      };
      group.value = group.value.plus(i.reportedValue);
      groups.set(key, group);
    }
    return [...groups.values()].map((g) => ({
      currency: g.currency,
      assetClass: g.assetClass,
      reportedValue: g.value.toFixed(4),
      sharePercent: totals.get(g.currency)!.gt(0)
        ? g.value.div(totals.get(g.currency)!).mul(100).toFixed(4)
        : null,
    }));
  }
  holdingTotals(investments: InvestmentRecord[]) {
    const totals = new Map<
      string,
      { currency: string; investedAmount: Decimal; reportedValue: Decimal }
    >();
    for (const i of investments.filter((i) => !i.archivedAt)) {
      const t = totals.get(i.currency) ?? {
        currency: i.currency,
        investedAmount: new Exact(0),
        reportedValue: new Exact(0),
      };
      t.investedAmount = t.investedAmount.plus(i.investedAmount);
      t.reportedValue = t.reportedValue.plus(i.reportedValue);
      totals.set(i.currency, t);
    }
    return [...totals.values()].map((t) => ({
      currency: t.currency,
      investedAmount: t.investedAmount.toFixed(4),
      reportedValue: t.reportedValue.toFixed(4),
    }));
  }
}
