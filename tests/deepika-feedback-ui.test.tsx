import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WithdrawalList } from "@/components/withdrawals";
import { WithdrawalForm } from "@/components/withdrawal-form";
import { AuthForm } from "@/components/auth-form";
import { supportedCurrencies } from "@/lib/portfolio-inputs";
import { formatMoney } from "@/lib/format";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}));
it("shows withdrawal amounts and UTC dates without client write controls", () => {
  const html = renderToStaticMarkup(
    <WithdrawalList
      records={[
        {
          id: "w",
          clientId: "a",
          currency: "USD",
          amount: "1234567.8901",
          withdrawnAt: "2026-01-10T12:00:00Z",
          reference: "<script>synthetic</script>",
          createdAt: "2026-01-10T12:00:00Z",
          correctionOf: null,
          correctionReason: null,
          superseded: false,
        },
      ]}
    />,
  );
  expect(html).toContain("USD 1,234,567.8901");
  expect(html).toContain("10 Jan 2026");
  expect(html).toContain("UTC");
  expect(html).toContain("&lt;script&gt;synthetic&lt;/script&gt;");
  expect(html).not.toContain("<form");
  expect(renderToStaticMarkup(<WithdrawalList records={[]} />)).toContain(
    "No withdrawals recorded",
  );
});
it("provides withdrawal fields and international currencies, preserving large exact values", () => {
  const html = renderToStaticMarkup(<WithdrawalForm clientId="a" />);
  for (const currency of supportedCurrencies)
    expect(html).toContain(`value="${currency}"`);
  expect(html).toContain("Withdrawal date/time (UTC)");
  expect(html).toContain('step="0.001"');
  expect(html).toContain("Withdrawal reference");
  expect(formatMoney("9999999999999999.9999", "EUR")).toBe(
    "EUR 9,999,999,999,999,999.9999",
  );
});
it("exposes a new-password field without email or caller-selected identity", () => {
  const html = renderToStaticMarkup(<AuthForm mode="change-password" />);
  expect(html).toContain('autoComplete="new-password"');
  expect(html).not.toContain('type="email"');
  expect(html).not.toContain('name="clientId"');
});
