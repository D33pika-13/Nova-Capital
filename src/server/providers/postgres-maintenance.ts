import "server-only";
import type { Database } from "../database";
import type { AuthorizedContext } from "../modules/identity/authorization-service";
import type {
  MaintenanceRepository,
  MaintenanceStatusRecord,
} from "../modules/offers/maintenance-service";
import { AppError } from "../errors";
export class PostgresMaintenanceRepository implements MaintenanceRepository {
  constructor(private readonly db: Database) {}
  async expireOffers(context: AuthorizedContext | null) {
    const row = await this.db.withIdentity(
      context?.identity ?? null,
      async (sql) =>
        (
          await sql.query<{ outcome: string; expired_offers: number | null }>(
            "select * from private.run_maintenance_batch()",
          )
        ).rows[0],
    );
    // Failure history must commit before translating the terminal result to HTTP.
    if (row?.outcome === "failed")
      throw new AppError(
        "MAINTENANCE_FAILED",
        "Maintenance could not be completed.",
        503,
      );
    if (
      row?.outcome !== "completed" ||
      !Number.isInteger(row.expired_offers) ||
      row.expired_offers === null ||
      row.expired_offers < 0 ||
      row.expired_offers > 500
    )
      throw new AppError(
        "MAINTENANCE_UNCONFIRMED",
        "Maintenance completion could not be confirmed.",
        503,
      );
    return row.expired_offers;
  }
  async status(context: AuthorizedContext): Promise<MaintenanceStatusRecord> {
    const row = await this.db.withIdentity(
      context.identity,
      async (sql) =>
        (
          await sql.query<{
            observed_at: string;
            recovery_boundary_at: string | null;
            last_scheduled_success_at: string | null;
            last_scheduled_finished_at: string | null;
            last_scheduled_outcome: "completed" | "failed" | null;
            last_scheduled_expired_offers: number | null;
            last_admin_finished_at: string | null;
          }>(
            "select observed_at::text,last_scheduled_success_at::text,last_scheduled_finished_at::text,last_scheduled_outcome,last_scheduled_expired_offers,last_admin_finished_at::text,recovery_boundary_at::text from private.maintenance_status()",
          )
        ).rows[0],
    );
    if (!row)
      throw new AppError(
        "MAINTENANCE_STATUS_UNAVAILABLE",
        "Maintenance status is unavailable.",
        503,
      );
    return {
      observedAt: row.observed_at,
      recoveryBoundaryAt: row.recovery_boundary_at,
      lastScheduledSuccessAt: row.last_scheduled_success_at,
      lastScheduledFinishedAt: row.last_scheduled_finished_at,
      lastScheduledOutcome: row.last_scheduled_outcome,
      lastScheduledExpiredOffers: row.last_scheduled_expired_offers,
      lastAdminFinishedAt: row.last_admin_finished_at,
    };
  }
}
