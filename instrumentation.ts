import type { Instrumentation } from "next";
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadConfig } = await import("./src/server/config");
    const { loadTelemetry } = await import("./src/server/telemetry-factory");
    loadTelemetry(await loadConfig());
    const { installServerShutdown } =
      await import("./src/server/server-shutdown");
    installServerShutdown();
  }
}
export const onRequestError: Instrumentation.onRequestError = async () => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadConfig } = await import("./src/server/config");
    const { loadTelemetry } = await import("./src/server/telemetry-factory");
    try {
      loadTelemetry(await loadConfig()).event("application.request_failed", {
        provider: "application",
        status: "failed",
      });
    } catch {
      /* Configuration/export failures must not expose the original request/error. */
    }
  }
};
