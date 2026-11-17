import Link from "next/link";
import { loadConfig } from "@/server/config";
import { EntraLoginForm } from "@/components/entra-login-form";
import { EntraRecoveryForm } from "@/components/entra-recovery-form";
import { AuthForm } from "@/components/auth-form";
export const dynamic = "force-dynamic";
export const metadata = { title: "Client Login" };
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; error?: string }>;
}) {
  const params = await searchParams;
  const reset = params.mode === "reset";
  const config = await loadConfig(),
    configured = config.SERVICES_ENABLED,
    entra = config.AUTH_PROVIDER === "entra";
  return (
    <section className="auth-shell">
      <div className="auth-card">
        <p className="eyebrow">YOUR PRIVATE CLIENT SPACE</p>
        <h1>{reset ? "Reset your password." : "Welcome back."}</h1>
        <p>
          {reset
            ? entra
              ? "Continue to the identity provider to verify your account and recover your password."
              : "We’ll send a secure link if your address is eligible."
            : "Secure access to your recorded portfolio, updates and reports."}
        </p>
        {params.error && (
          <p className="notice" role="status">
            {entra
              ? "Sign-in could not be completed. Please start again."
              : "This secure link is invalid or expired. Please request a new one."}
          </p>
        )}
        {configured ? (
          entra ? (
            reset ? (
              <EntraRecoveryForm />
            ) : (
              <EntraLoginForm />
            )
          ) : (
            <AuthForm mode={reset ? "reset" : "login"} />
          )
        ) : (
          <div className="notice" role="status">
            Client login is unavailable in this unconfigured local environment.
            No account or financial data is loaded.
          </div>
        )}
        <div className="auth-links">
          <Link href={reset ? "/login" : "/login?mode=reset"}>
            {reset ? "Back to sign in" : "Forgot password?"}
          </Link>
          <Link href="/contact">Contact support</Link>
        </div>
      </div>
    </section>
  );
}
