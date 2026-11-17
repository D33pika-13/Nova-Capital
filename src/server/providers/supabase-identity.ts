import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { IdentityProvider, VerifiedIdentity } from "@/server/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServerConfig } from "@/server/config";
import { AppError } from "@/server/errors";
export async function createSessionClient(config: Readonly<ServerConfig>) {
  const store = await cookies();
  return createServerClient(
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
        getAll: () => store.getAll(),
        setAll: (values) => {
          try {
            for (const { name, value, options } of values)
              store.set(name, value, options);
          } catch {
            /* Server components cannot set cookies; proxy handles refresh. */
          }
        },
      },
    },
  );
}
export class SupabaseIdentityProvider implements IdentityProvider {
  constructor(
    private readonly client: SupabaseClient,
    private readonly appUrl: string,
  ) {}
  async verify(): Promise<VerifiedIdentity | null> {
    const {
      data: { user },
      error,
    } = await this.client.auth.getUser();
    if (error || !user) return null;
    const claims = await this.client.auth.getClaims();
    if (claims.error || claims.data?.claims.sub !== user.id) return null;
    return {
      mfaEnrolled:
        user.factors?.some((factor) => factor.status === "verified") ?? false,
      subject: user.id,
      provider: "supabase",
      assurance: claims.data.claims.aal === "aal2" ? "aal2" : "aal1",
    };
  }
  async signIn(email: string, password: string) {
    const { error } = await this.client.auth.signInWithPassword({
      email,
      password,
    });
    if (error)
      throw new AppError(
        "INVALID_LOGIN",
        "The email or password is incorrect.",
        401,
      );
  }
  async signOut() {
    const { error } = await this.client.auth.signOut({ scope: "global" });
    if (error)
      throw new AppError(
        "LOGOUT_FAILED",
        "Sign out could not be completed. Please try again.",
        503,
      );
  }
  async setPassword(password: string) {
    const { error } = await this.client.auth.updateUser({ password });
    if (error)
      throw new AppError(
        "PASSWORD_FAILED",
        "Password could not be updated. Request a new secure link.",
        400,
      );
  }
  async requestReset(email: string) {
    const { error } = await this.client.auth.resetPasswordForEmail(email, {
      redirectTo: new URL(
        "/auth/callback?next=/password",
        this.appUrl,
      ).toString(),
    });
    if (error)
      throw new AppError(
        "RESET_UNAVAILABLE",
        "Password reset is temporarily unavailable.",
        503,
      );
  }
}
