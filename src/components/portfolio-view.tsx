import Link from "next/link";
import type { PortfolioView as View } from "@/lib/models";
import { formatMoney, formatDate } from "@/lib/format";
import { PortfolioChart } from "./portfolio-chart";
export function PortfolioView({
  data,
  adminClientId,
}: {
  data: View;
  adminClientId?: string;
}) {
  return (
    <div className="portfolio-view">
      <section id="overview">
        <div className="panel-heading">
          <h2>Portfolio overview</h2>
        </div>

        <p className="small muted disclosure">
          {data.lastRecordedAt
            ? `Latest portfolio record added: ${formatDate(data.lastRecordedAt)}`
            : "No portfolio update has been recorded."}
        </p>
        {data.summaries.length ? (
          <div className="summary-grid">
            {data.summaries.map((s) => (
              <article className="panel" key={s.currency}>
                <p className="eyebrow">{s.currency} · REPORTED PORTFOLIO</p>
                <h3 className="portfolio-value">
                  {formatMoney(s.reportedValue, s.currency)}
                </h3>
                <dl className="record-details">
                  <div>
                    <dt>Adjusted cost basis</dt>
                    <dd>{formatMoney(s.adjustedBasis, s.currency)}</dd>
                  </div>
                  <div>
                    <dt>Net profit / loss</dt>
                    <dd>{formatMoney(s.profitLoss, s.currency)}</dd>
                  </div>
                  <div>
                    <dt>Simple reported return</dt>
                    <dd>
                      {s.returnPercent === null
                        ? "Not calculable"
                        : `${s.returnPercent}%`}
                    </dd>
                  </div>
                  <div>
                    <dt>Reporting date</dt>
                    <dd>{formatDate(s.reportedAt)}</dd>
                  </div>
                </dl>
                <p className="small muted">Basis: {s.basisExplanation}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <h3>No portfolio snapshot recorded</h3>
            <p>
              No portfolio balance or return is inferred from missing records.
            </p>
          </div>
        )}
      </section>
      <section className="panel">
        <PortfolioChart snapshots={data.snapshots} />
      </section>
      <section id="holdings">
        <div className="panel-heading">
          <h2>Investment records</h2>
          <span className="small muted">Individual reporting dates apply</span>
        </div>
        {data.holdingTotals.length > 0 && (
          <div className="holding-totals">
            {data.holdingTotals.map((t) => (
              <p key={t.currency}>
                <strong>{t.currency}</strong> · Active recorded investment:{" "}
                {formatMoney(t.investedAmount, t.currency)} · Active holding
                values: {formatMoney(t.reportedValue, t.currency)}
              </p>
            ))}
          </div>
        )}
        {data.investments.length ? (
          <div className="table-wrap">
            <table>
              <caption>
                Recorded holdings, including archived records. P/L uses each
                holding’s recorded invested amount.
              </caption>
              <thead>
                <tr>
                  <th>Investment</th>
                  <th>Asset / status</th>
                  <th>Amount invested</th>
                  <th>Reported value</th>
                  <th>Profit / loss</th>
                  <th>Reported at</th>
                  {adminClientId && <th>Manage</th>}
                </tr>
              </thead>
              <tbody>
                {data.investments.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.description}
                      <small>Version {i.version}</small>
                    </td>
                    <td>
                      {i.assetClass}
                      <small>{i.archivedAt ? "Archived" : "Active"}</small>
                    </td>
                    <td>{formatMoney(i.investedAmount, i.currency)}</td>
                    <td>{formatMoney(i.reportedValue, i.currency)}</td>
                    <td>{formatMoney(i.profitLoss ?? null, i.currency)}</td>
                    <td>{formatDate(i.reportedAt)}</td>
                    {adminClientId && (
                      <td>
                        {i.archivedAt ? (
                          <span className="muted">History retained</span>
                        ) : (
                          <Link
                            className="text-link"
                            href={`/admin/clients/${adminClientId}/investments/${i.id}`}
                          >
                            Edit / archive
                          </Link>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <p>No investment records have been entered.</p>
          </div>
        )}
      </section>
      <section id="allocation" className="panel">
        <h2>Recorded asset allocation</h2>
        <p className="small muted">
          Based on active holding values at their individual reporting dates.
          This breakdown may differ from the dated portfolio snapshot.
        </p>
        {data.allocation.length ? (
          <div className="allocation-grid">
            {data.allocation.map((a) => (
              <div
                className="allocation-row"
                key={`${a.currency}:${a.assetClass}`}
              >
                <div>
                  <strong>{a.assetClass}</strong>
                  <span>
                    {formatMoney(a.reportedValue, a.currency)} ·{" "}
                    {a.sharePercent === null
                      ? "No percentage"
                      : `${a.sharePercent}%`}
                  </span>
                </div>
                <div className="allocation-track" aria-hidden="true">
                  <span style={{ width: `${a.sharePercent ?? 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No active holdings are recorded.</p>
        )}
      </section>
      <section id="history">
        <div className="panel-heading">
          <h2>Portfolio snapshot history</h2>
          <span className="small muted">Previous versions are retained</span>
        </div>
        {data.snapshots.length ? (
          <div className="table-wrap">
            <table>
              <caption>
                All recorded portfolio snapshots and corrections.
              </caption>
              <thead>
                <tr>
                  <th>Reporting date</th>
                  <th>Reported value</th>
                  <th>Adjusted basis</th>
                  <th>Record</th>
                  <th>Basis / correction</th>
                  {adminClientId && <th>Manage</th>}
                </tr>
              </thead>
              <tbody>
                {data.snapshots.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {formatDate(s.reportedAt)}
                      <small>Recorded {formatDate(s.createdAt)}</small>
                    </td>
                    <td>{formatMoney(s.reportedValue, s.currency)}</td>
                    <td>{formatMoney(s.adjustedBasis, s.currency)}</td>
                    <td>
                      <span className="badge">
                        {s.superseded
                          ? "Superseded"
                          : s.correctionOf
                            ? "Effective correction"
                            : "Effective"}
                      </span>
                    </td>
                    <td>
                      {s.basisExplanation}
                      {s.correctionReason && (
                        <small>{s.correctionReason}</small>
                      )}
                    </td>
                    {adminClientId && (
                      <td>
                        {!s.superseded && (
                          <Link
                            className="text-link"
                            href={`/admin/clients/${adminClientId}/snapshots/${s.id}`}
                          >
                            Correct
                          </Link>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <p>No snapshots have been recorded.</p>
          </div>
        )}
      </section>
      <section id="revisions">
        <div className="panel-heading">
          <h2>Investment update history</h2>
        </div>
        {data.revisions.length ? (
          <div className="table-wrap">
            <table>
              <caption>
                Append-only history of investment entries, corrections and
                archival.
              </caption>
              <thead>
                <tr>
                  <th>Recorded at</th>
                  <th>Investment / version</th>
                  <th>Invested / value</th>
                  <th>Reported at</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.revisions.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDate(r.recordedAt)}</td>
                    <td>
                      {r.description}
                      <small>
                        Version {r.version} ·{" "}
                        {r.archivedAt ? "Archived" : r.assetClass}
                      </small>
                    </td>
                    <td>
                      {formatMoney(r.investedAmount, r.currency)}
                      <small>{formatMoney(r.reportedValue, r.currency)}</small>
                    </td>
                    <td>{formatDate(r.reportedAt)}</td>
                    <td>{r.correctionReason ?? "Initial entry"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No investment updates yet.</p>
        )}
      </section>
    </div>
  );
}
