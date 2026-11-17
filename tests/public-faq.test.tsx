import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import FaqPage from "@/app/faq/page";
import { FaqList } from "@/components/faq-list";
import { faqs, siteConfig } from "@/lib/site-config";
it("makes Home and the dedicated FAQ reachable through the shared navigation", () => {
  expect(siteConfig.navigation).toContainEqual({ label: "Home", href: "/" });
  expect(siteConfig.navigation).toContainEqual({ label: "FAQ", href: "/faq" });
});
it("uses the same FAQ answers and native keyboard disclosures on both public views", () => {
  const page = renderToStaticMarkup(<FaqPage />),
    list = renderToStaticMarkup(<FaqList />);
  expect(page).toContain(list);
  expect(page.match(/<details/g)).toHaveLength(faqs.length);
  expect(page.match(/<summary/g)).toHaveLength(faqs.length);
  expect(page).toContain("does not collect or custody");
  expect(page).not.toContain("How is portfolio information updated?");
  expect(page).not.toContain("Are returns guaranteed?");
  expect(page).toContain('href="/contact"');
  expect(page).toContain("Do not share passwords or broker credentials");
});
