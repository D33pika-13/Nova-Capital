import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/lib/site-config", () => ({
  siteConfig: {
    name: "SYNTHETIC Example Firm",
    socialLinks: [
      { label: "Company profile", href: "https://social.example.test/firm" },
    ],
    legalLinks: [],
    contactEmail: "",
    phone: "",
    address: "",
  },
}));
vi.mock("@/server/config", () => ({
  loadConfig: async () => ({ SERVICES_ENABLED: false }),
}));
import ContentPage from "@/app/[slug]/page";
import ContactPage from "@/app/contact/page";
import Loading from "@/app/loading";
import { SiteFooter } from "@/components/site-footer";
import { SocialLinks } from "@/components/social-links";
it("renders configured public profiles with safe destinations and explicit new-tab labels", () => {
  const html = renderToStaticMarkup(<SiteFooter />);
  expect(html).toContain("SYNTHETIC Example Firm");
  expect(html).toContain('aria-label="Social profiles"');
  expect(html).toContain('href="https://social.example.test/firm"');
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).toContain("opens in a new tab");
});
it("does not invent social links when no profiles are configured", () => {
  expect(renderToStaticMarkup(<SocialLinks links={[]} />)).toBe("");
});
it.each([
  "javascript:alert(1)",
  "http://social.example.test",
  "/relative",
  "https://user:synthetic-private-password@social.example.test",
  "invalid",
])(
  "rejects unsafe public profile destination %s without exposing its value",
  (href) => {
    expect(() =>
      renderToStaticMarkup(
        <SocialLinks links={[{ label: "Profile", href }]} />,
      ),
    ).toThrow("Invalid public social link configuration.");
  },
);
it("uses configured branding in About, Contact and loading content", async () => {
  const views = [
    renderToStaticMarkup(
      await ContentPage({ params: Promise.resolve({ slug: "about" }) }),
    ),
    renderToStaticMarkup(await ContactPage()),
    renderToStaticMarkup(<Loading />),
  ];
  for (const html of views) {
    expect(html).toContain("SYNTHETIC Example Firm");
    expect(html).not.toContain("NOVA CAPITAL");
  }
});
