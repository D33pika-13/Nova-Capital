import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppError } from "@/server/errors";
const state = vi.hoisted(() => ({
  status: vi.fn(),
  page: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/server/composition", () => ({ createServices: state.create }));
vi.mock("@/server/page-auth", () => ({ requirePageUser: state.page }));
import { GET } from "@/app/api/admin/maintenance/route";
import OperationsPage from "@/app/admin/operations/page";
beforeEach(() => {
  vi.clearAllMocks();
  state.status.mockResolvedValue({
    state: "never",
    observedAt: "2026-11-11T12:00:00Z",
    lastScheduledSuccessAt: null,
    lastScheduledOutcome: null,
    lastAdminFinishedAt: null,
    staleAfterSeconds: 900,
  });
  state.create.mockResolvedValue({ maintenance: { status: state.status } });
  state.page.mockResolvedValue({
    services: { maintenance: { status: state.status } },
  });
});
it("returns only service-produced evidence with private cache headers", async () => {
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({
    state: "never",
    lastScheduledSuccessAt: null,
  });
  expect(state.status).toHaveBeenCalledOnce();
});
it("preserves MFA/access denial and hides provider/database errors", async () => {
  state.status.mockRejectedValueOnce(
    new AppError("MFA_REQUIRED", "MFA required.", 403),
  );
  expect((await GET()).status).toBe(403);
  state.status.mockRejectedValueOnce(Error("private-database-password"));
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private-database-password");
});
it("shows honest missing evidence on the MFA-protected operations page", async () => {
  const html = renderToStaticMarkup(await OperationsPage());
  expect(state.page).toHaveBeenCalledExactlyOnceWith(true);
  expect(html).toContain("No scheduled batch recorded");
  expect(html).toContain("Manual batches do not establish scheduler freshness");
  expect(html).not.toContain("private-database-password");
});
it.each(["current", "failed", "stale", "backlog"])(
  "renders the %s status without inferring hosted execution",
  async (value) => {
    state.status.mockResolvedValueOnce({
      state: value,
      observedAt: "2026-11-11T12:00:00Z",
      lastScheduledSuccessAt: "2026-11-11T11:59:00Z",
      lastScheduledOutcome: value === "failed" ? "failed" : "completed",
      lastAdminFinishedAt: null,
      staleAfterSeconds: 900,
    });
    const html = renderToStaticMarkup(await OperationsPage());
    expect(html).toContain("It does not confirm hosted");
    expect(html).toContain("900");
  },
);
