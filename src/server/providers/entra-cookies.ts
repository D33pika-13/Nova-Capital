import "server-only";
import type { NextResponse } from "next/server";
import { AppError } from "../errors";

export const entraCookieNames = Object.freeze({
  session: "__Host-nova-entra-session",
  binding: "__Host-nova-entra-binding",
});
const opaque = /^[A-Za-z0-9_-]{43}$/;

/** Route-response cookie transport. Never use this adapter for middleware. */
export class EntraCookies {
  read(request: Pick<Request, "headers">): {
    session?: string;
    binding?: string;
  } {
    const header = request.headers.get("cookie") ?? "";
    if (header.length > 16384) throw this.invalid();
    const values: { session?: string; binding?: string } = {};
    for (const piece of header.split(";")) {
      const index = piece.indexOf("=");
      const name = (index < 0 ? piece : piece.slice(0, index)).trim();
      const key =
        name === entraCookieNames.session
          ? "session"
          : name === entraCookieNames.binding
            ? "binding"
            : null;
      if (!key) continue;
      const value = index < 0 ? "" : piece.slice(index + 1).trim();
      if (values[key] !== undefined || !opaque.test(value))
        throw this.invalid();
      values[key] = value;
    }
    return values;
  }
  private invalid() {
    return new AppError(
      "INVALID_AUTH_COOKIE",
      "Sign-in cookies could not be verified. Start sign-in again.",
      400,
    );
  }
  private set(
    response: NextResponse,
    name: string,
    value: string,
    maxAge: number,
  ) {
    response.cookies.set(name, value, {
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      priority: "high",
      maxAge,
    });
    // NextResponse mirrors cookie values for middleware coordination. A route
    // response needs only Set-Cookie; never expose the internal mirror header.
    response.headers.delete("x-middleware-set-cookie");
  }
  binding(response: NextResponse, value: string) {
    if (!opaque.test(value)) throw this.invalid();
    this.set(response, entraCookieNames.binding, value, 600);
  }
  session(
    response: NextResponse,
    value: { token: string; expiresAt: string; maxAgeSeconds: number },
  ) {
    const remaining = Math.floor(
      (Date.parse(value.expiresAt) - Date.now()) / 1000,
    );
    const maxAge = Math.min(28800, value.maxAgeSeconds, remaining);
    if (!opaque.test(value.token) || !Number.isInteger(maxAge) || maxAge <= 0)
      throw this.invalid();
    this.set(response, entraCookieNames.session, value.token, maxAge);
  }
  clearSession(response: NextResponse) {
    this.set(response, entraCookieNames.session, "", 0);
  }
  clear(response: NextResponse) {
    this.clearSession(response);
    this.set(response, entraCookieNames.binding, "", 0);
  }
}
