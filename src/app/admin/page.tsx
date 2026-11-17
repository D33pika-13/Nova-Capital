import Link from "next/link";
import { requirePageUser } from "@/server/page-auth";
import { formatDate } from "@/lib/format";
export const dynamic = "force-dynamic";
export default async function Admin() {
  const { services } = await requirePageUser(true);
  const data = await services.clients.metrics();
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">OVERVIEW</p>
          <h1>Administration</h1>
          <p className="muted">
            Client records, reporting activity and account oversight.
          </p>
        </div>
        <Link className="button button-dark" href="/admin/clients/new">
          Create client +
        </Link>
      </div>
      <div className="metric-grid">
        {[
          { label: "Total clients", value: data.totalClients },
          { label: "Active clients", value: data.activeClients },
          { label: "Investment records", value: data.investmentRecords },
        ].map((m) => (
          <article className="panel metric" key={m.label}>
            <p>{m.label}</p>
            <strong>{m.value}</strong>
          </article>
        ))}
      </div>
      <section className="panel">
        <h2>Latest administrative activity</h2>
        {data.latestActivity.length ? (
          <ul className="activity-list">
            {data.latestActivity.map((event, index) => (
              <li key={`${event.createdAt}-${index}`}>
                <strong>
                  {event.action} · {event.entity.replaceAll("_", " ")}
                </strong>
                <time>{formatDate(event.createdAt)}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No administrative activity is recorded.</p>
        )}
      </section>
    </>
  );
}
