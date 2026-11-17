import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  config: { AUTH_PROVIDER: "entra", APP_URL: "https://app.example.test" },
  create: vi.fn(),
  start: vi.fn(),
  recover: vi.fn(),
  logoutBrowser: vi.fn(),
  callback: vi.fn(),
  logout: vi.fn(),
  mfa: vi.fn(),
  supaMfa: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/server/config", () => ({ loadConfig: async () => mocks.config }));
vi.mock("@/server/composition", () => ({ createServices: mocks.create }));
import { GET, POST } from "@/app/auth/entra/[action]/route";
import { POST as mfaPost } from "@/app/api/auth/mfa/route";
import { POST as genericPost } from "@/app/api/auth/[action]/route";
import { GET as legacyCallback } from "@/app/auth/callback/route";
function req(path: string, body?: string) {
  return new Request(`https://app.example.test${path}`, {
    method: "POST",
    headers: {
      Origin: "https://app.example.test",
      "Content-Type": "application/json",
    },
    body,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.AUTH_PROVIDER = "entra";
  for (const name of [
    "start",
    "recover",
    "logoutBrowser",
    "callback",
    "logout",
    "mfa",
  ] as const)
    mocks[name].mockImplementation(async () =>
      Response.json({ operation: name }),
    );
  mocks.supaMfa.mockResolvedValue({ enrolled: true });
  mocks.create.mockImplementation(async () => ({
    entra:
      mocks.config.AUTH_PROVIDER === "entra"
        ? {
            authHttp: {
              start: mocks.start,
              recover: mocks.recover,
              logoutBrowser: mocks.logoutBrowser,
              callback: mocks.callback,
              logout: mocks.logout,
            },
            mfaHttp: { execute: mocks.mfa },
          }
        : null,
    authCallback: null,
    mfa: { execute: mocks.supaMfa },
    identity: { signOut: mocks.signOut },
    config: mocks.config,
  }));
});
describe("selected provider route dispatch", () => {
  it.each(["start", "recover", "logout"])(
    "dispatches only selected Entra POST %s",
    async (action) => {
      const request = req(`/auth/entra/${action}`),
        response = await POST(request, { params: Promise.resolve({ action }) });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        operation: action === "logout" ? "logoutBrowser" : action,
      });
      expect(
        mocks[
          action === "logout"
            ? "logoutBrowser"
            : (action as "start" | "recover")
        ],
      ).toHaveBeenCalledExactlyOnceWith(request);
    },
  );
  it("dispatches the callback through its controller", async () => {
    const request = new Request(
      "https://app.example.test/auth/entra/callback?code=synthetic",
    );
    expect(
      (await GET(request, { params: Promise.resolve({ action: "callback" }) }))
        .status,
    ).toBe(200);
    expect(mocks.callback).toHaveBeenCalledExactlyOnceWith(request);
  });
  it("does not construct Entra services when another provider is selected", async () => {
    mocks.config.AUTH_PROVIDER = "supabase";
    const response = await POST(req("/auth/entra/start"), {
      params: Promise.resolve({ action: "start" }),
    });
    expect(response.status).toBe(404);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("rejects unknown route operations before service construction", async () => {
    for (const action of ["callback", "unknown"])
      expect(
        (
          await POST(req(`/auth/entra/${action}`), {
            params: Promise.resolve({ action }),
          })
        ).status,
      ).toBe(404);
    expect(
      (
        await GET(new Request("https://app.example.test/auth/entra/start"), {
          params: Promise.resolve({ action: "start" }),
        })
      ).status,
    ).toBe(404);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("keeps startup/dependency failures private on auth routes", async () => {
    mocks.create.mockRejectedValue(Error("private secret data"));
    const response = await POST(req("/auth/entra/start"), {
      params: Promise.resolve({ action: "start" }),
    });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private secret");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("dispatches the selected MFA protocol without passing it through Supabase JSON semantics", async () => {
    const request = req("/api/auth/mfa", JSON.stringify({ action: "setup" }));
    expect((await mfaPost(request)).status).toBe(200);
    expect(mocks.mfa).toHaveBeenCalledExactlyOnceWith(request);
    expect(mocks.supaMfa).not.toHaveBeenCalled();
    mocks.config.AUTH_PROVIDER = "supabase";
    expect(
      (await mfaPost(req("/api/auth/mfa", JSON.stringify({ action: "setup" }))))
        .status,
    ).toBe(200);
    expect(mocks.supaMfa).toHaveBeenCalledExactlyOnceWith({ action: "setup" });
  });
  it.each(["login", "reset", "password"])(
    "refuses legacy credential action %s on Entra before reading its body",
    async (action) => {
      const request = req(
        `/api/auth/${action}`,
        JSON.stringify({
          email: "synthetic@example.test",
          password: "private",
        }),
      );
      const response = await genericPost(request, {
        params: Promise.resolve({ action }),
      });
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("BROWSER_AUTH_REQUIRED");
      expect(request.bodyUsed).toBe(false);
      expect(mocks.signOut).not.toHaveBeenCalled();
    },
  );
  it("uses the selected local logout controller and prevents Supabase callback fallback", async () => {
    const request = req("/api/auth/logout");
    expect(
      (
        await genericPost(request, {
          params: Promise.resolve({ action: "logout" }),
        })
      ).status,
    ).toBe(200);
    expect(mocks.logout).toHaveBeenCalledExactlyOnceWith(request);
    expect(mocks.signOut).not.toHaveBeenCalled();
    const response = await legacyCallback(
      new Request("https://app.example.test/auth/callback?code=synthetic"),
    );
    expect(response.headers.get("location")).toBe(
      "https://app.example.test/login?error=link",
    );
  });
});
