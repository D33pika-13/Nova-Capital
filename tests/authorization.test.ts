import { describe, expect, it, vi } from "vitest";
import { AuthorizationService } from "@/server/modules/identity/authorization-service";
import type {
  IdentityProvider,
  Profile,
  VerifiedIdentity,
} from "@/server/contracts";
const active: Profile = {
  id: "internal-a",
  externalSubject: "auth-a",
  role: "client",
  status: "active",
  clientId: "INV-1001",
  displayName: "Synthetic A",
};
function service(
  profile: Profile | null = active,
  identity: VerifiedIdentity | null = {
    subject: "auth-a",
    provider: "supabase",
    assurance: "aal1",
  },
) {
  const provider: IdentityProvider = {
    verify: vi.fn(async () => identity),
    signIn: vi.fn(),
    signOut: vi.fn(),
    setPassword: vi.fn(),
    requestReset: vi.fn(),
  };
  return new AuthorizationService(provider, {
    findByIdentity: vi.fn(async () => profile),
  });
}
describe("authorization", () => {
  it("rejects anonymous requests", async () => {
    await expect(service(active, null).requireUser()).rejects.toMatchObject({
      status: 401,
    });
  });
  it("rejects identities without an application profile", async () => {
    await expect(service(null).requireUser()).rejects.toMatchObject({
      status: 403,
    });
  });
  it.each(["suspended", "deactivated"] as const)(
    "rejects %s accounts",
    async (status) => {
      await expect(
        service({ ...active, status }).requireUser(),
      ).rejects.toMatchObject({ status: 403 });
    },
  );
  it("allows an active client to access their verified context", async () => {
    expect((await service().requireUser()).profile.id).toBe("internal-a");
  });
  it("rejects client attempts to use administrator operations", async () => {
    await expect(service().requireAdmin()).rejects.toMatchObject({
      status: 403,
    });
  });
  it("requires MFA even for administrators", async () => {
    await expect(
      service({ ...active, role: "admin" }).requireAdmin(),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
  });
  it("allows active MFA-verified admins", async () => {
    expect(
      (
        await service(
          { ...active, role: "admin" },
          { subject: "auth-a", provider: "supabase", assurance: "aal2" },
        ).requireAdmin()
      ).profile.role,
    ).toBe("admin");
  });
  it("rechecks account state for each operation", async () => {
    let current: Profile = active;
    const provider = {
      verify: async () => ({
        subject: "auth-a",
        provider: "supabase",
        assurance: "aal1" as const,
      }),
      signIn: vi.fn(),
      signOut: vi.fn(),
      setPassword: vi.fn(),
      requestReset: vi.fn(),
    };
    const auth = new AuthorizationService(provider, {
      findByIdentity: async () => current,
    });
    await auth.requireUser();
    current = { ...active, status: "suspended" };
    await expect(auth.requireUser()).rejects.toMatchObject({ status: 403 });
  });
});
