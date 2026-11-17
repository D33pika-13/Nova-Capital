import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import {
  RecoveryCodeConfirmation,
  EntraMfaManagementForm,
} from "@/components/entra-mfa-form";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
it("requires acknowledgement before leaving the one-time recovery-code screen", () => {
  const codes = ["0000-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-0000"];
  const html = renderToStaticMarkup(
    <RecoveryCodeConfirmation
      codes={codes}
      saved={false}
      onSaved={vi.fn()}
      onContinue={vi.fn()}
    />,
  );
  expect(html).toContain(codes[0]);
  expect(html).toContain('type="checkbox"');
  expect(html).toContain('disabled=""');
  expect(html).toContain("shown once");
  expect(html).toContain("secure password manager");
  expect(html).not.toContain("<a ");
  expect(html).not.toContain("<img");
  const confirmed = renderToStaticMarkup(
    <RecoveryCodeConfirmation
      codes={codes}
      saved={true}
      onSaved={vi.fn()}
      onContinue={vi.fn()}
    />,
  );
  expect(confirmed).toContain('checked=""');
  expect(confirmed).not.toContain('disabled=""');
});

it("shows lifecycle consequences, recent-sign-in guidance and requires removal confirmation", () => {
  const remove = renderToStaticMarkup(
    <EntraMfaManagementForm action="remove" />,
  );
  expect(remove).toContain("last ten minutes");
  expect(remove).toContain("next sign-in requires authenticator setup again");
  expect(remove).toContain('type="checkbox"');
  expect(remove).toContain('disabled=""');
  expect(remove.toLowerCase()).toContain('autocomplete="one-time-code"');
  const regenerate = renderToStaticMarkup(
    <EntraMfaManagementForm action="regenerate" />,
  );
  expect(regenerate).toContain("invalidates all previous recovery codes");
  expect(regenerate).toContain("Recovery code");
  expect(regenerate).not.toContain('disabled=""');
  expect(regenerate).not.toContain("<a ");
  expect(regenerate).not.toContain("<img");
});
