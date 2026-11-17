import { expect, it, vi } from "vitest";
import { ConsoleTelemetry } from "@/server/telemetry";
it("drops sensitive/unrecognized log fields", () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  new ConsoleTelemetry().event("auth.login", {
    status: "failed",
    password: "secret",
    token: "jwt",
    email: "private@example.test",
  });
  expect(log).toHaveBeenCalledWith('{"event":"auth.login","status":"failed"}');
  log.mockRestore();
});
