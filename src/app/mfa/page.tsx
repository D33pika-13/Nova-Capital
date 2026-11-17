import { MfaForm } from "@/components/mfa-form";
import { SelectedLogout } from "@/components/selected-logout";
import { EntraMfaForm } from "@/components/entra-mfa-form";
import { createServices } from "@/server/composition";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function MfaPage() {
  let context, services;
  try {
    services = await createServices();
    context = await services.auth.requireUser({ allowPendingMfa: true });
  } catch {}
  if (!context) redirect("/login");
  const admin = context.profile.role === "admin";
  if (context.assurance === "aal2")
    redirect(admin ? "/admin" : "/portal/security");
  return (
    <section className="auth-shell">
      <div className="auth-card">
        <p className="eyebrow">ACCOUNT SECURITY</p>
        <h1>A second layer of protection.</h1>
        <p>Verify with your authenticator app to protect your account.</p>
        {services?.config.AUTH_PROVIDER === "entra" ? (
          <EntraMfaForm />
        ) : (
          <MfaForm />
        )}
        <div className="auth-links">
          <SelectedLogout
            provider={services?.config.AUTH_PROVIDER ?? "supabase"}
          />
        </div>
      </div>
    </section>
  );
}
