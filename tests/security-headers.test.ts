import { it, expect } from "vitest";
import { contentSecurityPolicy } from "@/server/security-headers";
it("uses nonce-based scripts without unsafe execution in production", () => {
  const csp = contentSecurityPolicy("random-request-nonce", false);
  expect(csp).toContain("'nonce-random-request-nonce'");
  const scripts = csp.split(";").find((s) => s.includes("script-src"));
  expect(scripts).not.toContain("unsafe-inline");
  expect(scripts).not.toContain("unsafe-eval");
  expect(csp).toContain("frame-ancestors 'none'");
});
it("permits framework debugging only in development", () => {
  expect(contentSecurityPolicy("nonce", true)).toContain("'unsafe-eval'");
  expect(contentSecurityPolicy("nonce", false)).not.toContain(" ws:");
});
