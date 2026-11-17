import { renderToStaticMarkup } from "react-dom/server";
import { it, expect, vi } from "vitest";
import { SupportWidget } from "@/components/support-widget";
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
it("renders an accessible closed support launcher without personal history or credentials", () => {
  const html = renderToStaticMarkup(
    <SupportWidget companyName="SYNTHETIC COMPANY" />,
  );
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('aria-controls="support-panel"');
  expect(html).toContain("Maya</button>");
  expect(html).not.toContain('role="dialog"');
  expect(html).not.toContain("OPENAI_API_KEY");
});
