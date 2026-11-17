import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/server/page-auth";
import {
  InvestmentForm,
  ArchiveInvestmentForm,
} from "@/components/investment-form";
export default async function EditInvestment({
  params,
}: {
  params: Promise<{ id: string; investmentId: string }>;
}) {
  const { id, investmentId } = await params;
  const { services } = await requirePageUser(true);
  const data = await services.portfolio.adminOverview(id);
  const investment = data.investments.find((i) => i.id === investmentId);
  if (!investment || investment.archivedAt) notFound();
  return (
    <>
      <Link className="text-link" href={`/admin/clients/${id}`}>
        ← Client portfolio
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            INVESTMENT CORRECTION · VERSION {investment.version}
          </p>
          <h1>Edit investment</h1>
        </div>
      </div>
      <section className="panel">
        <InvestmentForm
          key={investment.version}
          clientId={id}
          record={investment}
        />
      </section>
      <section className="panel">
        <h2>Archive this investment</h2>
        <ArchiveInvestmentForm record={investment} />
      </section>
    </>
  );
}
