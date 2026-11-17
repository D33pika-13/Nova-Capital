export type AssetClass = "stocks" | "forex" | "commodities" | "crypto";
export type ClientStatus = "active" | "suspended" | "deactivated";
export interface ClientRecord {
  id: string;
  clientId: string;
  displayName: string;
  email: string;
  status: ClientStatus;
  createdAt: string;
  updatedAt: string;
  identityLinked: boolean;
  invitationStatus: string | null;
}
export interface InvestmentRecord {
  id: string;
  clientId: string;
  assetClass: AssetClass;
  description: string;
  currency: string;
  investedAmount: string;
  reportedValue: string;
  reportedAt: string;
  archivedAt: string | null;
  version: number;
  profitLoss?: string | null;
  returnPercent?: string | null;
  correctionReason: string | null;
}
export interface InvestmentRevision extends InvestmentRecord {
  investmentId: string;
  recordedAt: string;
}
export interface PortfolioSnapshot {
  id: string;
  clientId: string;
  currency: string;
  adjustedBasis: string | null;
  reportedValue: string;
  basisExplanation: string;
  reportedAt: string;
  createdAt: string;
  correctionOf: string | null;
  correctionReason: string | null;
  superseded: boolean;
}
export interface PortfolioSummary {
  currency: string;
  reportedValue: string;
  adjustedBasis: string | null;
  profitLoss: string | null;
  returnPercent: string | null;
  reportedAt: string;
  basisExplanation: string;
}
export interface Allocation {
  currency: string;
  assetClass: AssetClass;
  reportedValue: string;
  sharePercent: string | null;
}
export interface PortfolioView {
  lastRecordedAt: string | null;
  investments: InvestmentRecord[];
  snapshots: PortfolioSnapshot[];
  revisions: InvestmentRevision[];
  summaries: PortfolioSummary[];
  allocation: Allocation[];
  holdingTotals: {
    currency: string;
    investedAmount: string;
    reportedValue: string;
  }[];
}

export interface ReportRecord {
  id: string;
  clientId: string;
  title: string;
  fileName: string;
  periodStart: string;
  periodEnd: string;
  reportDate: string;
  status: "quarantined" | "available" | "archived";
  sizeBytes: number;
  pageCount: number | null;
  createdAt: string;
  publishedAt: string | null;
  downloadable: boolean;
}
