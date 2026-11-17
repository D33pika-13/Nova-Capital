import Link from "next/link";
import { PageIntro } from "@/components/page-intro";
import { FaqList } from "@/components/faq-list";
export const metadata = { title: "Frequently asked questions" };
export default function FaqPage() {
  return (
    <>
      <PageIntro
        eyebrow="FREQUENTLY ASKED QUESTIONS"
        title="Clear answers. A better starting point."
      >
        <p>
          How account access, manually reported updates and private reports
          work.
        </p>
      </PageIntro>
      <section className="section container">
        <FaqList />
        <p className="small muted">
          For account-specific help, sign in to your private client space or{" "}
          <Link className="text-link" href="/contact">
            contact support
          </Link>
          . Do not share passwords or broker credentials.
        </p>
      </section>
    </>
  );
}
