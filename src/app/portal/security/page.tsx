import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePageUser } from "@/server/page-auth";
import { AuthForm } from "@/components/auth-form";
import { MfaForm } from "@/components/mfa-form";
export const dynamic = "force-dynamic";
export default async function SecurityPage() {
  const { services, context } = await requirePageUser();
  if (context.profile.role !== "client") redirect("/admin/security");
  const supabase = services.config.AUTH_PROVIDER === "supabase";
  return (
    <section className="container section">
      <Link href="/portal" className="text-link">
        ← Portfolio
      </Link>
      <h1>Account security</h1>
      <div className="admin-form-grid">
        <section className="panel">
          <h2>Change password</h2>
          <p>
            Use a unique password of 12–128 characters. You will be signed out
            after changing it.
          </p>
          {supabase ? (
            <AuthForm mode="change-password" />
          ) : (
            <Link href="/login?mode=reset">
              Continue to secure password recovery
            </Link>
          )}
        </section>
        <section className="panel">
          <h2>Authenticator MFA</h2>
          {supabase ? (
            context.identity.mfaEnrolled ? (
              <p role="status">
                MFA is enabled. Your authenticator code is required after
                password sign-in to access your portfolio and reports.
              </p>
            ) : (
              <>
                <p>
                  Add this account to an authenticator app and verify a code to
                  enable MFA. Subsequent sign-ins require both your password and
                  a code. Keep access to your authenticator; contact support if
                  you lose it.
                </p>
                <MfaForm />
              </>
            )
          ) : (
            <p>
              Contact support about the MFA options supported by your configured
              identity provider.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
