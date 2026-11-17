import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/server/page-auth";
import { AppError } from "@/server/errors";
import {
  EditClientForm,
  InvitationForm,
  AdminNoteForm,
} from "@/components/client-forms";
import { InvestmentForm, SnapshotForm } from "@/components/investment-form";
import { ReportList } from "@/components/report-list";
import { ReportUploadForm } from "@/components/report-forms";
import { PortfolioView } from "@/components/portfolio-view";
import { WithdrawalList } from "@/components/withdrawals";
import { WithdrawalForm } from "@/components/withdrawal-form";
import { formatDate } from "@/lib/format";
export default async function ClientDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { services } = await requirePageUser(true);
  let client;
  try {
    client = await services.clients.get(id);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }
  const data = await services.portfolio.adminOverview(id);
  const notes = await services.clients.notes(id);
  const reports = await services.reports.adminList(id);
  return (
    <>
      <Link className="text-link" href="/admin/clients">
        ← Clients
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{client.clientId}</p>
          <h1>{client.displayName}</h1>
          <p className="muted">
            {client.email} · <span className="badge">{client.status}</span>
          </p>
        </div>
      </div>
      <div className="admin-form-grid">
        <section className="panel">
          <h2>Client settings</h2>
          <EditClientForm key={client.updatedAt} client={client} />
        </section>
        <section className="panel">
          <h2>Account invitation / reset</h2>
          <InvitationForm client={client} />
        </section>
      </div>
      <div className="admin-form-grid">
        <details className="panel editor-panel">
          <summary>Add an investment</summary>
          <InvestmentForm clientId={id} />
        </details>
        <details className="panel editor-panel">
          <summary>Add a portfolio snapshot</summary>
          <SnapshotForm clientId={id} />
        </details>
      </div>
      <PortfolioView data={data} adminClientId={id} />
      <details className="panel editor-panel">
        <summary>Record a withdrawal</summary>
        <WithdrawalForm clientId={id} />
      </details>
      <WithdrawalList
        records={await services.withdrawals.adminList(id)}
        adminClientId={id}
      />
      <section className="panel">
        <h2>Upload a private report · {client.clientId}</h2>
        <ReportUploadForm
          clientId={id}
          maxBytes={services.config.UPLOAD_MAX_BYTES}
          timeZone={services.config.REPORT_TIME_ZONE}
        />
      </section>
      <ReportList
        reports={reports}
        admin
        ttlSeconds={services.config.DOWNLOAD_TTL_SECONDS}
      />
      <section className="panel private-notes">
        <h2>Private administrative notes</h2>
        <AdminNoteForm clientId={id} />
        {notes.length > 0 && (
          <ul className="note-list">
            {notes.map((note) => (
              <li key={note.id}>
                <time>{formatDate(note.createdAt)}</time>
                <p>{note.note}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
