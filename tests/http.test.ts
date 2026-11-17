import { describe, it, expect } from "vitest";
import { readJsonBody, assertSameOrigin, errorResponse } from "@/server/http";
describe("HTTP boundaries", () => {
  it("rejects cross-origin mutations", async () => {
    await expect(
      assertSameOrigin(
        new Request("http://127.0.0.1:3000/api/auth/login", {
          method: "POST",
          headers: { origin: "https://attacker.test" },
        }),
      ),
    ).rejects.toThrow(/origin/);
  });
  it("rejects absent mutation origins", async () => {
    await expect(
      assertSameOrigin(
        new Request("http://127.0.0.1:3000/api/auth/login", { method: "POST" }),
      ),
    ).rejects.toThrow(/origin/);
  });
  it("accepts configured same-origin mutations", async () => {
    await expect(
      assertSameOrigin(
        new Request("http://127.0.0.1:3000/api/auth/login", {
          method: "POST",
          headers: { origin: "http://127.0.0.1:3000" },
        }),
      ),
    ).resolves.toBeUndefined();
  });
  it("bounds body bytes even without content-length", async () => {
    await expect(
      readJsonBody(
        new Request("http://localhost/", {
          method: "POST",
          body: JSON.stringify({ text: "a".repeat(100) }),
        }),
        20,
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
  it("rejects malformed JSON safely", async () => {
    await expect(
      readJsonBody(
        new Request("http://localhost/", { method: "POST", body: "not json" }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("does not expose provider errors", async () => {
    const response = errorResponse(new Error("private connection credentials"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private");
  });
});
