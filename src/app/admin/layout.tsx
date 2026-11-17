import Link from "next/link";
import { requirePageUser } from "@/server/page-auth";
import { SelectedLogout } from "@/components/selected-logout";
export const dynamic = "force-dynamic";
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { context, services } = await requirePageUser(true);
  return (
    <section className="workspace container">
      <aside className="workspace-sidebar">
        <p className="eyebrow">ADMINISTRATION</p>
        <strong>{context.profile.displayName}</strong>
        <span className="badge">MFA verified</span>
        <nav aria-label="Administrator navigation">
          <Link href="/admin">Overview</Link>
          <Link href="/admin/clients">Clients & portfolios</Link>
          <Link href="/admin/announcements">Announcements</Link>
          <Link href="/admin/offers">Offers & benefits</Link>
          <Link href="/admin/education">Education requests</Link>
          <Link href="/admin/operations">Operations</Link>
          {services.config.AUTH_PROVIDER === "entra" && (
            <Link href="/admin/security">Account security</Link>
          )}
          <Link href="/">Public website ↗</Link>
        </nav>
        <SelectedLogout provider={services.config.AUTH_PROVIDER} />
      </aside>
      <div className="workspace-content">{children}</div>
    </section>
  );
}
