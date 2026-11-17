import "server-only";
import type { IdentityProvider, VerifiedIdentity } from "../contracts";
import type { EntraBrowserSessions } from "../entra-http";
import { AppError } from "../errors";
import type { EntraCookies } from "./entra-cookies";

/** Immutable request snapshot. Never share this instance between requests. */
export class EntraIdentityProvider implements IdentityProvider {
  private readonly request: { headers: Headers };
  constructor(
    request: Pick<Request, "headers">,
    private readonly sessions: Pick<EntraBrowserSessions, "verify">,
    private readonly cookies: EntraCookies,
  ) {
    this.request = { headers: new Headers(request.headers) };
  }
  async verify(): Promise<Readonly<VerifiedIdentity> | null> {
    let token: string | undefined;
    try {
      token = this.cookies.read(this.request).session;
    } catch {
      return null;
    }
    return this.sessions.verify(token);
  }
  async signIn(email: string, password: string): Promise<void> {
    // Credentials are intentionally neither inspected nor forwarded to Microsoft.
    void email;
    void password;
    throw new AppError(
      "BROWSER_SIGN_IN_REQUIRED",
      "Continue with the secure sign-in page.",
      400,
    );
  }
  async signOut(): Promise<void> {
    // The HTTP boundary must revoke and clear cookies together; do not claim a
    // completed sign-out from a headless IdentityProvider call.
    throw new AppError(
      "BROWSER_SIGN_OUT_REQUIRED",
      "Use the sign-out action to end this session.",
      400,
    );
  }
  async requestReset(email: string): Promise<void> {
    void email;
    throw new AppError(
      "ACCOUNT_LIFECYCLE_UNAVAILABLE",
      "Account recovery is not available for this identity provider.",
      503,
    );
  }
  async setPassword(password: string): Promise<void> {
    void password;
    throw new AppError(
      "ACCOUNT_LIFECYCLE_UNAVAILABLE",
      "Password changes are not available through this application.",
      503,
    );
  }
}
