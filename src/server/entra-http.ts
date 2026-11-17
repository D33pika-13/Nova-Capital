import "server-only";
import { NextResponse } from "next/server";
import type {
  ProfileRepository,
  Telemetry,
  VerifiedIdentity,
} from "./contracts";
import { AppError, ConfigurationError } from "./errors";
import { readBinaryBody } from "./http";
import type { EntraCookies } from "./providers/entra-cookies";

import type { EntraLoginPurpose } from "./modules/identity/oidc-login-contracts";
export interface EntraBrowserFlow {
  start(
    binding?: string,
    purpose?: EntraLoginPurpose,
  ): Promise<{
    authorizationUrl: string;
    browserBinding: string;
    maxAgeSeconds: number;
  }>;
  completeFlow(
    parameters: URLSearchParams,
    binding: string,
  ): Promise<
    Readonly<{
      identity: Readonly<VerifiedIdentity>;
      purpose: EntraLoginPurpose;
    }>
  >;
}
export interface EntraBrowserSessions {
  issue(
    identity: VerifiedIdentity,
    previousToken?: string,
  ): Promise<{ token: string; expiresAt: string; maxAgeSeconds: number }>;
  issueRecovery(
    identity: VerifiedIdentity,
    previousToken?: string,
  ): Promise<{ token: string; expiresAt: string; maxAgeSeconds: number }>;
  verify(token?: string): Promise<Readonly<VerifiedIdentity> | null>;
  revoke(token?: string, all?: boolean): Promise<void>;
}

/** Selected-provider transport; input, state and session policy remain server-side. */
export class EntraHttp {
  constructor(
    private readonly flow: EntraBrowserFlow,
    private readonly sessions: EntraBrowserSessions,
    private readonly profiles: ProfileRepository,
    private readonly cookies: EntraCookies,
    private readonly telemetry: Telemetry,
    private readonly options: {
      applicationOrigin: string;
      authorityOrigin: string;
    },
    private readonly logoutDestination?: { load(): Promise<string> },
  ) {
    try {
      const app = new URL(options.applicationOrigin);
      const authority = new URL(options.authorityOrigin);
      if (
        app.protocol !== "https:" ||
        app.origin !== options.applicationOrigin ||
        authority.protocol !== "https:" ||
        authority.origin !== options.authorityOrigin ||
        authority.port ||
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ciamlogin\.com$/.test(
          authority.hostname,
        )
      )
        throw Error("origin");
    } catch {
      throw new ConfigurationError(["ENTRA_HTTP_ORIGIN"]);
    }
    this.options = Object.freeze({ ...options });
  }
  private headers() {
    return {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    };
  }
  private redirect(path: "/portal" | "/mfa" | "/login?error=link") {
    return NextResponse.redirect(
      new URL(path, this.options.applicationOrigin),
      { status: 303, headers: this.headers() },
    );
  }
  private failure(status: number, code: string, error: string) {
    return NextResponse.json(
      { error, code },
      { status, headers: this.headers() },
    );
  }
  private preflight(
    request: Request,
    method: "GET" | "POST",
    checkOrigin: boolean,
  ) {
    if (request.method !== method) {
      const response = this.failure(
        405,
        "METHOD_NOT_ALLOWED",
        "This request method is not supported.",
      );
      response.headers.set("Allow", method);
      return response;
    }
    // Next may construct request.url with the internal listener hostname. The
    // ingress must preserve the configured public Host; forwarded-host is not authority.
    const host = request.headers.get("host") ?? new URL(request.url).host;
    if (
      host.toLowerCase() !== new URL(this.options.applicationOrigin).host ||
      (checkOrigin &&
        request.headers.get("origin") !== this.options.applicationOrigin)
    )
      return this.failure(
        403,
        "ORIGIN_DENIED",
        "Request origin is not allowed.",
      );
    return null;
  }
  private async emptyInput(request: Request) {
    if (new URL(request.url).search) throw Error("parameters");
    if (
      request.body &&
      (
        await readBinaryBody(
          request,
          1024,
          AbortSignal.any([request.signal, AbortSignal.timeout(3000)]),
        )
      ).length
    )
      throw Error("parameters");
  }
  async start(request: Request) {
    return this.initiate(request, "login");
  }
  async recover(request: Request) {
    return this.initiate(request, "recovery");
  }
  private async initiate(request: Request, purpose: EntraLoginPurpose) {
    const rejected = this.preflight(request, "POST", true);
    if (rejected) return rejected;
    try {
      const url = new URL(request.url);
      if (
        url.pathname !==
          (purpose === "recovery"
            ? "/auth/entra/recover"
            : "/auth/entra/start") ||
        url.hash
      )
        throw Error("path");
      await this.emptyInput(request);
    } catch {
      return this.failure(
        400,
        "INVALID_AUTH_REQUEST",
        "Start sign-in again without additional parameters.",
      );
    }
    let incoming: ReturnType<EntraCookies["read"]>;
    try {
      incoming = this.cookies.read(request);
    } catch {
      const response = this.failure(
        400,
        "INVALID_AUTH_REQUEST",
        "Start sign-in again without additional parameters.",
      );
      this.cookies.clear(response);
      return response;
    }
    try {
      const result =
        purpose === "recovery"
          ? await this.flow.start(incoming.binding, "recovery")
          : await this.flow.start(incoming.binding);
      const destination = new URL(result.authorizationUrl);
      if (
        destination.origin !== this.options.authorityOrigin ||
        destination.username ||
        destination.password ||
        destination.hash ||
        (purpose === "recovery" &&
          (destination.searchParams.getAll("prompt").length !== 1 ||
            destination.searchParams.get("prompt") !== "login")) ||
        !/^\/[A-Za-z0-9.-]+\/oauth2\/v2\.0\/authorize$/.test(
          destination.pathname,
        )
      )
        throw Error("destination");
      const response = NextResponse.redirect(destination, {
        status: 303,
        headers: this.headers(),
      });
      this.cookies.binding(response, result.browserBinding);
      return response;
    } catch (error) {
      const limited =
        error instanceof AppError && error.code === "RATE_LIMITED";
      return this.failure(
        limited ? 429 : 503,
        limited ? "RATE_LIMITED" : "IDENTITY_UNAVAILABLE",
        limited
          ? "Too many attempts. Please try again later."
          : "Sign-in could not be started. Please try again.",
      );
    }
  }
  async callback(request: Request) {
    const rejected = this.preflight(request, "GET", false);
    if (rejected) return rejected;
    let attemptedSession = false;
    let issued: string | undefined;
    try {
      const url = new URL(request.url);
      if (url.pathname !== "/auth/entra/callback" || url.hash)
        throw Error("callback");
      const incoming = this.cookies.read(request);
      if (!incoming.binding) throw Error("binding");
      const completed = await this.flow.completeFlow(
        url.searchParams,
        incoming.binding,
      );
      if (!["login", "recovery"].includes(completed.purpose))
        throw Error("purpose");
      const identity = completed.identity;
      const profile = await this.profiles.findByIdentity(identity);
      if (
        !profile ||
        profile.status !== "active" ||
        profile.externalSubject !== identity.subject ||
        !["client", "admin"].includes(profile.role)
      )
        throw Error("profile");
      attemptedSession = true;
      const session =
        completed.purpose === "recovery"
          ? await this.sessions.issueRecovery(identity, incoming.session)
          : await this.sessions.issue(identity, incoming.session);
      issued = session.token;
      const response = this.redirect(
        profile.role === "admin" ? "/mfa" : "/portal",
      );
      this.cookies.session(response, session);
      // Retain the short-lived binding cookie for other outstanding browser flows.
      return response;
    } catch {
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
            /* Telemetry cannot prevent a safe callback failure. */
          }
        }
      }
      const response = this.redirect("/login?error=link");
      // An invalid cross-site callback cannot log out an existing browser session.
      if (attemptedSession) this.cookies.clearSession(response);
      return response;
    }
  }
  async logout(request: Request) {
    const rejected = this.preflight(request, "POST", true);
    if (rejected) return rejected;
    try {
      await this.emptyInput(request);
    } catch {
      return this.failure(
        400,
        "INVALID_AUTH_REQUEST",
        "Sign-out requires an empty request.",
      );
    }
    try {
      const incoming = this.cookies.read(request);
      await this.sessions.revoke(incoming.session, true);
      const response = NextResponse.json(
        { redirect: "/login" },
        { headers: this.headers() },
      );
      this.cookies.clear(response);
      return response;
    } catch {
      const response = this.failure(
        503,
        "LOGOUT_UNAVAILABLE",
        "Sign out could not be verified. Please try again.",
      );
      this.cookies.clear(response);
      return response;
    }
  }
  async logoutBrowser(request: Request) {
    const rejected = this.preflight(request, "POST", true);
    if (rejected) return rejected;
    try {
      const url = new URL(request.url);
      if (url.pathname !== "/auth/entra/logout" || url.hash)
        throw Error("path");
      await this.emptyInput(request);
    } catch {
      return this.failure(
        400,
        "INVALID_AUTH_REQUEST",
        "Sign-out requires an empty request.",
      );
    }
    try {
      const incoming = this.cookies.read(request);
      await this.sessions.revoke(incoming.session, true);
    } catch {
      const response = this.failure(
        503,
        "LOGOUT_UNAVAILABLE",
        "Application sign-out could not be verified. Please try again.",
      );
      this.cookies.clear(response);
      return response;
    }
    let response: NextResponse;
    try {
      if (!this.logoutDestination) throw Error("configuration");
      const destination = new URL(await this.logoutDestination.load());
      if (
        destination.origin !== this.options.authorityOrigin ||
        destination.username ||
        destination.password ||
        destination.hash ||
        !/^\/[A-Za-z0-9.-]+\/oauth2\/v2\.0\/logout$/.test(
          destination.pathname,
        ) ||
        [...destination.searchParams.keys()].length !== 1 ||
        destination.searchParams.get("post_logout_redirect_uri") !==
          new URL("/login", this.options.applicationOrigin).href
      )
        throw Error("destination");
      response = NextResponse.redirect(destination, {
        status: 303,
        headers: this.headers(),
      });
    } catch {
      response = NextResponse.json(
        {
          code: "PROVIDER_LOGOUT_UNAVAILABLE",
          error:
            "Your application session ended. Provider sign-out could not be started. Please try again.",
          applicationSignedOut: true,
        },
        { status: 503, headers: this.headers() },
      );
    }
    this.cookies.clear(response);
    return response;
  }
  async verify(request: Pick<Request, "headers">) {
    let incoming: ReturnType<EntraCookies["read"]>;
    try {
      incoming = this.cookies.read(request);
    } catch {
      return null;
    }
    return this.sessions.verify(incoming.session);
  }
}
