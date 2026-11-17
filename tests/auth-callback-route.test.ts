import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("@/server/composition", () => ({
  createServices: async () => ({ authCallback: mocks }),
}));
vi.mock("@/server/config", () => ({
  loadConfig: async () => ({ APP_URL: "https://app.example.test" }),
}));
import { GET } from "@/app/auth/callback/route";

describe("auth callback HTTP response", () => {
  beforeEach(() => {
    mocks.complete.mockReset();
  });
  it("redirects to the configured app without leaking credentials through response or referrers", async () => {
    mocks.complete.mockResolvedValue({ redirect: "/password" });
    const result = await GET(
      new Request(
        "https://untrusted.example.test/auth/callback?token_hash=synthetic-private-token&type=invite",
      ),
    );
    expect(result.status).toBe(303);
    expect(result.headers.get("location")).toBe(
      "https://app.example.test/password",
    );
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await result.text()).not.toContain("synthetic-private-token");
  });
  it("returns the same safe error redirect for provider or shared-limit failures", async () => {
    mocks.complete.mockRejectedValue(
      new Error("synthetic-private-provider-payload"),
    );
    const result = await GET(
      new Request("https://app.example.test/auth/callback?code=synthetic-code"),
    );
    expect(result.status).toBe(303);
    expect(result.headers.get("location")).toBe(
      "https://app.example.test/login?error=link",
    );
    expect(result.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await result.text()).not.toContain(
      "synthetic-private-provider-payload",
    );
  });
});
