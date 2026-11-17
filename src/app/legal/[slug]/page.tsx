import { notFound } from "next/navigation";
import { PageIntro } from "@/components/page-intro";
const titles: Record<string, string> = {
  privacy: "Privacy policy",
  terms: "Terms and conditions",
  risk: "Risk disclosure",
};
export function generateStaticParams() {
  return Object.keys(titles).map((slug) => ({ slug }));
}
export default async function LegalPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!Object.hasOwn(titles, slug)) notFound();
  return (
    <>
      <PageIntro eyebrow="LEGAL · REVIEW REQUIRED" title={titles[slug]}>
        <p>
          Pre-launch information. Final company policies require qualified
          review before production launch.
        </p>
      </PageIntro>
      <section className="container section prose">
        <div className="notice">
          This page is a review placeholder and does not establish regulatory
          authorization or a finalized policy.
        </div>
        {slug === "privacy" && (
          <>
            <h2>Education requests</h2>
            <p>
              When you submit an education request, we store your name, email
              address, phone or WhatsApp number, selected service, optional
              message and consent time for administrator review and follow-up.
              These details are not public or visible to other clients. Do not
              submit sensitive account information. This staging environment is
              for synthetic test details only; the final company contact and
              retention policy remain subject to review.
            </p>
          </>
        )}
        {slug === "risk" ? (
          <>
            <h2>Investment risk</h2>
            <p>
              Investments can lose value, including all invested capital. No
              returns are guaranteed. Past performance does not guarantee future
              results. Leverage and volatile markets may increase losses.
            </p>
            <h2>Reported information</h2>
            <p>
              Portfolio values are entered manually and reflect their stated
              reporting dates. They are not live broker valuations. Client funds
              remain with their brokers.
            </p>
          </>
        ) : (
          <>
            <h2>Before public launch</h2>
            <p>
              Verified company identity, jurisdiction, service arrangements,
              data handling, retention, user rights and contact details must be
              supplied and reviewed before this document can be finalized.
            </p>
          </>
        )}
      </section>
    </>
  );
}
