import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/server/page-auth";
import { SnapshotForm } from "@/components/investment-form";
export default async function CorrectSnapshot({
  params,
}: {
  params: Promise<{ id: string; snapshotId: string }>;
}) {
  const { id, snapshotId } = await params;
  const { services } = await requirePageUser(true);
  const data = await services.portfolio.adminOverview(id);
  const snapshot = data.snapshots.find(
    (s) => s.id === snapshotId && !s.superseded,
  );
  if (!snapshot) notFound();
  return (
    <>
      <Link className="text-link" href={`/admin/clients/${id}`}>
        ← Client portfolio
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">APPEND A CORRECTION</p>
          <h1>Correct a snapshot</h1>
          <p className="muted">
            The original remains in history. Client, currency and reporting date
            stay associated with the same observation.
          </p>
        </div>
      </div>
      <section className="panel">
        <SnapshotForm clientId={id} original={snapshot} />
      </section>
    </>
  );
}
