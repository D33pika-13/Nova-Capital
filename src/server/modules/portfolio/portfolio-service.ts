import "server-only";
import { z } from "zod";
import {
  investmentSchema,
  investmentEditSchema,
  archiveSchema,
  snapshotSchema,
  type NewInvestment,
  type EditInvestment,
  type ArchiveInvestment,
  type NewSnapshot,
} from "@/lib/portfolio-inputs";
import type {
  InvestmentRecord,
  InvestmentRevision,
  PortfolioSnapshot,
} from "@/lib/models";
import type {
  AuthorizationService,
  AuthorizedContext,
} from "@/server/modules/identity/authorization-service";
import { AppError } from "@/server/errors";
import { FinancialCalculator } from "./financial-calculator";
export interface PortfolioRepository {
  read(
    context: AuthorizedContext,
    clientId: string,
  ): Promise<{
    investments: InvestmentRecord[];
    snapshots: PortfolioSnapshot[];
    revisions: InvestmentRevision[];
  }>;
  createInvestment(
    context: AuthorizedContext,
    input: NewInvestment,
  ): Promise<InvestmentRecord>;
  editInvestment(
    context: AuthorizedContext,
    clientId: string,
    id: string,
    input: EditInvestment,
  ): Promise<InvestmentRecord>;
  archiveInvestment(
    context: AuthorizedContext,
    clientId: string,
    id: string,
    input: ArchiveInvestment,
  ): Promise<InvestmentRecord>;
  appendSnapshot(
    context: AuthorizedContext,
    input: NewSnapshot,
  ): Promise<PortfolioSnapshot>;
}
export class PortfolioService {
  constructor(
    private readonly auth: AuthorizationService,
    private readonly repository: PortfolioRepository,
    private readonly calculator: FinancialCalculator,
    private readonly now: () => Date = () => new Date(),
  ) {}
  private validateDate(date: string) {
    if (new Date(date) > this.now())
      throw new AppError(
        "FUTURE_DATE",
        "A reporting date cannot be in the future.",
        422,
      );
  }
  private async overview(context: AuthorizedContext, clientId: string) {
    const data = await this.repository.read(context, clientId);
    return {
      ...data,
      lastRecordedAt: data.snapshots.length
        ? data.snapshots.reduce(
            (latest, s) => (s.createdAt > latest ? s.createdAt : latest),
            data.snapshots[0].createdAt,
          )
        : null,
      investments: data.investments.map((i) => ({
        ...i,
        ...this.calculator.returns(i.reportedValue, i.investedAmount),
      })),
      revisions: data.revisions.map((i) => ({
        ...i,
        ...this.calculator.returns(i.reportedValue, i.investedAmount),
      })),
      summaries: this.calculator.summaries(data.snapshots),
      allocation: this.calculator.allocation(data.investments),
      holdingTotals: this.calculator.holdingTotals(data.investments),
    };
  }
  async clientOverview() {
    const context = await this.auth.requireUser();
    return this.overview(context, context.profile.id);
  }
  async adminOverview(clientId: string) {
    const context = await this.auth.requireAdmin();
    if (!z.uuid().safeParse(clientId).success)
      throw new AppError("NOT_FOUND", "Client not found.", 404);
    return this.overview(context, clientId);
  }
  async createInvestment(input: unknown) {
    const context = await this.auth.requireAdmin();
    const data = investmentSchema.safeParse(input);
    if (!data.success)
      throw new AppError(
        "INVALID_INPUT",
        "Check the client, asset, currency, amounts and reporting date. Amounts support up to four decimal places.",
        422,
      );
    this.validateDate(data.data.reportedAt);
    return this.repository.createInvestment(context, data.data);
  }
  async editInvestment(clientId: string, id: string, input: unknown) {
    const context = await this.auth.requireAdmin();
    const data = investmentEditSchema.safeParse(input);
    if (
      !z.uuid().safeParse(clientId).success ||
      !z.uuid().safeParse(id).success ||
      !data.success
    )
      throw new AppError(
        "INVALID_INPUT",
        "Check the investment correction and reason.",
        422,
      );
    this.validateDate(data.data.reportedAt);
    return this.repository.editInvestment(context, clientId, id, data.data);
  }
  async archiveInvestment(clientId: string, id: string, input: unknown) {
    const context = await this.auth.requireAdmin();
    const data = archiveSchema.safeParse(input);
    if (
      !z.uuid().safeParse(clientId).success ||
      !z.uuid().safeParse(id).success ||
      !data.success
    )
      throw new AppError(
        "INVALID_INPUT",
        "Provide the current version and an archival reason.",
        422,
      );
    return this.repository.archiveInvestment(context, clientId, id, data.data);
  }
  async appendSnapshot(input: unknown) {
    const context = await this.auth.requireAdmin();
    const data = snapshotSchema.safeParse(input);
    if (!data.success)
      throw new AppError(
        "INVALID_INPUT",
        "Check the snapshot values, calculation basis and correction details.",
        422,
      );
    this.validateDate(data.data.reportedAt);
    return this.repository.appendSnapshot(context, data.data);
  }
}
