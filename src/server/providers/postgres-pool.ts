import "server-only";
import { Pool } from "pg";
import type { Telemetry } from "../contracts";
import type { DatabaseConnectionSettings } from "../database-settings";
export class PostgresPoolFactory {
  constructor(
    private readonly settings: DatabaseConnectionSettings,
    private readonly telemetry: Telemetry,
  ) {}
  create() {
    const pool = new Pool(this.settings.poolConfig());
    pool.on("error", () =>
      this.telemetry.event("database.pool_error", {
        provider: "postgres",
        status: "unavailable",
      }),
    );
    return pool;
  }
}
