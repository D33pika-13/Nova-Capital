import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const state = vi.hoisted(() => ({
  config: vi.fn(),
  services: vi.fn(),
  current: vi.fn(),
  manage: vi.fn(),
}));
vi.mock("@/server/config", () => ({ loadConfig: state.config }));
vi.mock("@/server/composition", () => ({ createServices: state.services }));
import { PublicOffers } from "@/components/public-offers";
afterEach(() => vi.resetAllMocks());
const offer = (id: string) => ({
  id,
  title: `Published ${id}`,
  category: "travel",
  description: "Recorded public description",
  eligibility: "Eligible members only",
  terms: "Recorded full terms",
  startsAt: "2026-01-01T00:00:00.000Z",
  endsAt: "2026-12-01T00:00:00.000Z",
  status: "published",
  version: 1,
});
it("renders an honest shell empty state without constructing configured services", async () => {
  state.config.mockResolvedValue({ SERVICES_ENABLED: false });
  expect(renderToStaticMarkup(await PublicOffers({ preview: true }))).toContain(
    "No current offers are published",
  );
  expect(state.services).not.toHaveBeenCalled();
});
it("shows unavailable rather than claiming no offers when the dependency fails", async () => {
  state.config.mockResolvedValue({ SERVICES_ENABLED: true });
  state.services.mockRejectedValue(Error("private-database-error"));
  const html = renderToStaticMarkup(await PublicOffers());
  expect(html).toContain('role="status"');
  expect(html).toContain("temporarily unavailable");
  expect(html).not.toMatch(/No current offers|private-database-error/);
});
it("uses only the anonymous current-offer service and limits homepage previews with explicit terms navigation", async () => {
  state.config.mockResolvedValue({ SERVICES_ENABLED: true });
  state.services.mockResolvedValue({
    offers: { current: state.current, manage: state.manage },
  });
  state.current.mockResolvedValue(["one", "two", "three", "four"].map(offer));
  const html = renderToStaticMarkup(await PublicOffers({ preview: true }));
  expect(state.current).toHaveBeenCalledExactlyOnceWith();
  expect(state.manage).not.toHaveBeenCalled();
  expect(html.match(/<article/g)).toHaveLength(3);
  expect(html).not.toContain("Published four");
  expect(html.match(/View full eligibility and terms/g)).toHaveLength(3);
  expect(html).toContain('href="/benefits"');
  expect(html.toLowerCase()).toContain('datetime="2026-12-01t00:00:00.000z"');
  expect(html).toContain("end excluded");
});
it("retains full eligibility, terms and escaped content on the complete benefits view", async () => {
  state.config.mockResolvedValue({ SERVICES_ENABLED: true });
  state.services.mockResolvedValue({ offers: { current: state.current } });
  state.current.mockResolvedValue([
    { ...offer("one"), title: "<script>synthetic</script>" },
  ]);
  const html = renderToStaticMarkup(await PublicOffers());
  expect(html).toContain("Eligible members only");
  expect(html).toContain("Recorded full terms");
  expect(html).toContain("&lt;script&gt;synthetic&lt;/script&gt;");
  expect(html).not.toContain("<script>");
});
