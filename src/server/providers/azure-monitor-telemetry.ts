import "server-only";
import { ROOT_CONTEXT, SpanStatusCode, type Tracer } from "@opentelemetry/api";
import {
  AlwaysOnSampler,
  BatchSpanProcessor,
  BasicTracerProvider,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { AzureMonitorTraceExporter } from "@azure/monitor-opentelemetry-exporter";
import {
  createDefaultHttpClient,
  type HttpClient,
} from "@azure/core-rest-pipeline";
import type { Telemetry } from "../contracts";
import type { ServerConfig } from "../configuration-service";
import { parseMonitorConnection } from "../monitor-settings";
import { ConfigurationError } from "../errors";
import { AzureCredentialFactory } from "./azure-credentials";
import { AzureMonitorCredential } from "./azure-monitor-credential";
import type { TokenCredential } from "@azure/identity";

const names = new Set([
  "database.pool_error",
  "auth.session_cleanup_failed",
  "application.request_failed",
  "application.started",
  "maintenance.batch_completed",
  "maintenance.batch_failed",
  "maintenance.batch_unconfirmed",
]);
/** Fixed operational vocabulary; no arbitrary string fields, errors or user context. */
export class AzureMonitorTelemetry implements Telemetry {
  private readonly provider: BasicTracerProvider;
  private readonly tracer: Tracer;
  private stopped = false;
  private shutdownTask?: Promise<void>;
  constructor(
    config: Readonly<
      Pick<
        ServerConfig,
        | "APP_ENV"
        | "AZURE_MONITOR_CONNECTION_STRING"
        | "APPLICATION_INSIGHTS_NO_STATSBEAT"
        | "AZURE_CREDENTIAL_MODE"
        | "AZURE_CLIENT_ID"
      >
    >,
    dependencies: {
      exporter?: SpanExporter;
      httpClient?: HttpClient;
      credential?: TokenCredential;
    } = {},
  ) {
    if (
      !["managed_identity", "azure_cli"].includes(
        config.AZURE_CREDENTIAL_MODE,
      ) ||
      (config.AZURE_CREDENTIAL_MODE === "azure_cli" &&
        !["development", "test"].includes(config.APP_ENV))
    )
      throw new ConfigurationError(["AZURE_CREDENTIAL_MODE"]);
    if (config.APPLICATION_INSIGHTS_NO_STATSBEAT !== "true")
      throw new ConfigurationError(["APPLICATION_INSIGHTS_NO_STATSBEAT"]);
    const settings = parseMonitorConnection(
      config.AZURE_MONITOR_CONNECTION_STRING ?? "",
    );
    // The pinned exporter reads this switch directly; never change process.env.
    if (
      !dependencies.exporter &&
      process.env.APPLICATION_INSIGHTS_NO_STATSBEAT !== "true"
    )
      throw new ConfigurationError(["APPLICATION_INSIGHTS_NO_STATSBEAT"]);
    const transport = dependencies.httpClient ?? createDefaultHttpClient();
    const exporter =
      dependencies.exporter ??
      new AzureMonitorTraceExporter({
        connectionString: settings.connectionString,
        credential: new AzureMonitorCredential(
          dependencies.credential ??
            new AzureCredentialFactory(config).create(3000),
        ),
        disableOfflineStorage: true,
        retryOptions: { maxRetries: 0 },
        httpClient: {
          async sendRequest(request) {
            const url = new URL(request.url);
            if (
              url.origin !== settings.origin ||
              url.pathname !== "/v2.1/track" ||
              url.search ||
              url.hash ||
              request.method !== "POST" ||
              !/^Bearer [\x21-\x7e]{16,16384}$/.test(
                request.headers.get("authorization") ?? "",
              )
            )
              throw Error("Telemetry destination denied");
            request.timeout = 3000;
            const response = await transport.sendRequest(request);
            // The exporter has its own redirect handler outside the Azure pipeline.
            if (
              (response.status >= 300 && response.status < 400) ||
              response.status === 401 ||
              response.status === 403
            )
              throw Error("Telemetry redirect denied");
            return response;
          },
        },
      });
    this.provider = new BasicTracerProvider({
      sampler: new AlwaysOnSampler(),
      resource: resourceFromAttributes({
        "service.name": "nova-capital",
        "deployment.environment.name": config.APP_ENV,
      }),
      spanProcessors: [
        new BatchSpanProcessor(exporter, {
          maxQueueSize: 256,
          maxExportBatchSize: 32,
          scheduledDelayMillis: 5000,
          exportTimeoutMillis: 4000,
        }),
      ],
      spanLimits: {
        attributeCountLimit: 6,
        attributeValueLengthLimit: 80,
        eventCountLimit: 0,
        linkCountLimit: 0,
      },
    });
    // Do not register globally: framework spans may contain URLs/queries/user claims.
    this.tracer = this.provider.getTracer("nova-operational-events", "1.0.0");
  }
  event(name: string, fields: Record<string, string | number | boolean> = {}) {
    if (this.stopped || !names.has(name)) return;
    try {
      const attributes: Record<string, string | number> = {};
      if (
        ["postgres", "entra", "supabase", "application"].includes(
          String(fields.provider),
        )
      )
        attributes["nova.provider"] = String(fields.provider);
      if (["ok", "failed", "unavailable"].includes(String(fields.status)))
        attributes["nova.status"] = String(fields.status);
      if (
        name.startsWith("maintenance.batch_") &&
        ["scheduler", "admin"].includes(String(fields.maintenanceOrigin))
      )
        attributes["nova.maintenance_origin"] = String(
          fields.maintenanceOrigin,
        );
      if (
        typeof fields.durationMs === "number" &&
        Number.isFinite(fields.durationMs) &&
        fields.durationMs >= 0 &&
        fields.durationMs <= 60000
      )
        attributes["nova.duration_ms"] = fields.durationMs;
      const span = this.tracer.startSpan(name, { attributes }, ROOT_CONTEXT);
      if (fields.status === "failed" || fields.status === "unavailable")
        span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    } catch {
      /* Export cannot change application authorization or response behavior. */
    }
  }
  async flush() {
    await this.provider.forceFlush();
  }
  shutdown(): Promise<void> {
    if (this.shutdownTask) return this.shutdownTask;
    this.stopped = true;
    return (this.shutdownTask = Promise.resolve().then(() =>
      this.provider.shutdown(),
    ));
  }
}
