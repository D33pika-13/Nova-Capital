import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  event: vi.fn(),
  install: vi.fn(),
  config: vi.fn(async () => ({ synthetic: true })),
  load: vi.fn(),
}));
vi.mock("@/server/config", () => ({ loadConfig: state.config }));
vi.mock("@/server/telemetry-factory", () => ({ loadTelemetry: state.load }));
vi.mock("@/server/server-shutdown", () => ({
  installServerShutdown: state.install,
}));
import { onRequestError, register } from "../instrumentation";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("initializes selected telemetry during Node startup", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  state.load.mockReturnValue({ event: state.event });
  await register();
  expect(state.load).toHaveBeenCalledWith({ synthetic: true });
  expect(state.install).toHaveBeenCalledOnce();
});
it("records only a fixed operational failure without examining request/error data", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  state.load.mockReturnValue({ event: state.event });
  await onRequestError(
    new Error("private-token"),
    {
      path: "/private?email=private@example.test",
      method: "POST",
      headers: { authorization: "Bearer private-token" },
    },
    {
      routerKind: "App Router",
      routePath: "/private",
      routeType: "route",
      revalidateReason: undefined,
      renderSource: "react-server-components",
    },
  );
  expect(state.event).toHaveBeenCalledExactlyOnceWith(
    "application.request_failed",
    { provider: "application", status: "failed" },
  );
  state.event.mockImplementationOnce(() => {
    throw Error("private-provider-message");
  });
  await expect(
    onRequestError(
      new Error("private-token"),
      { path: "/private", method: "POST", headers: {} },
      {
        routerKind: "App Router",
        routePath: "/private",
        routeType: "route",
        revalidateReason: undefined,
      },
    ),
  ).resolves.toBeUndefined();
});
it("does not initialize Node exporters in another runtime", async () => {
  vi.stubEnv("NEXT_RUNTIME", "edge");
  await register();
  expect(state.load).not.toHaveBeenCalled();
});
