import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePageUser } from "@/server/page-auth";
import { SelectedLogout } from "@/components/selected-logout";
import { PortfolioView } from "@/components/portfolio-view";
export const dynamic = "force-dynamic";
export default async function Portal() {
  const { context, services } = await requirePageUser();
  if (context.profile.role === "admin")
    redirect(context.assurance === "aal2" ? "/admin" : "/mfa");
  const data = await services.portfolio.clientOverview();
  return (
    <section className="workspace container">
      <aside className="workspace-sidebar">
        <p className="eyebrow">PRIVATE CLIENT SPACE</p>
        <strong>{context.profile.displayName}</strong>
        <p className="small muted">{context.profile.clientId}</p>
        <span className="badge">{context.profile.status}</span>
        <nav aria-label="Client portfolio navigation">
          <a href="#overview">Overview</a>
          <a href="#holdings">Investment records</a>
          <a href="#allocation">Asset allocation</a>
          <a href="#history">Snapshot history</a>
          <a href="#revisions">Investment updates</a>
          <Link href="/portal/announcements">Announcements</Link>
          <Link href="/benefits">Offers & benefits</Link>
          <Link href="/portal/reports">Private reports</Link>
          <Link href="/portal/withdrawals">Withdrawal history</Link>
          <Link href="/portal/security">Account security</Link>
        </nav>
        <SelectedLogout provider={services.config.AUTH_PROVIDER} />
      </aside>
      <div className="workspace-content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">YOUR PORTFOLIO</p>
            <h1>A clearer view.</h1>
            <p className="muted">
              Reported information, with dates and a record of each update.
            </p>
          </div>
        </div>
        <PortfolioView data={data} />
      </div>
    </section>
  );
}
