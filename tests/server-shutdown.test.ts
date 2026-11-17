import { afterEach, expect, it, vi } from "vitest";
import { ServerShutdownCoordinator } from "@/server/server-shutdown";
afterEach(() => vi.useRealTimers());
it("closes the pool before telemetry and shares one lifecycle promise", async () => {
  const order: string[] = [];
  const database = vi.fn(async () => {
    order.push("database");
  });
  const telemetry = vi.fn(async () => {
    order.push("telemetry");
  });
  const coordinator = new ServerShutdownCoordinator(database, telemetry);
  const first = coordinator.shutdown();
  expect(coordinator.shutdown()).toBe(first);
  const result = await first;
  expect(order).toEqual(["database", "telemetry"]);
  expect(result).toEqual({ database: "closed", telemetry: "closed" });
  expect(Object.isFrozen(result)).toBe(true);
  expect(database).toHaveBeenCalledOnce();
  expect(telemetry).toHaveBeenCalledOnce();
});
it("waits for database completion before stopping event recording", async () => {
  let finish: () => void = () => {};
  const telemetry = vi.fn(async () => {});
  const coordinator = new ServerShutdownCoordinator(
    async () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    telemetry,
  );
  const pending = coordinator.shutdown();
  await Promise.resolve();
  expect(telemetry).not.toHaveBeenCalled();
  finish();
  await pending;
  expect(telemetry).toHaveBeenCalledOnce();
});
it("contains a failed pool close and still drains telemetry without exposing the error", async () => {
  const telemetry = vi.fn(async () => {});
  const result = await new ServerShutdownCoordinator(async () => {
    throw Error("private-database-password");
  }, telemetry).shutdown();
  expect(result).toEqual({ database: "unavailable", telemetry: "closed" });
  expect(JSON.stringify(result)).not.toContain("private-database-password");
});
it("bounds both hung dependencies and ignores late completion", async () => {
  vi.useFakeTimers();
  let finish: () => void = () => {};
  const coordinator = new ServerShutdownCoordinator(
    async () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    async () => new Promise<void>(() => {}),
    20,
    30,
  );
  const pending = coordinator.shutdown();
  await vi.advanceTimersByTimeAsync(51);
  expect(await pending).toEqual({
    database: "unavailable",
    telemetry: "unavailable",
  });
  finish();
  await Promise.resolve();
  expect(vi.getTimerCount()).toBe(0);
  expect(coordinator.shutdown()).toBe(pending);
});
it.each([0, -1, 5001, Number.NaN, 1.5])(
  "rejects invalid shutdown bounds %s",
  (timeout) => {
    expect(
      () =>
        new ServerShutdownCoordinator(
          async () => {},
          async () => {},
          timeout,
          1,
        ),
    ).toThrow("SERVER_SHUTDOWN_TIMEOUT");
  },
);
it("rejects a combined cleanup budget beyond the outer hook margin", () => {
  expect(
    () =>
      new ServerShutdownCoordinator(
        async () => {},
        async () => {},
        5000,
        5000,
      ),
  ).toThrow("SERVER_SHUTDOWN_TIMEOUT");
});
it("keeps telemetry failures private", async () => {
  expect(
    await new ServerShutdownCoordinator(
      async () => {},
      async () => {
        throw Error("private-ingestion-token");
      },
    ).shutdown(),
  ).toEqual({ database: "closed", telemetry: "unavailable" });
});
