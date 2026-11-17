import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  telemetry: vi.fn(async () => {}),
  config: vi.fn(),
}));
vi.mock("@/server/telemetry-factory", () => ({
  shutdownTelemetry: state.telemetry,
  loadTelemetry: vi.fn(),
}));
vi.mock("@/server/config", () => ({ loadConfig: state.config }));
import { installServerShutdown } from "@/server/server-shutdown";
import { createServices } from "@/server/composition";
it("registers once, closes current process resources and blocks new dependency composition", async () => {
  const globals = globalThis as typeof globalThis & {
    novaPool?: { end: () => Promise<void> };
    novaShutdownStarted?: boolean;
  };
  const pool = { end: vi.fn(async () => {}) };
  globals.novaPool = pool;
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    installServerShutdown();
    const key = Symbol.for("nova.server.shutdown");
    const hook = Reflect.get(globalThis, key) as () => Promise<void>;
    installServerShutdown();
    expect(Reflect.get(globalThis, key)).toBe(hook);
    const first = hook();
    expect(hook()).toBe(first);
    await first;
    expect(pool.end).toHaveBeenCalledOnce();
    expect(state.telemetry).toHaveBeenCalledOnce();
    expect(globals.novaShutdownStarted).toBe(true);
    await expect(createServices()).rejects.toMatchObject({
      code: "SERVICES_DRAINING",
      status: 503,
    });
    expect(state.config).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledExactlyOnceWith(
      '{"event":"application.shutdown","database":"closed","telemetry":"closed"}',
    );
  } finally {
    delete globals.novaPool;
    delete globals.novaShutdownStarted;
    log.mockRestore();
  }
});
