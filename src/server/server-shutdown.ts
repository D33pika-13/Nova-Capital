import "server-only";
import { shutdownTelemetry } from "./telemetry-factory";
import { ConfigurationError } from "./errors";
export interface ShutdownResult {
  database: "closed" | "unavailable";
  telemetry: "closed" | "unavailable";
}
/** One process lifecycle, no request/user state. Errors and deadlines stay private. */
export class ServerShutdownCoordinator {
  private pending?: Promise<Readonly<ShutdownResult>>;
  constructor(
    private readonly closeDatabase: () => Promise<void>,
    private readonly closeTelemetry: () => Promise<void>,
    private readonly databaseTimeoutMs = 3000,
    private readonly telemetryTimeoutMs = 5000,
  ) {
    for (const timeout of [databaseTimeoutMs, telemetryTimeoutMs])
      if (!Number.isInteger(timeout) || timeout < 1 || timeout > 5000)
        throw new ConfigurationError(["SERVER_SHUTDOWN_TIMEOUT"]);
    if (databaseTimeoutMs + telemetryTimeoutMs > 8000)
      throw new ConfigurationError(["SERVER_SHUTDOWN_TIMEOUT"]);
  }
  shutdown() {
    return (this.pending ??= this.run());
  }
  private async close(work: () => Promise<void>, timeout: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve()
          .then(work)
          .then(() => "closed" as const),
        new Promise<"unavailable">((resolve) => {
          timer = setTimeout(() => resolve("unavailable"), timeout);
        }),
      ]);
    } catch {
      return "unavailable" as const;
    } finally {
      clearTimeout(timer);
    }
  }
  private async run(): Promise<Readonly<ShutdownResult>> {
    // Pool errors can still emit operational events while connections close.
    const database = await this.close(
      this.closeDatabase,
      this.databaseTimeoutMs,
    );
    const telemetry = await this.close(
      this.closeTelemetry,
      this.telemetryTimeoutMs,
    );
    return Object.freeze({ database, telemetry });
  }
}
const shutdownKey = Symbol.for("nova.server.shutdown");
const processResources = globalThis as typeof globalThis & {
  novaPool?: { end(): Promise<void> };
  novaShutdownStarted?: boolean;
};
export function installServerShutdown() {
  const existing: unknown = Reflect.get(globalThis, shutdownKey);
  if (existing !== undefined) {
    if (typeof existing !== "function")
      throw new ConfigurationError(["SERVER_SHUTDOWN_HOOK"]);
    return;
  }
  const coordinator = new ServerShutdownCoordinator(async () => {
    await processResources.novaPool?.end();
  }, shutdownTelemetry);
  let pending: Promise<void> | undefined;
  const hook = () =>
    (pending ??= (() => {
      processResources.novaShutdownStarted = true;
      return coordinator.shutdown().then((result) => {
        console.info(
          JSON.stringify({ event: "application.shutdown", ...result }),
        );
      });
    })());
  Object.defineProperty(globalThis, shutdownKey, {
    value: hook,
    writable: false,
    configurable: false,
  });
}
