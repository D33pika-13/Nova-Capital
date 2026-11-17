import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { loadConfig } from "@/server/config";
import { contentSecurityPolicy } from "@/server/security-headers";
export async function proxy(request: NextRequest) {
  let config;
  try {
    config = await loadConfig();
  } catch {
    return NextResponse.json(
      { error: "The service is temporarily unavailable.", code: "UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const nonce = randomBytes(24).toString("base64");
  const csp = contentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === "development",
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const protectedPath = /^\/(login|portal|admin|password|mfa|auth)(\/|$)/.test(
    request.nextUrl.pathname,
  );
  if (
    config.SERVICES_ENABLED &&
    config.AUTH_PROVIDER === "supabase" &&
    protectedPath
  ) {
    const client = createServerClient(
      config.SUPABASE_URL!,
      config.SUPABASE_PUBLISHABLE_KEY!,
      {
        cookieOptions: {
          httpOnly: true,
          sameSite: "lax",
          secure: new URL(config.APP_URL).protocol === "https:",
          path: "/",
        },
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: (values) => {
            for (const { name, value } of values)
              request.cookies.set(name, value);
            requestHeaders.set("cookie", request.cookies.toString());
            response = NextResponse.next({
              request: { headers: requestHeaders },
            });
            for (const { name, value, options } of values)
              response.cookies.set(name, value, options);
          },
        },
      },
    );
    await client.auth.getUser();
  }
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  // API handlers refresh their own sessions; skipping proxy avoids buffering file bodies.
  matcher: ["/((?!api(?:/|$)|_next/static|_next/image|favicon.ico).*)"],
};
