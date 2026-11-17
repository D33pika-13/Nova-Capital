import { beforeEach, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const state = vi.hoisted(() => ({ provider: "entra", enabled: true }));
vi.mock("@/server/config", () => ({
  loadConfig: async () => ({
    AUTH_PROVIDER: state.provider,
    SERVICES_ENABLED: state.enabled,
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  redirect: (path: string) => {
    throw Error(`redirect:${path}`);
  },
}));
import Login from "@/app/login/page";
import { SelectedLogout } from "@/components/selected-logout";
beforeEach(() => {
  state.provider = "entra";
  state.enabled = true;
});
it("selects delegated Entra login/recovery without local credential fields", async () => {
  const login = renderToStaticMarkup(
    await Login({ searchParams: Promise.resolve({}) }),
  );
  expect(login).toContain('action="/auth/entra/start"');
  expect(login).not.toContain('type="password"');
  expect(login).not.toContain('type="email"');
  const recovery = renderToStaticMarkup(
    await Login({ searchParams: Promise.resolve({ mode: "reset" }) }),
  );
  expect(recovery).toContain('action="/auth/entra/recover"');
  expect(recovery).toContain("Forgot password?");
  expect(recovery).not.toContain('type="email"');
  expect(recovery).not.toContain("We’ll send");
});
it("preserves Supabase login and reset presentation", async () => {
  state.provider = "supabase";
  const login = renderToStaticMarkup(
    await Login({ searchParams: Promise.resolve({}) }),
  );
  expect(login).toContain('type="password"');
  expect(login).toContain('type="email"');
  expect(login).not.toContain("/auth/entra/start");
  const recovery = renderToStaticMarkup(
    await Login({ searchParams: Promise.resolve({ mode: "reset" }) }),
  );
  expect(recovery).toContain('type="email"');
  expect(recovery).not.toContain("/auth/entra/recover");
});
it("keeps the unconfigured shell unavailable for either provider", async () => {
  state.enabled = false;
  for (const provider of ["entra", "supabase"]) {
    state.provider = provider;
    const html = renderToStaticMarkup(
      await Login({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain("login is unavailable");
    expect(html).not.toContain("<form");
  }
});
it("uses native provider sign-out only on the selected Entra path", () => {
  expect(renderToStaticMarkup(<SelectedLogout provider="entra" />)).toContain(
    'action="/auth/entra/logout"',
  );
  expect(
    renderToStaticMarkup(<SelectedLogout provider="supabase" />),
  ).not.toContain("/auth/entra/logout");
});
