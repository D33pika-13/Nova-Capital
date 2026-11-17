import { describe, it, expect, vi } from "vitest";
import type { TokenCredential } from "@azure/identity";
import {
  EntraDirectoryUsers,
  type EntraDirectoryOptions,
} from "@/server/providers/entra-directory";
import { ConfigurationError } from "@/server/errors";
const tenant = "40000000-0000-4000-8000-000000000004",
  id = "50000000-0000-4000-8000-000000000005";
const now = Date.parse("2026-11-11T00:00:00Z"),
  email = "synthetic@example.test";
const account = {
  id,
  accountEnabled: true,
  userType: "Member",
  identities: [
    {
      signInType: "emailAddress",
      issuer: "synthetic.onmicrosoft.com",
      issuerAssignedId: email,
    },
  ],
};
const result = { objectId: id, subject: `${tenant}:${id}`, email };
const options = { tenantId: tenant, tenantSubdomain: "synthetic" };
function setup(
  response: () => Response = () => Response.json({ value: [account] }),
  settings: EntraDirectoryOptions = options,
) {
  const credential = {
    getToken: vi.fn<TokenCredential["getToken"]>(async () => ({
      token: "synthetic-graph-token",
      expiresOnTimestamp: now + 60000,
    })),
  };
  const request = vi.fn<typeof fetch>(async () => response());
  const directory = new EntraDirectoryUsers(
    settings,
    credential,
    request,
    () => now,
  );
  return { directory, request, credential };
}

describe("Entra customer directory boundary", () => {
  it("uses a fixed Graph scope, escaped identity query and selected minimal output", async () => {
    const state = setup();
    expect(await state.directory.findByEmail(email.toUpperCase())).toEqual(
      result,
    );
    const [destination, init] = state.request.mock.calls[0],
      url = new URL(String(destination));
    expect(url.origin).toBe("https://graph.microsoft.com");
    expect(url.pathname).toBe("/v1.0/users");
    expect(url.searchParams.get("$filter")).toBe(
      `identities/any(i:i/issuerAssignedId eq '${email}' and i/issuer eq 'synthetic.onmicrosoft.com')`,
    );
    expect(url.searchParams.get("$top")).toBe("2");
    expect(url.searchParams.get("$select")).toBe(
      "id,accountEnabled,userType,identities",
    );
    expect(init).toMatchObject({
      method: "GET",
      redirect: "error",
      cache: "no-store",
      headers: { Authorization: "Bearer synthetic-graph-token" },
    });
    expect(state.credential.getToken.mock.calls[0][0]).toBe(
      "https://graph.microsoft.com/.default",
    );
  });
  it("escapes legitimate apostrophes without permitting filter injection", async () => {
    const value = "o'hara@example.test",
      state = setup(() =>
        Response.json({
          value: [
            {
              ...account,
              identities: [
                { ...account.identities[0], issuerAssignedId: value },
              ],
            },
          ],
        }),
      );
    expect((await state.directory.findByEmail(value))!.email).toBe(value);
    expect(
      new URL(String(state.request.mock.calls[0][0])).searchParams.get(
        "$filter",
      ),
    ).toContain("o''hara@example.test");
  });
  it("returns null only for a successful unpaged empty lookup", async () => {
    expect(
      await setup(() => Response.json({ value: [] })).directory.findByEmail(
        email,
      ),
    ).toBeNull();
    await expect(
      setup(() => new Response(null, { status: 404 })).directory.findByEmail(
        email,
      ),
    ).rejects.toMatchObject({ code: "DIRECTORY_UNAVAILABLE" });
  });
  it("reads a fixed object ID, checks expected identity and freezes minimal output", async () => {
    const state = setup(() =>
      Response.json({
        ...account,
        passwordProfile: { password: "private" },
        displayName: "private extra",
      }),
    );
    const value = await state.directory.getById(id.toUpperCase(), email);
    expect(value).toEqual(result);
    expect(Object.isFrozen(value)).toBe(true);
    expect(new URL(String(state.request.mock.calls[0][0])).pathname).toBe(
      `/v1.0/users/${id}`,
    );
  });
  it.each([
    { value: [account, account] },
    { value: [account], "@odata.nextLink": "https://evil.example.test/steal" },
    { value: [], "@odata.nextLink": null },
  ])("denies ambiguity/paging %# without following links", async (response) => {
    const state = setup(() => Response.json(response));
    await expect(state.directory.findByEmail(email)).rejects.toMatchObject({
      code: "DIRECTORY_CONFLICT",
      status: 409,
    });
    expect(state.request).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...account, id: "not-an-id" },
    { ...account, accountEnabled: false },
    { ...account, userType: "Guest" },
    { ...account, identities: [] },
    {
      ...account,
      identities: [
        { ...account.identities[0], issuer: "other.onmicrosoft.com" },
      ],
    },
    {
      ...account,
      identities: [
        { ...account.identities[0], issuerAssignedId: "other@example.test" },
      ],
    },
    {
      ...account,
      identities: [
        { ...account.identities[0], signInType: "userPrincipalName" },
      ],
    },
    { ...account, identities: [account.identities[0], account.identities[0]] },
  ])("refuses an unproven/disabled/foreign customer %#", async (user) => {
    const state = setup(() => Response.json({ value: [user] }));
    await expect(state.directory.findByEmail(email)).rejects.toMatchObject({
      status: expect.any(Number),
    });
  });
  it("refuses object-ID substitution even with matching email", async () => {
    const state = setup(() => Response.json({ ...account, id: tenant }));
    await expect(state.directory.getById(id, email)).rejects.toMatchObject({
      code: "DIRECTORY_CONFLICT",
    });
  });
  it.each([
    "not-email",
    " x@example.test",
    "x@example.test ",
    "x' or true",
    "x\n@example.test",
  ])("validates email %j before acquiring credentials", async (value) => {
    const state = setup();
    await expect(state.directory.findByEmail(value)).rejects.toMatchObject({
      code: "INVALID_DIRECTORY_REQUEST",
      status: 422,
    });
    expect(state.credential.getToken).not.toHaveBeenCalled();
    expect(state.request).not.toHaveBeenCalled();
  });
  it("validates names and object IDs before any I/O", async () => {
    const state = setup();
    for (const name of ["", " ", " bad", "bad\nname", "x".repeat(129)])
      await expect(
        state.directory.createCustomer(email, name),
      ).rejects.toMatchObject({ code: "INVALID_DIRECTORY_REQUEST" });
    await expect(
      state.directory.getById("../../other", email),
    ).rejects.toMatchObject({ code: "INVALID_DIRECTORY_REQUEST" });
    expect(state.credential.getToken).not.toHaveBeenCalled();
  });
  it.each([
    { tenantId: "bad" },
    { tenantSubdomain: "../other" },
    { tenantSubdomain: "UpperCase" },
    { timeoutMs: 0 },
    { timeoutMs: 20001 },
  ])("rejects configuration %# without I/O", (invalid) => {
    const request = vi.fn();
    expect(
      () =>
        new EntraDirectoryUsers(
          { ...options, ...invalid },
          { getToken: vi.fn() },
          request,
        ),
    ).toThrow(ConfigurationError);
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { token: "", expiresOnTimestamp: now + 60000 },
    { token: "bad\r\nheader", expiresOnTimestamp: now + 60000 },
    { token: "synthetic", expiresOnTimestamp: now + 30000 },
    { token: "synthetic", expiresOnTimestamp: Infinity },
  ])("fails closed on credentials %#", async (token) => {
    const request = vi.fn(),
      credential = { getToken: vi.fn(async () => token) };
    await expect(
      new EntraDirectoryUsers(
        options,
        credential,
        request,
        () => now,
      ).findByEmail(email),
    ).rejects.toMatchObject({ code: "DIRECTORY_UNAVAILABLE" });
    expect(request).not.toHaveBeenCalled();
  });
  it.each([302, 401, 403, 429, 500])(
    "does not retry or accept unsuccessful lookup status %i",
    async (status) => {
      const state = setup(() => new Response("private error", { status }));
      await expect(state.directory.findByEmail(email)).rejects.toMatchObject({
        code: "DIRECTORY_UNAVAILABLE",
      });
      expect(state.request).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    () =>
      new Response("private body", {
        headers: { "Content-Type": "text/plain" },
      }),
    () =>
      new Response("{", { headers: { "Content-Type": "application/json" } }),
    () =>
      new Response("x".repeat(65537), {
        headers: { "Content-Type": "application/json" },
      }),
    () =>
      new Response(new Uint8Array([0xff]), {
        headers: { "Content-Type": "application/json" },
      }),
    () => {
      const response = Response.json({ value: [account] });
      Object.defineProperty(response, "redirected", { value: true });
      return response;
    },
    () => {
      const response = Response.json({ value: [account] });
      Object.defineProperty(response, "url", {
        value: "https://evil.example.test",
      });
      return response;
    },
  ])(
    "denies invalid transport/body %# with a private error",
    async (response) => {
      const state = setup(response);
      await expect(state.directory.findByEmail(email)).rejects.toMatchObject({
        code: "DIRECTORY_UNAVAILABLE",
        message: "Directory account details could not be verified.",
      });
      expect(state.request).toHaveBeenCalledTimes(1);
    },
  );
  it("creates once with an unknown high-entropy password and requires independent ID readback", async () => {
    const state = setup();
    state.request.mockImplementation(async (_url, init) =>
      init?.method === "POST"
        ? Response.json({ id }, { status: 201 })
        : Response.json(account),
    );
    expect(
      await state.directory.createCustomer(email, "Synthetic Client"),
    ).toEqual(result);
    expect(state.request).toHaveBeenCalledTimes(2);
    expect(state.credential.getToken).toHaveBeenCalledTimes(1);
    const [url, post] = state.request.mock.calls[0];
    expect(String(url)).toBe("https://graph.microsoft.com/v1.0/users");
    const body = JSON.parse(String(post!.body));
    expect(body).toMatchObject({
      accountEnabled: true,
      displayName: "Synthetic Client",
      identities: account.identities,
      mail: email,
      passwordPolicies: "DisablePasswordExpiration",
      passwordProfile: { forceChangePasswordNextSignIn: true },
    });
    expect(body.passwordProfile.password).toMatch(/^Aa1![A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(result)).not.toContain(body.passwordProfile.password);
    expect(new URL(String(state.request.mock.calls[1][0])).pathname).toBe(
      `/v1.0/users/${id}`,
    );
  });
  it.each([400, 401, 403, 404, 409, 422, 429])(
    "distinguishes a definitive creation rejection %i and never retries",
    async (status) => {
      const state = setup(
        () => new Response("private error details", { status }),
      );
      await expect(
        state.directory.createCustomer(email, "Synthetic"),
      ).rejects.toMatchObject({
        code:
          status === 409
            ? "DIRECTORY_CONFLICT"
            : status === 429
              ? "DIRECTORY_RATE_LIMITED"
              : "DIRECTORY_REJECTED",
      });
      expect(state.request).toHaveBeenCalledTimes(1);
    },
  );
  it.each([500, 502, 503])(
    "reports uncertain creation after server status %i",
    async (status) => {
      const state = setup(
        () => new Response("private error details", { status }),
      );
      await expect(
        state.directory.createCustomer(email, "Synthetic"),
      ).rejects.toMatchObject({
        code: "ACCOUNT_CREATION_UNCERTAIN",
        status: 503,
      });
      expect(state.request).toHaveBeenCalledTimes(1);
    },
  );
  it("keeps create-response or readback failures uncertain rather than claiming no write", async () => {
    for (const mode of ["malformed", "readback", "identity"] as const) {
      const state = setup();
      state.request.mockImplementation(async (_url, init) => {
        if (init?.method === "POST")
          return Response.json(mode === "malformed" ? { id: "bad" } : { id }, {
            status: 201,
          });
        return mode === "readback"
          ? new Response(null, { status: 404 })
          : Response.json({ ...account, identities: [] });
      });
      await expect(
        state.directory.createCustomer(email, "Synthetic"),
      ).rejects.toMatchObject({ code: "ACCOUNT_CREATION_UNCERTAIN" });
      expect(
        state.request.mock.calls.filter(([, init]) => init?.method === "POST"),
      ).toHaveLength(1);
    }
  });
  it("times out token acquisition and prevents late credentials from starting a request", async () => {
    let release!: (value: {
      token: string;
      expiresOnTimestamp: number;
    }) => void;
    let signal: AbortSignal | undefined;
    const credential = {
        getToken: vi.fn(
          (_scope: unknown, options?: { abortSignal?: AbortSignal }) => {
            signal = options?.abortSignal;
            return new Promise<{ token: string; expiresOnTimestamp: number }>(
              (resolve) => {
                release = resolve;
              },
            );
          },
        ),
      },
      request = vi.fn();
    const directory = new EntraDirectoryUsers(
      { ...options, timeoutMs: 5 },
      credential,
      request,
      () => now,
    );
    await expect(directory.findByEmail(email)).rejects.toMatchObject({
      code: "DIRECTORY_UNAVAILABLE",
    });
    expect(signal!.aborted).toBe(true);
    release({ token: "synthetic", expiresOnTimestamp: now + 60000 });
    await Promise.resolve();
    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();
  });
  it("reports an uncertain timed-out POST and aborts its transport without retrying", async () => {
    let signal: AbortSignal | undefined;
    const credential = {
      getToken: vi.fn(async () => ({
        token: "synthetic",
        expiresOnTimestamp: now + 60000,
      })),
    };
    const request = vi.fn<typeof fetch>(async (_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    const directory = new EntraDirectoryUsers(
      { ...options, timeoutMs: 5 },
      credential,
      request,
      () => now,
    );
    await expect(
      directory.createCustomer(email, "Synthetic"),
    ).rejects.toMatchObject({ code: "ACCOUNT_CREATION_UNCERTAIN" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(signal!.aborted).toBe(true);
  });
  it("bounds a hung response body and redacts dependency exceptions", async () => {
    let canceled = false;
    const state = setup(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("{"));
            },
            cancel() {
              canceled = true;
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      { ...options, timeoutMs: 5 },
    );
    await expect(state.directory.findByEmail(email)).rejects.toMatchObject({
      code: "DIRECTORY_UNAVAILABLE",
    });
    expect(canceled).toBe(true);
    const failing = setup();
    failing.credential.getToken.mockRejectedValue(
      Error("private access token and email"),
    );
    await expect(failing.directory.findByEmail(email)).rejects.toMatchObject({
      message: "Directory account details could not be verified.",
    });
    expect(failing.request).not.toHaveBeenCalled();
  });
});
