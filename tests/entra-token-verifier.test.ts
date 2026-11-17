import { beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import {
  EntraTokenVerifier,
  type EntraTokenOptions,
} from "@/server/providers/entra-token-verifier";

const tenant = "10000000-0000-4000-8000-000000000001";
const client = "20000000-0000-4000-8000-000000000002";
const object = "30000000-0000-4000-8000-000000000003";
const now = Date.parse("2026-11-11T00:00:00Z");
const nonce = "synthetic-transaction-nonce-1234567890";
const options: EntraTokenOptions = {
  tenantId: tenant,
  clientId: client,
  tenantSubdomain: "synthetic",
  jwksUri: `https://synthetic.ciamlogin.com/${tenant}/discovery/v2.0/keys`,
};
const issuer = `https://synthetic.ciamlogin.com/${tenant}/v2.0`;
let pair: Awaited<ReturnType<typeof generateKeyPair>>;
let other: Awaited<ReturnType<typeof generateKeyPair>>;
let publicJwk: Awaited<ReturnType<typeof exportJWK>>;
beforeAll(async () => {
  [pair, other] = await Promise.all([
    generateKeyPair("RS256"),
    generateKeyPair("RS256"),
  ]);
  publicJwk = {
    ...(await exportJWK(pair.publicKey)),
    kid: "synthetic-key",
    alg: "RS256",
    use: "sig",
  };
});
async function token(
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
  key = pair.privateKey,
) {
  return new SignJWT({
    iss: issuer,
    aud: client,
    sub: "synthetic-pairwise-subject",
    oid: object,
    tid: tenant,
    ver: "2.0",
    nonce,
    iat: now / 1000,
    nbf: now / 1000 - 30,
    exp: now / 1000 + 3600,
    ...claims,
  } as JWTPayload)
    .setProtectedHeader({
      alg: "RS256",
      typ: "JWT",
      kid: "synthetic-key",
      ...header,
    })
    .sign(key);
}
function setup(response?: () => Promise<Response>, settings = options) {
  const request = vi.fn<typeof fetch>(
    response ?? (async () => Response.json({ keys: [publicJwk] })),
  );
  return {
    request,
    verifier: new EntraTokenVerifier(settings, request, () => now),
  };
}

describe("Entra ID token signature and claims", () => {
  it("verifies a real synthetic RSA signature and returns only tenant-scoped identity", async () => {
    const { verifier, request } = setup();
    const signed = await token({
      email: "admin@example.test",
      roles: ["admin"],
      amr: ["mfa"],
      clientId: "forged-client",
    });
    expect(await verifier.verify(signed, nonce)).toEqual({
      provider: "entra",
      subject: `${tenant}:${object}`,
      assurance: "aal1",
    });
    expect(Object.isFrozen(await verifier.verify(signed, nonce))).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(String(request.mock.calls[0][0])).toBe(options.jwksUri);
    expect(request.mock.calls[0][1]).toMatchObject({
      method: "GET",
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    expect(JSON.stringify(request.mock.calls)).not.toContain(signed);
  });
  it.each([
    { iss: "https://evil.example.test/v2.0" },
    { aud: "another-application" },
    { aud: [client, "another-application"] },
    { tid: "40000000-0000-4000-8000-000000000004" },
    { ver: "1.0" },
    { nonce: "wrong-transaction-nonce-1234567890123456" },
    { oid: "email@example.test" },
    { sub: "" },
    { sub: "invalid\nsubject" },
    { azp: "different-party" },
    { iat: now / 1000 + 60 },
    { iat: now / 1000 - 631 },
    { nbf: now / 1000 + 60 },
    { exp: now / 1000 - 1 },
    { iat: now / 1000 + 0.5 },
    { nbf: now / 1000 - 0.5 },
    { exp: now / 1000 + 0.5 },
  ])(
    "rejects signed tokens with invalid security claims (%#)",
    async (claims) => {
      await expect(
        setup().verifier.verify(await token(claims), nonce),
      ).rejects.toMatchObject({ code: "INVALID_IDENTITY_TOKEN", status: 401 });
    },
  );
  it.each([
    "iss",
    "aud",
    "sub",
    "oid",
    "tid",
    "ver",
    "iat",
    "nbf",
    "exp",
    "nonce",
  ])("requires %s", async (claim) => {
    await expect(
      setup().verifier.verify(await token({ [claim]: undefined }), nonce),
    ).rejects.toMatchObject({ code: "INVALID_IDENTITY_TOKEN" });
  });
  it("rejects a forged RSA signature without exposing token or cryptographic details", async () => {
    await expect(
      setup().verifier.verify(await token({}, {}, other.privateKey), nonce),
    ).rejects.toMatchObject({ message: "Identity could not be verified." });
  });
  it.each([
    { alg: "HS256" },
    { typ: "at+jwt" },
    { kid: "" },
    { jku: "https://evil.example.test/keys" },
    { x5u: "https://evil.example.test/cert" },
    { jwk: {} },
  ])(
    "rejects untrusted header choices before key lookup (%#)",
    async (header) => {
      const { verifier, request } = setup();
      const signed =
        header.alg === "HS256"
          ? await new SignJWT({})
              .setProtectedHeader({
                alg: "HS256",
                kid: "synthetic-key",
                typ: "JWT",
              })
              .sign(new Uint8Array(32))
          : await token({}, header);
      await expect(verifier.verify(signed, nonce)).rejects.toMatchObject({
        code: "INVALID_IDENTITY_TOKEN",
      });
      expect(request).not.toHaveBeenCalled();
    },
  );
  it("rejects missing transaction nonce and oversized JWTs before fetching keys", async () => {
    const { verifier, request } = setup();
    await expect(verifier.verify(await token(), "")).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      verifier.verify("a".repeat(16385), nonce),
    ).rejects.toMatchObject({ status: 401 });
    expect(request).not.toHaveBeenCalled();
  });
  it("bounds unknown-key refresh attempts during the shared resolver cooldown", async () => {
    const { verifier, request } = setup();
    await verifier.verify(await token(), nonce);
    for (const kid of ["unknown-key-1", "unknown-key-2"])
      await expect(
        verifier.verify(await token({}, { kid }), nonce),
      ).rejects.toMatchObject({ status: 401 });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("refreshes expired cached keys to verify an actual rotated signing key", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const started = Date.now();
    try {
      let keys = [publicJwk];
      const { verifier, request } = setup(async () => Response.json({ keys }));
      await verifier.verify(await token(), nonce);
      keys = [
        {
          ...(await exportJWK(other.publicKey)),
          kid: "rotated-key",
          alg: "RS256",
          use: "sig",
        },
      ];
      vi.setSystemTime(started + 300001);
      expect(
        await verifier.verify(
          await token({}, { kid: "rotated-key" }, other.privateKey),
          nonce,
        ),
      ).toMatchObject({ provider: "entra" });
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Entra signing-key transport", () => {
  it.each([
    "https://evil.example.test/keys",
    `http://synthetic.ciamlogin.com/${tenant}/discovery/v2.0/keys`,
    `${options.jwksUri}?appid=unreviewed`,
    `${options.jwksUri}#fragment`,
    `https://name:secret@synthetic.ciamlogin.com/${tenant}/discovery/v2.0/keys`,
    "https://synthetic.ciamlogin.com/common/oauth2/token",
  ])("rejects an unapproved key URL (%#)", (jwksUri) => {
    expect(() => new EntraTokenVerifier({ ...options, jwksUri })).toThrow(
      "ENTRA_JWKS_URI",
    );
  });
  it.each([
    { tenantId: "common" },
    { clientId: "not-a-guid" },
    { tenantSubdomain: "synthetic.evil.test" },
    { timeoutMs: 0 },
    { timeoutMs: 10001 },
  ])("rejects invalid authority settings (%#)", (change) => {
    expect(() => new EntraTokenVerifier({ ...options, ...change })).toThrow(
      "ENTRA_AUTHORITY",
    );
  });
  it.each([
    () => Response.json({ keys: [] }),
    () => Response.json({ keys: [publicJwk, publicJwk] }),
    () =>
      Response.json({
        keys: [{ ...publicJwk, d: "synthetic-private-material" }],
      }),
    () => Response.json({ keys: Array.from({ length: 65 }, () => publicJwk) }),
    () => new Response("not-json"),
    () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.example.test/keys" },
      }),
    () => new Response("private-provider-error", { status: 503 }),
    () => new Response("a".repeat(262145)),
  ])(
    "fails closed on invalid or oversized key responses (%#)",
    async (response) => {
      const { verifier } = setup(async () => response());
      await expect(verifier.verify(await token(), nonce)).rejects.toMatchObject(
        { message: "Identity could not be verified." },
      );
    },
  );
  it("bounds a hung key fetch and cancels a late response", async () => {
    let finish!: (response: Response) => void;
    const request = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const verifier = new EntraTokenVerifier(
      { ...options, timeoutMs: 20 },
      request,
      () => now,
    );
    await expect(verifier.verify(await token(), nonce)).rejects.toMatchObject({
      status: 401,
    });
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
    const cancel = vi.fn();
    finish(new Response(new ReadableStream({ cancel })));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  });
  it("cancels a stalled key response body at the operation deadline", async () => {
    const cancel = vi.fn();
    const { verifier } = setup(
      async () => new Response(new ReadableStream({ cancel })),
      { ...options, timeoutMs: 20 },
    );
    await expect(verifier.verify(await token(), nonce)).rejects.toMatchObject({
      status: 401,
    });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
