import { describe, it, expect, vi } from "vitest";
import { AuthService } from "@/server/modules/identity/auth-service";
import { AuthorizationService } from "@/server/modules/identity/authorization-service";
import { MfaService } from "@/server/modules/identity/mfa-service";
import type {
  IdentityProvider,
  Profile,
  RateLimiter,
} from "@/server/contracts";
const profile: Profile = {
  id: "a",
  externalSubject: "auth-a",
  role: "client",
  status: "active",
  clientId: "INV-1001",
  displayName: "DEMO A",
};
function setup(p: Profile | null = profile, allowed = true) {
  const identity: IdentityProvider = {
    verify: vi.fn(async () => ({
      subject: "auth-a",
      provider: "supabase",
      assurance: "aal1" as const,
    })),
    signIn: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    setPassword: vi.fn(async () => {}),
    requestReset: vi.fn(async () => {}),
  };
  const auth = new AuthorizationService(identity, {
    findByIdentity: async () => p,
  });
  const limits: RateLimiter = { consume: vi.fn(async () => allowed) };
  return {
    identity,
    auth,
    limits,
    service: new AuthService(identity, auth, limits),
  };
}
describe("authentication application service", () => {
  it("rejects caller-supplied roles/client identities", async () => {
    const s = setup();
    await expect(
      s.service.login({
        email: "a@example.test",
        password: "password",
        role: "admin",
        clientId: "b",
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(s.identity.signIn).not.toHaveBeenCalled();
  });
  it("blocks sign-in when shared limits deny access", async () => {
    const s = setup(profile, false);
    await expect(
      s.service.login({ email: "a@example.test", password: "password" }),
    ).rejects.toMatchObject({ status: 429 });
    expect(s.identity.signIn).not.toHaveBeenCalled();
  });
  it("routes clients to their portal", async () => {
    const s = setup();
    expect(
      await s.service.login({ email: "A@example.test", password: "password" }),
    ).toEqual({ redirect: "/portal" });
    expect(s.identity.signIn).toHaveBeenCalledWith(
      "a@example.test",
      "password",
    );
  });
  it("routes admins to MFA before admin access", async () => {
    const s = setup({ ...profile, role: "admin" });
    expect(
      await s.service.login({ email: "a@example.test", password: "password" }),
    ).toEqual({ redirect: "/mfa" });
  });
  it("clears the new session when application access is denied", async () => {
    const s = setup(null);
    await expect(
      s.service.login({ email: "a@example.test", password: "password" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(s.identity.signOut).toHaveBeenCalled();
  });
  it("does not disclose whether a reset email belongs to an account", async () => {
    const s = setup();
    expect(await s.service.reset({ email: "a@example.test" })).toEqual({
      message:
        "If the address is eligible, a password reset link will be sent.",
    });
  });
});
describe("MFA application boundary", () => {
  it("lets clients enroll their own account factor", async () => {
    const s = setup();
    const provider = {
      prepare: vi.fn(async () => ({ factorId: "own-factor", enrolled: false })),
      verify: vi.fn(),
    };
    expect(
      await new MfaService(s.auth, provider, s.limits).execute({
        action: "setup",
      }),
    ).toEqual({ factorId: "own-factor", enrolled: false });
    expect(provider.prepare).toHaveBeenCalledOnce();
  });
  it("validates codes before contacting the provider", async () => {
    const s = setup({ ...profile, role: "admin" });
    const provider = { prepare: vi.fn(), verify: vi.fn() };
    await expect(
      new MfaService(s.auth, provider, s.limits).execute({
        action: "verify",
        factorId: "forged",
        code: "123",
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(provider.verify).not.toHaveBeenCalled();
  });
});
