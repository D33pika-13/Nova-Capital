import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ config: vi.fn() }));
vi.mock("@/server/config", () => ({ loadConfig: state.config }));
import { GET } from "../src/app/api/health/route";
afterEach(() => vi.clearAllMocks());

it("lets a configured liveness probe pass without claiming verified dependencies", async () => {
  state.config.mockResolvedValue({ SERVICES_ENABLED: true });
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.text();
  expect(body).toContain('"mode":"configured"');
  expect(JSON.parse(body)).toEqual({
    status: "ok",
    mode: "configured",
    dependenciesVerified: false,
  });
});

it("does not let a public-shell 200 satisfy the configured probe", async () => {
  state.config.mockResolvedValue({ SERVICES_ENABLED: false });
  const response = await GET();
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(body).not.toContain('"mode":"configured"');
  expect(JSON.parse(body).mode).toBe("public-shell");
});

it("fails a configuration error without revealing provider or secret details", async () => {
  state.config.mockRejectedValue(Error("synthetic-private-vault-secret"));
  const response = await GET();
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ status: "unavailable" });
});
