import Link from "next/link";
import { SelectedLogout } from "@/components/selected-logout";
import { requirePageUser } from "@/server/page-auth";
import { ReportList } from "@/components/report-list";
export const dynamic = "force-dynamic";
export default async function Reports() {
  const { services, context } = await requirePageUser();
  if (context.profile.role === "admin")
    return (
      <section className="container section">
        <h1>Client account required</h1>
        <p>
          You are signed in as an administrator. Private reports belong to
          individual client accounts. Sign out, then sign in with your client
          test account to view its reports.
        </p>
        <SelectedLogout provider={services.config.AUTH_PROVIDER} />
        <Link href="/login">Client sign in</Link>
      </section>
    );
  return (
    <section className="container section">
      <Link className="text-link" href="/portal">
        ← Portfolio
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{context.profile.clientId}</p>
          <h1>Private reports</h1>
        </div>
      </div>
      <ReportList
        reports={await services.reports.clientList()}
        ttlSeconds={services.config.DOWNLOAD_TTL_SECONDS}
      />
    </section>
  );
}
