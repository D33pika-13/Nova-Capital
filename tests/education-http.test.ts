import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/server/config", () => ({
  loadConfig: async () => ({ APP_URL: "https://app.example.test" }),
}));
vi.mock("@/server/composition", () => ({ createServices: mocks.create }));
import { POST } from "@/app/api/education/requests/route";
import { GET } from "@/app/api/admin/education/route";
import { AppError } from "@/server/errors";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({
    config: { CONTACT_CLIENT_IP_HEADER: "x-real-ip" },
    education: { submit: mocks.submit, list: mocks.list },
  });
  mocks.submit.mockResolvedValue({
    status: "received",
    reference: "synthetic",
  });
});
const request = (
  origin = "https://app.example.test",
  body = "{}",
  ip = "203.0.113.2",
) =>
  new Request("https://app.example.test/api/education/requests", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "X-Real-IP": ip,
    },
    body,
  });
it("rejects foreign origins before any submission", async () => {
  expect((await POST(request("https://evil.test"))).status).toBe(403);
  expect(mocks.submit).not.toHaveBeenCalled();
});
it("passes only the bounded body and verified ingress to the injected service with no shared cache", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(mocks.submit).toHaveBeenCalledWith({}, "203.0.113.2");
});
it("rejects invalid ingress and oversized JSON without writes", async () => {
  expect((await POST(request(undefined, undefined, "untrusted"))).status).toBe(
    503,
  );
  expect(
    (
      await POST(
        request(undefined, JSON.stringify({ message: "x".repeat(19000) })),
      )
    ).status,
  ).toBe(413);
  expect(mocks.submit).not.toHaveBeenCalled();
});
it("redacts a persistence failure and never claims receipt", async () => {
  mocks.submit.mockRejectedValue(new Error("private db detail"));
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private db detail");
});
it("preserves admin authorization failures and non-cacheable filtered listing", async () => {
  mocks.list.mockRejectedValueOnce(
    new AppError("MFA_REQUIRED", "MFA required", 403),
  );
  expect(
    (await GET(new Request("https://app.example.test/api/admin/education")))
      .status,
  ).toBe(403);
  mocks.list.mockResolvedValue([]);
  const response = await GET(
    new Request(
      "https://app.example.test/api/admin/education?service=mentorship&offset=50",
    ),
  );
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(mocks.list).toHaveBeenLastCalledWith({
    service: "mentorship",
    offset: "50",
  });
});
