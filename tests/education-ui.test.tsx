import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import EducationPage from "@/app/education/page";
import { EducationForm } from "@/components/education-form";
import { PortfolioChart } from "@/components/portfolio-chart";
it("links separate service cards to correctly preselected, public request forms", () => {
  const page = renderToStaticMarkup(<EducationPage />);
  expect(page).toContain("/education/request?service=webinars");
  expect(page).toContain("/education/request?service=mentorship");
  for (const service of ["webinars", "mentorship"]) {
    const html = renderToStaticMarkup(
      <EducationForm service={service} enabled />,
    );
    expect(html).toContain(`value="${service}" selected=""`);
    for (const name of [
      "name",
      "email",
      "phone",
      "service",
      "message",
      "consent",
    ])
      expect(html).toContain(`name="${name}"`);
    expect(html).toContain('type="tel"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('name="clientId"');
  }
  expect(
    renderToStaticMarkup(<EducationForm service="" enabled={false} />),
  ).toContain('<fieldset disabled=""');
});
it("offers USD/EUR/GBP without fabricating points for an empty portfolio", () => {
  const html = renderToStaticMarkup(<PortfolioChart snapshots={[]} />);
  for (const c of ["USD", "EUR", "GBP"])
    expect(html).toContain(`>${c}</option>`);
  expect(html).toContain("No USD snapshots recorded");
  expect(html).not.toContain("recharts-surface");
});
