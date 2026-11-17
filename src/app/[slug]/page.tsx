import { siteConfig } from "@/lib/site-config";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PageIntro } from "@/components/page-intro";
const pages: Record<
  string,
  {
    eyebrow: string;
    title: string;
    intro: string;
    sections: { title: string; text: string }[];
  }
> = {
  about: {
    eyebrow: "OUR APPROACH",
    title: "A considered approach. A clearer relationship.",
    intro: `${siteConfig.name} is a temporary brand for a client reporting and investment-services platform currently in development.`,
    sections: [
      {
        title: "Designed around visibility",
        text: "The platform brings manually recorded investments, dated portfolio snapshots and client reports into a private client space.",
      },
      {
        title: "Funds remain with your broker",
        text: "This website does not receive or custody investment deposits. Any account operation requires a separate authorized arrangement and appropriate legal review.",
      },
    ],
  },
  services: {
    eyebrow: "SERVICES",
    title: "Understand the process. See the details.",
    intro:
      "A private reporting experience across supported markets, with a clear distinction between recorded information and live market data.",
    sections: [
      {
        title: "Portfolio reporting",
        text: "Review administrator-entered investment records and portfolio values with their reporting dates. Information is manually reported, not automatically synchronized from a broker.",
      },
      {
        title: "Private client reports",
        text: "Access reports assigned to your account, with reporting periods and private downloads.",
      },
      {
        title: "Human support",
        text: "Discuss service arrangements with an authorized representative. Automated support explains recorded facts and website processes; it does not provide personalized investment advice.",
      },
    ],
  },
  markets: {
    eyebrow: "MARKETS",
    title: "Different markets. Informed perspective.",
    intro:
      "The platform supports records across four asset classes. Availability depends on your broker, jurisdiction and authorized arrangements.",
    sections: [
      {
        title: "Stocks",
        text: "Shares in publicly traded companies involve market, company and liquidity risks.",
      },
      {
        title: "Forex",
        text: "Currency trading involves exchange-rate risk. Leverage can magnify losses.",
      },
      {
        title: "Commodities",
        text: "Commodity exposures may be affected by supply, demand, geopolitical events and contract structure.",
      },
      {
        title: "Crypto",
        text: "Digital assets may be highly volatile and expose holders to custody, technology, liquidity and regulatory risks.",
      },
    ],
  },
};
export function generateStaticParams() {
  return Object.keys(pages).map((slug) => ({ slug }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return { title: pages[slug]?.eyebrow ?? "Page" };
}
export default async function ContentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = Object.hasOwn(pages, slug) ? pages[slug] : undefined;
  if (!page) notFound();
  return (
    <>
      <PageIntro eyebrow={page.eyebrow} title={page.title}>
        <p>{page.intro}</p>
      </PageIntro>
      <section className="section container">
        <div className="prose">
          {page.sections.map((section) => (
            <article key={section.title}>
              <h2>{section.title}</h2>
              <p>{section.text}</p>
            </article>
          ))}
          <div className="button-row">
            <Link href="/login" className="button button-dark">
              Client Login ↗
            </Link>
            <Link href="/" className="button button-outline">
              Return home
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
