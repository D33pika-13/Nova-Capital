import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Telemetry } from "./contracts";
import { AppError, ConfigurationError } from "./errors";
import { readBinaryBody } from "./http";
import { parseFlatStringObject } from "./flat-json";
import type { EntraCookies } from "./providers/entra-cookies";
import type { EntraBrowserSessions } from "./entra-http";

export interface EntraBrowserMfa {
  prepare(
    token: string,
  ): Promise<{ factorId: string; enrolled: boolean; provisioningUri?: string }>;
  regenerate(
    token: string,
    code: string,
    recovery?: boolean,
  ): Promise<{ token: string; expiresAt: string; recoveryCodes: string[] }>;
  remove(
    token: string,
    code: string,
    recovery?: boolean,
  ): Promise<{ removed: true }>;
  verify(
    token: string,
    code: string,
    recovery?: boolean,
  ): Promise<{
    token: string;
    expiresAt: string;
    recoveryCodes: string[] | null;
  }>;
}
const recoveryPattern = /^[A-Fa-f0-9]{4}(?:-[A-Fa-f0-9]{4}){7}$/;
const lifecycleInput = <T extends "regenerate" | "remove">(action: T) =>
  z
    .object({
      action: z.literal(action),
      method: z.enum(["totp", "recovery"]),
      code: z.string().max(39),
    })
    .strict()
    .refine((value) =>
      (value.method === "recovery" ? recoveryPattern : /^\d{6}$/).test(
        value.code,
      ),
    );
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setup") }).strict(),
  lifecycleInput("regenerate"),
  lifecycleInput("remove"),
  z
    .object({ action: z.literal("verify"), code: z.string().regex(/^\d{6}$/) })
    .strict(),
  z
    .object({
      action: z.literal("recover"),
      code: z.string().regex(recoveryPattern),
    })
    .strict(),
]);

/** Flat string-only JSON grammar rejects ambiguity, including escaped duplicate keys. */
function parseInput(text: string) {
  return inputSchema.parse(parseFlatStringObject(text, 1024));
}

/** Selected-provider MFA transport; domain authorization remains in the service/database. */
export class EntraMfaHttp {
  private readonly origin: string;
  constructor(
    private readonly mfa: EntraBrowserMfa,
    private readonly sessions: Pick<EntraBrowserSessions, "revoke">,
    private readonly cookies: EntraCookies,
    private readonly telemetry: Telemetry,
    applicationOrigin: string,
  ) {
    try {
      const url = new URL(applicationOrigin);
      if (url.protocol !== "https:" || url.origin !== applicationOrigin)
        throw Error("origin");
      this.origin = url.origin;
    } catch {
      throw new ConfigurationError(["ENTRA_HTTP_ORIGIN"]);
    }
  }
  private headers() {
    return {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      Pragma: "no-cache",
    };
  }
  private failure(status: number, code: string, error: string) {
    return NextResponse.json(
      { code, error },
      { status, headers: this.headers() },
    );
  }
  private provisioning(value: string) {
    if (typeof value !== "string" || value.length > 2048)
      throw Error("provisioning");
    const uri = new URL(value);
    if (
      uri.protocol !== "otpauth:" ||
      uri.hostname !== "totp" ||
      uri.port ||
      uri.username ||
      uri.password ||
      uri.hash ||
      uri.pathname.length < 2 ||
      uri.pathname.length > 512
    )
      throw Error("provisioning");
    const allowed = new Set([
        "secret",
        "issuer",
        "algorithm",
        "digits",
        "period",
      ]),
      seen = new Set<string>();
    for (const key of uri.searchParams.keys()) {
      if (!allowed.has(key) || seen.has(key)) throw Error("provisioning");
      seen.add(key);
    }
    if (
      !/^[A-Z2-7]{32}$/.test(uri.searchParams.get("secret") ?? "") ||
      !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(
        uri.searchParams.get("issuer") ?? "",
      ) ||
      (uri.searchParams.get("algorithm") ?? "SHA1") !== "SHA1" ||
      (uri.searchParams.get("digits") ?? "6") !== "6" ||
      (uri.searchParams.get("period") ?? "30") !== "30"
    )
      throw Error("provisioning");
    return value;
  }
  async execute(request: Request) {
    if (request.method !== "POST") {
      const response = this.failure(
        405,
        "METHOD_NOT_ALLOWED",
        "This request method is not supported.",
      );
      response.headers.set("Allow", "POST");
      return response;
    }
    const url = new URL(request.url);
    const host = request.headers.get("host") ?? url.host;
    if (
      host.toLowerCase() !== new URL(this.origin).host ||
      request.headers.get("origin") !== this.origin
    )
      return this.failure(
        403,
        "ORIGIN_DENIED",
        "Request origin is not allowed.",
      );
    if (url.pathname !== "/api/auth/mfa" || url.search || url.hash)
      return this.failure(
        400,
        "INVALID_MFA_REQUEST",
        "Use a valid authentication request.",
      );
    let input: z.infer<typeof inputSchema>;
    try {
      if (
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
          request.headers.get("content-type") ?? "",
        ) ||
        request.headers.has("content-encoding")
      )
        throw Error("content");
      const length = request.headers.get("content-length");
      if (
        length !== null &&
        (!/^\d{1,4}$/.test(length) || Number(length) > 1024)
      )
        throw Error("size");
      const bytes = await readBinaryBody(
        request,
        1024,
        AbortSignal.any([request.signal, AbortSignal.timeout(3000)]),
      );
      input = parseInput(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      return this.failure(
        400,
        "INVALID_MFA_REQUEST",
        "Use a valid authentication request.",
      );
    }
    let session: string | undefined;
    try {
      session = this.cookies.read(request).session;
    } catch {
      return this.failure(
        400,
        "INVALID_AUTH_COOKIE",
        "Sign-in cookies could not be verified. Sign in again.",
      );
    }
    if (!session)
      return this.failure(
        401,
        "UNAUTHENTICATED",
        "Please sign in to continue.",
      );
    let attemptedRotation = false,
      issued: string | undefined;
    try {
      if (input.action === "setup") {
        const factor = await this.mfa.prepare(session);
        if (
          !z.uuid().safeParse(factor.factorId).success ||
          typeof factor.enrolled !== "boolean"
        )
          throw Error("factor");
        const result = factor.enrolled
          ? { factorId: factor.factorId, enrolled: true }
          : {
              factorId: factor.factorId,
              enrolled: false,
              provisioningUri: this.provisioning(factor.provisioningUri!),
            };
        return NextResponse.json(result, { headers: this.headers() });
      }
      attemptedRotation = true;
      if (input.action === "remove") {
        const result = await this.mfa.remove(
          session,
          input.code,
          input.method === "recovery",
        );
        if (result.removed !== true) throw Error("removal");
        const response = NextResponse.json(
          { redirect: "/login", removed: true },
          { headers: this.headers() },
        );
        this.cookies.clear(response);
        return response;
      }
      const result =
        input.action === "regenerate"
          ? await this.mfa.regenerate(
              session,
              input.code,
              input.method === "recovery",
            )
          : await this.mfa.verify(
              session,
              input.code,
              input.action === "recover",
            );
      issued = result.token;
      const codes = result.recoveryCodes;
      if (
        (input.action === "regenerate" && codes === null) ||
        (codes !== null &&
          (input.action === "recover" ||
            !Array.isArray(codes) ||
            codes.length !== 10 ||
            new Set(codes).size !== 10 ||
            codes.some(
              (code) => typeof code !== "string" || !recoveryPattern.test(code),
            )))
      )
        throw Error("recovery");
      const response = NextResponse.json(
        { redirect: "/admin", recoveryCodes: codes },
        { headers: this.headers() },
      );
      this.cookies.session(response, {
        token: result.token,
        expiresAt: result.expiresAt,
        maxAgeSeconds: 28800,
      });
      return response;
    } catch (error) {
      if (issued) {
        try {
          await this.sessions.revoke(issued, false);
        } catch {
          try {
            this.telemetry.event("auth.session_cleanup_failed", {
              provider: "entra",
              status: "unavailable",
            });
          } catch {
            /* Keep dependency failures private. */
          }
        }
      }
      const denied =
        !issued && error instanceof AppError && error.code === "MFA_DENIED";
      const limited =
        !issued && error instanceof AppError && error.code === "RATE_LIMITED";
      const response = this.failure(
        denied ? 403 : limited ? 429 : 503,
        denied ? "MFA_DENIED" : limited ? "RATE_LIMITED" : "MFA_UNAVAILABLE",
        denied
          ? "Authentication could not be verified. Sign in again or try later."
          : limited
            ? "Too many attempts. Please try again later."
            : "Authentication is temporarily unavailable. Please try again.",
      );
      // A normal denied code leaves the current session usable. After uncertain
      // rotation or failed response installation, discard the possibly revoked cookie.
      if (attemptedRotation && !denied && !limited)
        this.cookies.clearSession(response);
      return response;
    }
  }
}
