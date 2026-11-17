import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type {
  AuthorizationService,
  AuthorizedContext,
} from "../identity/authorization-service";
import type { Telemetry } from "@/server/contracts";
import { AppError } from "@/server/errors";
export type MaintenanceState =
  "never" | "failed" | "stale" | "backlog" | "current";
export interface MaintenanceStatusRecord {
  observedAt: string;
  recoveryBoundaryAt: string | null;
  lastScheduledSuccessAt: string | null;
  lastScheduledFinishedAt: string | null;
  lastScheduledOutcome: "completed" | "failed" | null;
  lastScheduledExpiredOffers: number | null;
  lastAdminFinishedAt: string | null;
}
export interface MaintenanceRepository {
  expireOffers(context: AuthorizedContext | null): Promise<number>;
  status(context: AuthorizedContext): Promise<MaintenanceStatusRecord>;
}
export interface MaintenanceOptions {
  provider: "local" | "external" | "database";
  environment: "development" | "test" | "staging" | "production";
  secret?: string;
  staleAfterSeconds?: number;
}
export class MaintenanceService {
  constructor(
    private readonly auth: AuthorizationService,
    private readonly repository: MaintenanceRepository,
    private readonly options: MaintenanceOptions,
    private readonly telemetry?: Telemetry,
  ) {}
  private async expire(context: AuthorizedContext | null) {
    try {
      const expiredOffers = await this.repository.expireOffers(context);
      this.record("maintenance.batch_completed", "ok", context);
      return {
        expiredOffers,
        batchLimit: 500,
        mayHaveMore: expiredOffers === 500,
      };
    } catch (error) {
      const confirmed =
        error instanceof AppError && error.code === "MAINTENANCE_FAILED";
      this.record(
        confirmed
          ? "maintenance.batch_failed"
          : "maintenance.batch_unconfirmed",
        confirmed ? "failed" : "unavailable",
        context,
      );
      throw error;
    }
  }
  private record(
    name: string,
    status: string,
    context: AuthorizedContext | null,
  ) {
    try {
      this.telemetry?.event(name, {
        provider: "postgres",
        status,
        maintenanceOrigin: context === null ? "scheduler" : "admin",
      });
    } catch {
      /* Monitoring cannot turn a committed maintenance result into a retry. */
    }
  }
  async status() {
    const context = await this.auth.requireAdmin();
    const value = await this.repository.status(context);
    const threshold = this.options.staleAfterSeconds ?? 2700;
    const observed = Date.parse(value.observedAt);
    const dates = [
      value.lastScheduledSuccessAt,
      value.lastScheduledFinishedAt,
      value.lastAdminFinishedAt,
      value.recoveryBoundaryAt,
    ];
    if (
      !Number.isFinite(observed) ||
      !Number.isInteger(threshold) ||
      threshold < 60 ||
      threshold > 86400 ||
      dates.some(
        (date) =>
          date !== null &&
          (!Number.isFinite(Date.parse(date)) || Date.parse(date) > observed),
      )
    )
      throw new AppError(
        "MAINTENANCE_STATUS_UNAVAILABLE",
        "Maintenance status is unavailable.",
        503,
      );
    const last = value.lastScheduledFinishedAt;
    if (
      (last === null &&
        (value.lastScheduledOutcome !== null ||
          value.lastScheduledExpiredOffers !== null ||
          value.lastScheduledSuccessAt !== null)) ||
      (last !== null &&
        !["completed", "failed"].includes(value.lastScheduledOutcome ?? "")) ||
      (value.lastScheduledOutcome === "completed" &&
        (!Number.isInteger(value.lastScheduledExpiredOffers) ||
          value.lastScheduledExpiredOffers === null ||
          value.lastScheduledExpiredOffers < 0 ||
          value.lastScheduledExpiredOffers > 500 ||
          value.lastScheduledSuccessAt !== last)) ||
      (value.lastScheduledOutcome === "failed" &&
        value.lastScheduledExpiredOffers !== null) ||
      (last !== null &&
        value.lastScheduledSuccessAt !== null &&
        Date.parse(value.lastScheduledSuccessAt) > Date.parse(last))
    )
      throw new AppError(
        "MAINTENANCE_STATUS_UNAVAILABLE",
        "Maintenance status is unavailable.",
        503,
      );

    if (
      value.recoveryBoundaryAt !== null &&
      last !== null &&
      Date.parse(last) < Date.parse(value.recoveryBoundaryAt)
    )
      throw new AppError(
        "MAINTENANCE_STATUS_UNAVAILABLE",
        "Maintenance status is unavailable.",
        503,
      );
    const state: MaintenanceState =
      last === null
        ? "never"
        : value.lastScheduledOutcome === "failed"
          ? "failed"
          : observed - Date.parse(last) >= threshold * 1000
            ? "stale"
            : value.lastScheduledExpiredOffers === 500
              ? "backlog"
              : "current";
    const iso = (date: string | null) =>
      date === null ? null : new Date(date).toISOString();
    return {
      observedAt: new Date(observed).toISOString(),
      recoveryBoundaryAt: iso(value.recoveryBoundaryAt),
      lastScheduledSuccessAt: iso(value.lastScheduledSuccessAt),
      lastScheduledFinishedAt: iso(last),
      lastScheduledOutcome: value.lastScheduledOutcome,
      lastScheduledExpiredOffers: value.lastScheduledExpiredOffers,
      lastAdminFinishedAt: iso(value.lastAdminFinishedAt),
      state,
      staleAfterSeconds: threshold,
    };
  }

  async runAsAdmin() {
    return this.expire(await this.auth.requireAdmin());
  }
  async runScheduled(authorization: string | null) {
    const localAllowed =
      this.options.provider === "local" &&
      (this.options.environment === "development" ||
        this.options.environment === "test");
    if (
      (this.options.provider !== "external" && !localAllowed) ||
      !this.options.secret
    )
      throw new AppError(
        "SCHEDULER_UNAVAILABLE",
        "Scheduled maintenance is not configured.",
        503,
      );
    const expected = createHash("sha256")
      .update(`Bearer ${this.options.secret}`)
      .digest();
    const actual = createHash("sha256")
      .update(authorization ?? "")
      .digest();
    if (
      !authorization ||
      authorization.length > 1024 ||
      !timingSafeEqual(actual, expected)
    )
      throw new AppError(
        "UNAUTHENTICATED",
        "Maintenance authentication failed.",
        401,
      );
    return this.expire(null);
  }
}
