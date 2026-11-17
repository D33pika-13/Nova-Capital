import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  createHttpHeaders,
  type PipelineRequest,
} from "@azure/core-rest-pipeline";
import { AzureMonitorTelemetry } from "@/server/providers/azure-monitor-telemetry";
import { ConfigurationService } from "@/server/configuration-service";
import { RuntimeConfigurationLoader } from "@/server/runtime-configuration";
import { loadTelemetry, TelemetryFactory } from "@/server/telemetry-factory";
import { ConsoleTelemetry } from "@/server/telemetry";
const connection =
  "InstrumentationKey=40000000-0000-4000-8000-000000000004;IngestionEndpoint=https://westus2-0.in.applicationinsights.azure.com";
const profile = {
  APP_ENV: "test",
  OBSERVABILITY_PROVIDER: "azure_monitor",
  AZURE_MONITOR_CONNECTION_STRING: connection,
  APPLICATION_INSIGHTS_NO_STATSBEAT: "true",
};
afterEach(() => vi.unstubAllEnvs());
describe("Azure Monitor configuration", () => {
  it("requires explicit endpoint/key and disables SDK background telemetry", () => {
    expect(new ConfigurationService(profile).get().OBSERVABILITY_PROVIDER).toBe(
      "azure_monitor",
    );
    for (const name of [
      "AZURE_MONITOR_CONNECTION_STRING",
      "APPLICATION_INSIGHTS_NO_STATSBEAT",
    ]) {
      expect(
        () => new ConfigurationService({ ...profile, [name]: "" }),
      ).toThrow(name);
    }
  });
  it.each([
    connection.replace("https:", "http:"),
    connection.replace(
      "westus2-0.in.applicationinsights.azure.com",
      "evil.example",
    ),
    connection + ";IngestionEndpoint=https://evil.example",
    connection + ";LiveEndpoint=https://evil.example",
    connection.replace(
      "40000000-0000-4000-8000-000000000004",
      "private-secret",
    ),
    connection + "/path",
    connection + "?token=private",
    connection.replace("https://", "https://user:password@"),
    connection.replace(".com", ".com:443"),
  ])("rejects ambiguous/unapproved connection settings", (value) => {
    expect(
      () =>
        new ConfigurationService({
          ...profile,
          AZURE_MONITOR_CONNECTION_STRING: value,
        }),
    ).toThrow("AZURE_MONITOR_CONNECTION_STRING");
  });
  it("resolves the connection setting through pinned vault references without env fallback", async () => {
    const settings = {
      ...profile,
      AZURE_MONITOR_CONNECTION_STRING: undefined,
      SECRETS_PROVIDER: "azure_key_vault",
      AZURE_KEY_VAULT_URL: "https://synthetic-vault.vault.azure.net",
      AZURE_KEY_VAULT_SECRET_MAP:
        '{"AZURE_MONITOR_CONNECTION_STRING":"synthetic-monitor/0123456789abcdef0123456789abcdef"}',
    };
    const vault = {
      resolve: vi.fn(async () => ({
        AZURE_MONITOR_CONNECTION_STRING: connection,
      })),
    };
    expect(
      (await new RuntimeConfigurationLoader(settings, vault).load())
        .AZURE_MONITOR_CONNECTION_STRING,
    ).toBe(connection);
    const blocked = { resolve: vi.fn() };
    await expect(
      new RuntimeConfigurationLoader(
        { ...settings, AZURE_MONITOR_CONNECTION_STRING: connection },
        blocked,
      ).load(),
    ).rejects.toThrow("environment secret forbidden");
    expect(blocked.resolve).not.toHaveBeenCalled();
  });
  it("keeps console as default and shares one selected factory instance", async () => {
    expect(
      new TelemetryFactory(new ConfigurationService({}).get()).create(),
    ).toBeInstanceOf(ConsoleTelemetry);
    vi.stubEnv("APPLICATION_INSIGHTS_NO_STATSBEAT", "true");
    const factory = new TelemetryFactory(
      new ConfigurationService(profile).get(),
    );
    const telemetry = factory.create();
    expect(factory.create()).toBe(telemetry);
    expect(telemetry).toBeInstanceOf(AzureMonitorTelemetry);
    await (telemetry as AzureMonitorTelemetry).shutdown();
  });
});
it("reuses equivalent process configuration snapshots and rejects live reconfiguration", () => {
  const config = new ConfigurationService({ APP_ENV: "test" }).get();
  expect(loadTelemetry(config)).toBe(
    loadTelemetry(new ConfigurationService({ APP_ENV: "test" }).get()),
  );
  expect(() =>
    loadTelemetry(new ConfigurationService({ APP_ENV: "development" }).get()),
  ).toThrow("restart required");
  expect(() =>
    loadTelemetry(
      new ConfigurationService({
        APP_ENV: "test",
        AZURE_CLIENT_ID: "40000000-0000-4000-8000-000000000004",
      }).get(),
    ),
  ).toThrow("restart required");
});
describe("bounded operational tracing", () => {
  it("exports only known events/values and never inherits request trace context", async () => {
    const exporter = new InMemorySpanExporter();
    const telemetry = new AzureMonitorTelemetry(
      new ConfigurationService(profile).get(),
      { exporter },
    );
    try {
      telemetry.event("database.pool_error", {
        provider: "postgres",
        status: "unavailable",
        email: "private@example.test",
        code: "token-value",
        durationMs: 12,
      });
      telemetry.event("auth.session_cleanup_failed", {
        provider: "private@example.test",
        status: "password",
        operation: "Bearer secret",
        durationMs: Number.POSITIVE_INFINITY,
      });
      telemetry.event("private@example.test", { status: "failed" });
      await telemetry.flush();
      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(2);
      expect(spans[0].attributes).toEqual({
        "nova.provider": "postgres",
        "nova.status": "unavailable",
        "nova.duration_ms": 12,
      });
      expect(spans[1].attributes).toEqual({});
      expect(spans[0].parentSpanContext).toBeUndefined();
      expect(spans[0].resource.attributes["service.name"]).toBe("nova-capital");
      const payload = JSON.stringify(
        spans.map((span) => ({
          name: span.name,
          attributes: span.attributes,
          events: span.events,
          resource: span.resource.attributes,
        })),
      );
      expect(payload).not.toMatch(
        /private@example|token-value|Bearer|password/,
      );
    } finally {
      await telemetry.shutdown();
    }
    telemetry.event("database.pool_error");
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });
  it("exports scheduler provenance in the actual dependency envelope used by log alerts", async () => {
    vi.stubEnv("APPLICATION_INSIGHTS_NO_STATSBEAT", "true");
    const bodies: string[] = [];
    const telemetry = new AzureMonitorTelemetry(
      new ConfigurationService(profile).get(),
      {
        credential: {
          getToken: async () => ({
            token: "synthetic-scheduler-monitor-token",
            expiresOnTimestamp: Date.now() + 3600000,
          }),
        },
        httpClient: {
          sendRequest: async (request: PipelineRequest) => {
            bodies.push(String(request.body));
            return {
              request,
              status: 200,
              headers: createHttpHeaders(),
              bodyAsText: '{"itemsReceived":3,"itemsAccepted":3,"errors":[]}',
            };
          },
        },
      },
    );
    try {
      for (const maintenanceOrigin of ["admin", "scheduler"])
        telemetry.event("maintenance.batch_completed", {
          provider: "postgres",
          status: "ok",
          maintenanceOrigin,
        });
      telemetry.event("maintenance.batch_unconfirmed", {
        provider: "postgres",
        status: "unavailable",
        maintenanceOrigin: "scheduler",
      });
      await telemetry.flush();
      expect(bodies).toHaveLength(1);
      const sent: {
        data: { baseType: string; baseData: unknown };
        tags: Record<string, string>;
      }[] = JSON.parse(bodies[0]);
      // The pinned SDK may prepend its standard MetricData envelope; alerts
      // consume dependency rows only, not SDK metadata.
      expect(
        sent.every((item) =>
          ["MetricData", "RemoteDependencyData"].includes(item.data.baseType),
        ),
      ).toBe(true);
      const envelopes = sent.filter(
        (item) => item.data.baseType === "RemoteDependencyData",
      );
      expect(envelopes).toHaveLength(3);
      expect(bodies[0]).not.toContain("synthetic-scheduler-monitor-token");
      for (const envelope of envelopes) {
        expect(envelope.data.baseType).toBe("RemoteDependencyData");
        expect(envelope.tags["ai.cloud.role"]).toBe("nova-capital");
      }
      expect(
        envelopes.map(
          (envelope: { data: { baseData: unknown } }) => envelope.data.baseData,
        ),
      ).toEqual([
        expect.objectContaining({
          name: "maintenance.batch_completed",
          success: true,
          properties: expect.objectContaining({
            "nova.provider": "postgres",
            "nova.status": "ok",
            "nova.maintenance_origin": "admin",
          }),
        }),
        expect.objectContaining({
          name: "maintenance.batch_completed",
          success: true,
          properties: expect.objectContaining({
            "nova.provider": "postgres",
            "nova.status": "ok",
            "nova.maintenance_origin": "scheduler",
          }),
        }),
        expect.objectContaining({
          name: "maintenance.batch_unconfirmed",
          success: false,
          properties: expect.objectContaining({
            "nova.provider": "postgres",
            "nova.status": "unavailable",
            "nova.maintenance_origin": "scheduler",
          }),
        }),
      ]);
    } finally {
      await telemetry.shutdown();
    }
  });
  it("discards invalid and unrelated maintenance provenance without exporting private values", async () => {
    const exporter = new InMemorySpanExporter();
    const telemetry = new AzureMonitorTelemetry(
      new ConfigurationService(profile).get(),
      { exporter },
    );
    try {
      telemetry.event("database.pool_error", {
        maintenanceOrigin: "scheduler",
      });
      telemetry.event("maintenance.batch_completed", {
        maintenanceOrigin: "private@example.test",
      });
      telemetry.event("maintenance.batch_completed", {
        maintenanceOrigin: "scheduler",
      });
      await telemetry.flush();
      expect(
        exporter.getFinishedSpans().map((span) => span.attributes),
      ).toEqual([{}, {}, { "nova.maintenance_origin": "scheduler" }]);
    } finally {
      await telemetry.shutdown();
    }
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const consoleTelemetry = new ConsoleTelemetry();
      consoleTelemetry.event("maintenance.batch_completed", {
        maintenanceOrigin: "scheduler",
      });
      consoleTelemetry.event("maintenance.batch_completed", {
        maintenanceOrigin: "private@example.test",
      });
      consoleTelemetry.event("database.pool_error", {
        maintenanceOrigin: "scheduler",
      });
      expect(
        log.mock.calls.map(([value]) => JSON.parse(String(value))),
      ).toEqual([
        {
          event: "maintenance.batch_completed",
          maintenanceOrigin: "scheduler",
        },
        { event: "maintenance.batch_completed" },
        { event: "database.pool_error" },
      ]);
    } finally {
      log.mockRestore();
    }
  });
  it.each([200, 307, 401, 403, 500])(
    "bounds and redacts actual Azure SDK export with HTTP %i",
    async (status) => {
      vi.stubEnv("APPLICATION_INSIGHTS_NO_STATSBEAT", "true");
      const requests: {
        url: string;
        body: string;
        timeout: number;
        authorization: string | undefined;
      }[] = [];
      const credential = {
        getToken: vi.fn(async () => ({
          token: "synthetic-monitor-bearer-credential",
          expiresOnTimestamp: Date.now() + 3600000,
        })),
      };
      const sendRequest = vi.fn(async (request: PipelineRequest) => {
        requests.push({
          url: request.url,
          body: String(request.body),
          timeout: request.timeout,
          authorization: request.headers.get("authorization"),
        });
        return {
          request,
          status,
          headers: createHttpHeaders(
            status === 307 ? { location: "https://evil.example/track" } : {},
          ),
          bodyAsText: '{"itemsReceived":1,"itemsAccepted":1,"errors":[]}',
        };
      });
      const telemetry = new AzureMonitorTelemetry(
        new ConfigurationService(profile).get(),
        { httpClient: { sendRequest }, credential },
      );
      try {
        telemetry.event("auth.session_cleanup_failed", {
          provider: "entra",
          status: "unavailable",
          token: "secret-token-not-for-export",
        });
        await telemetry.flush().catch(() => {});
        expect(requests).toHaveLength(1);
        expect(credential.getToken).toHaveBeenCalledTimes(1);
        expect(credential.getToken.mock.calls[0]).toEqual([
          "https://monitor.azure.com//.default",
          { abortSignal: expect.any(AbortSignal) },
        ]);
        expect(requests[0].authorization).toBe(
          "Bearer synthetic-monitor-bearer-credential",
        );
        expect(requests[0].url).toBe(
          "https://westus2-0.in.applicationinsights.azure.com/v2.1/track",
        );
        expect(requests[0].timeout).toBe(3000);
        expect(requests[0].body).toContain("auth.session_cleanup_failed");
        expect(requests[0].body).not.toContain("secret-token-not-for-export");
        expect(requests[0].body).not.toContain(
          "synthetic-monitor-bearer-credential",
        );
      } finally {
        await telemetry.shutdown();
      }
    },
  );
  it.each(["throw", "missing", "expired", "invalid"])(
    "never sends unauthenticated ingestion after %s credentials",
    async (kind) => {
      vi.stubEnv("APPLICATION_INSIGHTS_NO_STATSBEAT", "true");
      const credential = {
        getToken: vi.fn(async () => {
          if (kind === "throw") throw Error("private-credential-error");
          if (kind === "missing") return null;
          return {
            token:
              kind === "invalid"
                ? "private\ninvalid"
                : "synthetic-monitor-bearer-token",
            expiresOnTimestamp:
              kind === "expired" ? Date.now() - 1 : Date.now() + 3600000,
          };
        }),
      };
      const sendRequest = vi.fn();
      const telemetry = new AzureMonitorTelemetry(
        new ConfigurationService(profile).get(),
        { credential, httpClient: { sendRequest } },
      );
      try {
        expect(() =>
          telemetry.event("database.pool_error", {
            provider: "postgres",
            status: "unavailable",
          }),
        ).not.toThrow();
        await telemetry.flush().catch(() => {});
        expect(credential.getToken).toHaveBeenCalledTimes(1);
        expect(sendRequest).not.toHaveBeenCalled();
      } finally {
        await telemetry.shutdown();
      }
    },
  );
  it("rejects Azure CLI ingestion in a hosted environment before SDK operations", () => {
    expect(
      () =>
        new ConfigurationService({
          ...profile,
          APP_ENV: "staging",
          AZURE_CREDENTIAL_MODE: "azure_cli",
        }),
    ).toThrow("AZURE_CREDENTIAL_MODE");
    const config = new ConfigurationService({
      ...profile,
      AZURE_CREDENTIAL_MODE: "azure_cli",
    }).get();
    const sendRequest = vi.fn(),
      credential = { getToken: vi.fn() };
    expect(
      () =>
        new AzureMonitorTelemetry(
          { ...config, APP_ENV: "production" },
          { credential, httpClient: { sendRequest } },
        ),
    ).toThrow("AZURE_CREDENTIAL_MODE");
    expect(credential.getToken).not.toHaveBeenCalled();
    expect(sendRequest).not.toHaveBeenCalled();
  });
  it("flushes queued operational spans once during concurrent shutdown", async () => {
    vi.stubEnv("APPLICATION_INSIGHTS_NO_STATSBEAT", "true");
    const sendRequest = vi.fn(async (request: PipelineRequest) => ({
      request,
      status: 200,
      headers: createHttpHeaders(),
      bodyAsText: '{"itemsReceived":1,"itemsAccepted":1,"errors":[]}',
    }));
    const credential = {
      getToken: vi.fn(async () => ({
        token: "synthetic-shutdown-bearer-token",
        expiresOnTimestamp: Date.now() + 3600000,
      })),
    };
    const telemetry = new AzureMonitorTelemetry(
      new ConfigurationService(profile).get(),
      { httpClient: { sendRequest }, credential },
    );
    telemetry.event("application.request_failed", {
      provider: "application",
      status: "failed",
    });
    const first = telemetry.shutdown();
    expect(telemetry.shutdown()).toBe(first);
    await first;
    expect(sendRequest).toHaveBeenCalledOnce();
    const body = String(sendRequest.mock.calls[0][0].body);
    expect(body).toContain("application.request_failed");
    expect(body).not.toContain("synthetic-shutdown-bearer-token");
    telemetry.event("application.request_failed");
    expect(sendRequest).toHaveBeenCalledOnce();
  });
  it("caps queued spans during bursts and flushes before shutdown", async () => {
    const exporter = new InMemorySpanExporter();
    const telemetry = new AzureMonitorTelemetry(
      new ConfigurationService(profile).get(),
      { exporter },
    );
    try {
      for (let index = 0; index < 400; index++)
        telemetry.event("application.request_failed", { status: "failed" });
      await telemetry.flush();
      expect(exporter.getFinishedSpans().length).toBeGreaterThan(0);
      expect(exporter.getFinishedSpans().length).toBeLessThanOrEqual(288);
    } finally {
      await telemetry.shutdown();
    }
  });
  it("rejects SDK construction without the process-level statsbeat switch", () => {
    vi.stubEnv("APPLICATION_INSIGHTS_NO_STATSBEAT", "");
    expect(
      () => new AzureMonitorTelemetry(new ConfigurationService(profile).get()),
    ).toThrow("APPLICATION_INSIGHTS_NO_STATSBEAT");
  });
});
