import type { ReportRecord } from "@/lib/models";
import { ReportArchiveButton } from "./report-forms";
import { formatDate } from "@/lib/format";
function day(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}
export function ReportList({
  reports,
  admin = false,
  ttlSeconds,
}: {
  reports: ReportRecord[];
  admin?: boolean;
  ttlSeconds: number;
}) {
  return (
    <section id="reports">
      <div className="panel-heading">
        <h2>{admin ? "Client reports" : "Your private reports"}</h2>
        <span className="badge">Private files</span>
      </div>
      <p className="small muted disclosure">
        Downloads require active account access. Issued links expire after{" "}
        {ttlSeconds} seconds; a link issued before suspension or archival may
        remain valid until it expires.
      </p>
      {reports.length ? (
        <div className="table-wrap">
          <table>
            <caption>
              Report dates and reporting periods come from administrator-entered
              metadata.
            </caption>
            <thead>
              <tr>
                <th>Report</th>
                <th>Period</th>
                <th>Report date</th>
                <th>File</th>
                <th>Access</th>
                {admin && <th>Manage</th>}
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id}>
                  <td>
                    <strong>{report.title}</strong>
                    {admin && (
                      <small>
                        {report.status} · Uploaded{" "}
                        {formatDate(report.createdAt)}
                      </small>
                    )}
                  </td>
                  <td>
                    {day(report.periodStart)} – {day(report.periodEnd)}
                  </td>
                  <td>{day(report.reportDate)}</td>
                  <td>
                    {report.fileName}
                    <small>
                      {report.sizeBytes.toLocaleString("en-IN")} bytes
                      {report.pageCount
                        ? ` · ${report.pageCount} ${report.pageCount === 1 ? "page" : "pages"}`
                        : ""}
                    </small>
                  </td>
                  <td>
                    {report.downloadable ? (
                      <a
                        className="text-link"
                        href={`/api/reports/${report.id}/download`}
                        rel="noreferrer"
                      >
                        Download PDF ↓
                      </a>
                    ) : (
                      <span className="muted">Not published</span>
                    )}
                  </td>
                  {admin && (
                    <td>
                      <ReportArchiveButton report={report} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <h3>No reports available</h3>
          <p>
            {admin
              ? "Upload a report for this client. Scanning and storage verification must pass before it is published."
              : "Reports will appear here after they are assigned to your account and published."}
          </p>
        </div>
      )}
    </section>
  );
}
