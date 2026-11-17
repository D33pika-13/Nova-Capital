import "server-only";
import { timingSafeEqual } from "node:crypto";
import {
  createRemoteJWKSet,
  customFetch,
  decodeProtectedHeader,
  jwtVerify,
} from "jose";
import { z } from "zod";
import { AppError, ConfigurationError } from "../errors";
import { readBinaryBody } from "../request-body";
import type { VerifiedIdentity } from "../contracts";
import { EntraAuthority, type EntraAuthorityOptions } from "./entra-authority";

export interface EntraTokenOptions extends EntraAuthorityOptions {
  /** Reviewed jwks_uri from this tenant's OIDC discovery document. */
  jwksUri: string;
  timeoutMs?: number;
}

/** Token-validation building block; not a session or a selectable login adapter. */
export class EntraTokenVerifier {
  readonly issuer: string;
  private readonly keys: ReturnType<typeof createRemoteJWKSet>;
  private readonly tenantId: string;
  private readonly clientId: string;
  constructor(
    options: EntraTokenOptions,
    request: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    const timeoutMs = options.timeoutMs ?? 5000;
    const authority = new EntraAuthority(options);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000)
      throw new ConfigurationError(["ENTRA_AUTHORITY"]);
    this.tenantId = authority.tenantId;
    this.clientId = authority.clientId;
    this.issuer = authority.issuer;
    const jwks = new URL(authority.endpoint("jwks", options.jwksUri));
    this.keys = createRemoteJWKSet(jwks, {
      timeoutDuration: timeoutMs,
      cacheMaxAge: 300000,
      cooldownDuration: 30000,
      [customFetch]: async (url, init) => {
        const controller = new AbortController();
        const signal = init?.signal
          ? AbortSignal.any([controller.signal, init.signal])
          : controller.signal;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            (async () => {
              if (String(url) !== jwks.href) throw Error("destination");
              const response = await request(jwks, {
                method: "GET",
                redirect: "error",
                headers: { Accept: "application/json" },
                signal,
              });
              if (
                signal.aborted ||
                response.status !== 200 ||
                response.redirected
              ) {
                void response.body?.cancel().catch(() => {});
                throw Error("keys");
              }
              const data = JSON.parse(
                new TextDecoder("utf-8", { fatal: true }).decode(
                  await readBinaryBody(response, 262144, signal),
                ),
              );
              if (
                !Array.isArray(data?.keys) ||
                data.keys.length < 1 ||
                data.keys.length > 64 ||
                data.keys.some(
                  (key: unknown) =>
                    !key ||
                    typeof key !== "object" ||
                    ["d", "p", "q", "dp", "dq", "qi", "oth", "k"].some(
                      (field) => field in key,
                    ),
                )
              )
                throw Error("keys");
              signal.throwIfAborted();
              return Response.json(data);
            })(),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => {
                controller.abort();
                reject(Error("deadline"));
              }, timeoutMs);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      },
    });
  }

  async verify(
    token: string,
    expectedNonce: string,
  ): Promise<Readonly<VerifiedIdentity>> {
    try {
      if (
        typeof token !== "string" ||
        token.length > 16384 ||
        typeof expectedNonce !== "string" ||
        !/^[A-Za-z0-9_-]{32,128}$/.test(expectedNonce)
      )
        throw Error("input");
      const header = decodeProtectedHeader(token);
      if (
        header.alg !== "RS256" ||
        header.typ !== "JWT" ||
        typeof header.kid !== "string" ||
        !/^[A-Za-z0-9._-]{1,128}$/.test(header.kid) ||
        header.jku ||
        header.x5u ||
        header.jwk
      )
        throw Error("header");
      const current = this.now();
      if (!Number.isSafeInteger(current) || current <= 0) throw Error("clock");
      const { payload } = await jwtVerify(token, this.keys, {
        algorithms: ["RS256"],
        issuer: this.issuer,
        audience: this.clientId,
        requiredClaims: [
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
        ],
        clockTolerance: 30,
        maxTokenAge: 600,
        currentDate: new Date(current),
      });
      const nonce = payload.nonce;
      if (
        payload.aud !== this.clientId ||
        payload.tid !== this.tenantId ||
        payload.ver !== "2.0" ||
        (payload.azp !== undefined && payload.azp !== this.clientId) ||
        !z.uuid().safeParse(payload.oid).success ||
        typeof payload.sub !== "string" ||
        !/^[\x21-\x7e]{1,255}$/.test(payload.sub) ||
        typeof nonce !== "string" ||
        nonce.length !== expectedNonce.length ||
        !timingSafeEqual(Buffer.from(nonce), Buffer.from(expectedNonce)) ||
        !Number.isSafeInteger(payload.iat) ||
        !Number.isSafeInteger(payload.nbf) ||
        !Number.isSafeInteger(payload.exp) ||
        payload.exp! * 1000 <= current ||
        payload.exp! <= payload.iat! ||
        payload.nbf! > payload.exp!
      )
        throw Error("claims");
      // Tenant-scoped immutable directory object identity, never email/roles/amr.
      // Admin assurance requires a separately implemented and verified MFA flow.
      return Object.freeze({
        provider: "entra",
        subject: `${this.tenantId}:${String(payload.oid).toLowerCase()}`,
        assurance: "aal1",
      });
    } catch {
      throw new AppError(
        "INVALID_IDENTITY_TOKEN",
        "Identity could not be verified.",
        401,
      );
    }
  }
}
