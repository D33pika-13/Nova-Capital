import Link from "next/link";
import { requirePageUser } from "@/server/page-auth";
import { WithdrawalList } from "@/components/withdrawals";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function WithdrawalsPage() {
  const { services, context } = await requirePageUser();
  if (context.profile.role !== "client") redirect("/admin");
  return (
    <section className="container section">
      <Link href="/portal" className="text-link">
        ← Portfolio
      </Link>
      <h1>Your withdrawals</h1>
      <WithdrawalList records={await services.withdrawals.clientList()} />
    </section>
  );
}
