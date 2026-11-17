import { requirePageUser } from "@/server/page-auth";
export const dynamic = "force-dynamic";
const labels = {
  never: "No scheduled batch recorded",
  failed: "The last scheduled batch failed",
  stale: "Scheduled maintenance is overdue",
  backlog: "A recent batch completed; offer backlog remains",
  current: "A recent scheduled batch completed",
};
export default async function OperationsPage() {
  const { services } = await requirePageUser(true);
  const status = await services.maintenance.status();
  return (
    <>
      <p className="eyebrow">OPERATIONS</p>
      <h1>Scheduled maintenance</h1>
      <div className="panel">
        <h2>{labels[status.state]}</h2>
        <p>
          This records committed database batches. It does not confirm hosted
          job execution, email delivery, file backups or overall service
          availability.
        </p>
        <dl>
          <dt>Observed at (database clock)</dt>
          <dd>{status.observedAt}</dd>
          <dt>Recovery boundary</dt>
          <dd>
            {status.recoveryBoundaryAt ?? "No recovery boundary recorded"}
          </dd>
          <dt>Offers expired in the last scheduled batch</dt>
          <dd>{status.lastScheduledExpiredOffers ?? "Not confirmed"}</dd>
          <dt>Last scheduled completion</dt>
          <dd>
            {status.lastScheduledSuccessAt ??
              "No successful scheduled batch recorded"}
          </dd>
          <dt>Last scheduled outcome</dt>
          <dd>{status.lastScheduledOutcome ?? "None recorded"}</dd>
          <dt>Last manual batch</dt>
          <dd>{status.lastAdminFinishedAt ?? "None recorded"}</dd>
          <dt>Overdue after</dt>
          <dd>
            {status.staleAfterSeconds} seconds without a scheduled completion
          </dd>
        </dl>
        <p>
          Manual batches do not establish scheduler freshness. A new scheduled
          batch is required after a recorded restore quarantine. Review the
          scheduler when overdue; resolve failures before treating it as
          current.
        </p>
      </div>
    </>
  );
}
