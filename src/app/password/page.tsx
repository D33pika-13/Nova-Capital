import { AuthForm } from "@/components/auth-form";
import { loadConfig } from "@/server/config";
import { createServices } from "@/server/composition";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function PasswordPage() {
  if ((await loadConfig()).AUTH_PROVIDER === "entra")
    redirect("/login?mode=reset");
  let identity;
  try {
    identity = await (await createServices()).identity.verify();
  } catch {}
  if (!identity) redirect("/login?error=link");
  if (identity.mfaEnrolled && identity.assurance !== "aal2") redirect("/mfa");
  return (
    <section className="auth-shell">
      <div className="auth-card">
        <p className="eyebrow">SECURE ACCOUNT SETUP</p>
        <h1>Set your password.</h1>
        <p>
          Use a unique password of 12–128 characters. Never use your broker
          password.
        </p>
        <AuthForm mode="password" />
      </div>
    </section>
  );
}
