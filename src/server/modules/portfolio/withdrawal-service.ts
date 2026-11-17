import "server-only";
import { z } from "zod";
import type {
  AuthorizedContext,
  AuthorizationService,
} from "../identity/authorization-service";
import {
  withdrawalSchema,
  type NewWithdrawal,
  type WithdrawalRecord,
} from "@/lib/withdrawal-inputs";
import { AppError } from "@/server/errors";

export interface WithdrawalRepository {
  list(
    context: AuthorizedContext,
    clientId: string,
  ): Promise<WithdrawalRecord[]>;
  record(
    context: AuthorizedContext,
    input: NewWithdrawal,
  ): Promise<WithdrawalRecord>;
}
/** Records broker withdrawals for reporting; never transfers money or changes valuations. */
export class WithdrawalService {
  constructor(
    private readonly auth: AuthorizationService,
    private readonly repository: WithdrawalRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async clientList() {
    const context = await this.auth.requireUser();
    if (context.profile.role !== "client")
      throw new AppError("FORBIDDEN", "Client access is required.", 403);
    return this.repository.list(context, context.profile.id);
  }
  async adminList(clientId: string) {
    const context = await this.auth.requireAdmin();
    if (!z.uuid().safeParse(clientId).success)
      throw new AppError("NOT_FOUND", "Client not found.", 404);
    return this.repository.list(context, clientId);
  }
  async record(input: unknown) {
    const context = await this.auth.requireAdmin();
    const parsed = withdrawalSchema.safeParse(input);
    if (!parsed.success)
      throw new AppError(
        "INVALID_INPUT",
        "Enter a positive withdrawal amount, supported currency, date and reference. Corrections require a reason.",
        422,
      );
    if (new Date(parsed.data.withdrawnAt) > this.now())
      throw new AppError(
        "FUTURE_DATE",
        "A withdrawal date cannot be in the future.",
        422,
      );
    return this.repository.record(context, parsed.data);
  }
}
