import { expect, it, vi } from "vitest";
import { AuthorizationService } from "@/server/modules/identity/authorization-service";
import { AuthService } from "@/server/modules/identity/auth-service";
import { MfaService } from "@/server/modules/identity/mfa-service";
import type {
  IdentityProvider,
  VerifiedIdentity,
  Profile,
} from "@/server/contracts";
function setup() {
  let claims: VerifiedIdentity | null = {
    subject: "client-a",
    provider: "supabase",
    assurance: "aal1",
    mfaEnrolled: true,
  };
  let profile: Profile = {
    id: "a",
    role: "client",
    status: "active",
    externalSubject: "client-a",
    clientId: "INV-1001",
    displayName: "Synthetic",
  };
  const identity: IdentityProvider = {
    verify: vi.fn(async () => claims),
    signIn: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    setPassword: vi.fn(async () => {}),
    requestReset: vi.fn(async () => {}),
  };
  const auth = new AuthorizationService(identity, {
    findByIdentity: async () => profile,
  });
  const limits = { consume: vi.fn(async () => true) };
  return {
    identity,
    auth,
    limits,
    service: new AuthService(identity, auth, limits),
    claims: (value: VerifiedIdentity | null) => {
      claims = value;
    },
    suspend: () => {
      profile = { ...profile, status: "suspended" };
    },
  };
}
it("routes enrolled clients through MFA and denies protected requests before the second factor", async () => {
  const s = setup();
  expect(
    await s.service.login({ email: "a@example.test", password: "synthetic" }),
  ).toEqual({ redirect: "/mfa" });
  await expect(s.auth.requireUser()).rejects.toMatchObject({
    code: "MFA_REQUIRED",
  });
  await expect(
    s.service.changePassword({ password: "SyntheticOnly123!" }),
  ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
  await expect(
    s.service.setPassword({ password: "SyntheticOnly123!" }),
  ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
  expect(s.identity.setPassword).not.toHaveBeenCalled();
  s.claims({
    subject: "client-a",
    provider: "supabase",
    assurance: "aal2",
    mfaEnrolled: true,
  });
  expect((await s.auth.requireUser()).profile.id).toBe("a");
  await expect(s.auth.requireAdmin()).rejects.toMatchObject({ status: 403 });
});
it("verifies client MFA into the client flow and blocks suspended sessions", async () => {
  const s = setup();
  const provider = { prepare: vi.fn(), verify: vi.fn(async () => {}) };
  const mfa = new MfaService(s.auth, provider, s.limits);
  expect(
    await mfa.execute({
      action: "verify",
      factorId: "10000000-0000-4000-8000-000000000001",
      code: "123456",
    }),
  ).toEqual({ redirect: "/portal/security" });
  s.suspend();
  await expect(mfa.execute({ action: "setup" })).rejects.toMatchObject({
    status: 403,
  });
});
it("changes only an active authenticated account password, validates length and signs out", async () => {
  const s = setup();
  s.claims({
    subject: "client-a",
    provider: "supabase",
    assurance: "aal2",
    mfaEnrolled: true,
  });
  await expect(
    s.service.changePassword({ password: "short" }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    s.service.changePassword({
      password: "SyntheticOnly123!",
      clientId: "other",
    }),
  ).rejects.toMatchObject({ status: 422 });
  expect(
    await s.service.changePassword({ password: "SyntheticOnly123!" }),
  ).toMatchObject({ redirect: "/login" });
  expect(s.identity.setPassword).toHaveBeenCalledWith("SyntheticOnly123!");
  expect(s.identity.signOut).toHaveBeenCalledOnce();
  s.claims(null);
  await expect(
    s.service.changePassword({ password: "SyntheticOnly123!" }),
  ).rejects.toMatchObject({ status: 401 });
});
