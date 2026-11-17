import { PageIntro } from "@/components/page-intro";
import { PublicOffers } from "@/components/public-offers";
export const dynamic = "force-dynamic";
export const metadata = { title: "Member benefits" };
export default async function BenefitsPage() {
  return (
    <>
      <PageIntro
        eyebrow="MEMBER BENEFITS"
        title="More to explore, when available."
      >
        <p>
          Member benefits, promotional offers and travel offers. Check
          eligibility and terms before relying on any offer. Benefits are not
          investment returns or guarantees.
        </p>
      </PageIntro>
      <section className="section container">
        <PublicOffers />
      </section>
    </>
  );
}
