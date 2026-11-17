import { notFound } from "next/navigation";
import { requirePageUser } from "@/server/page-auth";
import { EntraMfaManagementForm } from "@/components/entra-mfa-form";
export const dynamic = "force-dynamic";
export default async function SecurityPage() {
  const { services } = await requirePageUser(true);
  if (services.config.AUTH_PROVIDER !== "entra") notFound();
  return (
    <div className="auth-card">
      <p className="eyebrow">ADMINISTRATOR SECURITY</p>
      <h1>Manage your authenticator</h1>
      <EntraMfaManagementForm action="regenerate" />
      <EntraMfaManagementForm action="remove" />
    </div>
  );
}
