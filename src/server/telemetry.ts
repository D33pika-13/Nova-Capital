import "server-only";
import type { Telemetry } from "./contracts";
// Only allow known operational fields. Never log arbitrary requests or provider errors.
const allowed = new Set([
  "operation",
  "status",
  "durationMs",
  "provider",
  "code",
]);
export class ConsoleTelemetry implements Telemetry {
  event(name: string, fields: Record<string, string | number | boolean> = {}) {
    const safe = Object.fromEntries(
      Object.entries(fields).filter(([key]) => allowed.has(key)),
    );
    if (
      [
        "maintenance.batch_completed",
        "maintenance.batch_failed",
        "maintenance.batch_unconfirmed",
      ].includes(name) &&
      ["scheduler", "admin"].includes(String(fields.maintenanceOrigin))
    )
      safe.maintenanceOrigin = fields.maintenanceOrigin;
    console.info(
      JSON.stringify({
        event: name.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 80),
        ...safe,
      }),
    );
  }
}
