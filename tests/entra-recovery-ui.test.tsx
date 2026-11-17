import { renderToStaticMarkup } from "react-dom/server";
import { it, expect } from "vitest";
import { EntraRecoveryForm } from "@/components/entra-recovery-form";
it("uses a same-origin POST to delegated recovery and explains verification/session effects without collecting credentials", () => {
  const html = renderToStaticMarkup(<EntraRecoveryForm />);
  expect(html).toContain('action="/auth/entra/recover"');
  expect(html).toContain('method="post"');
  expect(html).toContain("Forgot password?");
  expect(html).toContain("previous sessions");
  expect(html).toContain("authenticator verification");
  expect(html).not.toContain("<input");
  expect(html).not.toContain("password changed");
  expect(html).not.toContain("<img");
});
