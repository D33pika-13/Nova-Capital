import "server-only";
import { createHash } from "node:crypto";
import type { ServerConfig } from "./configuration-service";
import type { Telemetry } from "./contracts";
import { ConsoleTelemetry } from "./telemetry";
import { AzureMonitorTelemetry } from "./providers/azure-monitor-telemetry";
import { AppError, ConfigurationError } from "./errors";
/** Process-scoped telemetry only; never contains a request identity. */
export class TelemetryFactory {
  private instance?: Telemetry;
  private closing?: Promise<void>;
  constructor(private readonly config: Readonly<ServerConfig>) {}
  create(): Telemetry {
    if (this.closing)
      throw new AppError(
        "SERVICES_DRAINING",
        "The server is shutting down.",
        503,
      );
    if (this.instance) return this.instance;
    if (this.config.OBSERVABILITY_PROVIDER === "azure_monitor")
      return (this.instance = new AzureMonitorTelemetry(this.config));
    if (this.config.OBSERVABILITY_PROVIDER === "console")
      return (this.instance = new ConsoleTelemetry());
    throw new ConfigurationError(["OBSERVABILITY_PROVIDER"]);
  }
  shutdown(): Promise<void> {
    return (this.closing ??= Promise.resolve().then(async () => {
      if (this.instance instanceof AzureMonitorTelemetry)
        await this.instance.shutdown();
    }));
  }
}

const processTelemetry = globalThis as typeof globalThis & {
  novaTelemetryFactory?: TelemetryFactory;
  novaTelemetryKey?: string;
};
export function loadTelemetry(config: Readonly<ServerConfig>) {
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        config.OBSERVABILITY_PROVIDER,
        config.APP_ENV,
        config.AZURE_MONITOR_CONNECTION_STRING ?? "",
        config.APPLICATION_INSIGHTS_NO_STATSBEAT ?? "",
        config.AZURE_CREDENTIAL_MODE,
        config.AZURE_CLIENT_ID ?? "",
      ]),
    )
    .digest("hex");
  if (!processTelemetry.novaTelemetryFactory) {
    const factory = new TelemetryFactory(config);
    factory.create();
    processTelemetry.novaTelemetryFactory = factory;
    processTelemetry.novaTelemetryKey = key;
  }
  if (processTelemetry.novaTelemetryKey !== key)
    throw new ConfigurationError(["OBSERVABILITY_PROVIDER (restart required)"]);
  return processTelemetry.novaTelemetryFactory.create();
}

export async function shutdownTelemetry() {
  await processTelemetry.novaTelemetryFactory?.shutdown();
}
