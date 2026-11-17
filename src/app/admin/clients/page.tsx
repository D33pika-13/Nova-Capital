import Link from "next/link";
import { requirePageUser } from "@/server/page-auth";
import { formatDate } from "@/lib/format";
export const dynamic = "force-dynamic";
export default async function ClientList({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = typeof params.query === "string" ? params.query : "";
  const status = typeof params.status === "string" ? params.status : "all";
  const offset = typeof params.offset === "string" ? Number(params.offset) : 0;
  const { services } = await requirePageUser(true);
  const clients = await services.clients.list({ query, status, offset });
  function pageLink(next: number) {
    return `/admin/clients?${new URLSearchParams({ query, status, offset: String(next) })}`;
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">CLIENT MANAGEMENT</p>
          <h1>Clients</h1>
        </div>
        <Link href="/admin/clients/new" className="button button-dark">
          Create client +
        </Link>
      </div>
      <form method="GET" className="filter-form">
        <div className="field">
          <label htmlFor="client-query">Search name, email or client ID</label>
          <input
            id="client-query"
            name="query"
            defaultValue={query}
            maxLength={150}
          />
        </div>
        <div className="field">
          <label htmlFor="filter-status">Status</label>
          <select id="filter-status" name="status" defaultValue={status}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="deactivated">Deactivated</option>
          </select>
        </div>
        <button type="submit" className="button button-dark">
          Search
        </button>
      </form>
      {clients.length ? (
        <div className="table-wrap">
          <table>
            <caption>Client records · up to 50 per page</caption>
            <thead>
              <tr>
                <th>Client</th>
                <th>Email</th>
                <th>Status</th>
                <th>Access</th>
                <th>Created</th>
                <th>Manage</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id}>
                  <td>
                    <strong>{client.displayName}</strong>
                    <small>{client.clientId}</small>
                  </td>
                  <td>{client.email}</td>
                  <td>
                    <span className="badge">{client.status}</span>
                  </td>
                  <td>
                    {client.identityLinked ? "Identity linked" : "Not invited"}
                    <small>
                      {client.invitationStatus
                        ? `Latest email: ${client.invitationStatus}`
                        : "No email request"}
                    </small>
                  </td>
                  <td>{formatDate(client.createdAt)}</td>
                  <td>
                    <Link
                      className="text-link"
                      href={`/admin/clients/${client.id}`}
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <h2>No matching clients</h2>
          <p>Try another search, or create a client record.</p>
        </div>
      )}
      <div className="pagination">
        {offset > 0 && (
          <Link href={pageLink(Math.max(0, offset - 50))}>← Previous 50</Link>
        )}
        {clients.length === 50 && (
          <Link href={pageLink(offset + 50)}>Next 50 →</Link>
        )}
      </div>
    </>
  );
}
