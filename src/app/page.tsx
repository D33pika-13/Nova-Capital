import Link from "next/link";
import {
  ArrowUpRight,
  ArrowRight,
  Layers3,
  ShieldCheck,
  FileChartColumnIncreasing,
  CircleDollarSign,
  Globe2,
  Gem,
  Bitcoin,
  Check,
} from "lucide-react";
import { siteConfig } from "@/lib/site-config";
import { FaqList } from "@/components/faq-list";
import { PublicOffers } from "@/components/public-offers";
const markets = [
  {
    icon: CircleDollarSign,
    title: "Stocks",
    text: "Ownership in public companies.",
  },
  { icon: Globe2, title: "Forex", text: "Global currency markets." },
  { icon: Gem, title: "Commodities", text: "Resources and precious metals." },
  { icon: Bitcoin, title: "Crypto", text: "Digital asset markets." },
];
export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="status-dot" /> INVESTING, WITH PERSPECTIVE
            </p>
            <h1>
              Your Investments.
              <br />
              <span>Your Growth.</span>
            </h1>
            <p className="hero-description">
              A considered approach to investing.
              <br />A clearer view of where you stand.
            </p>
            <p className="hero-detail">
              Explore our approach across global markets, with private portfolio
              reporting and your funds held in your own broker account.
            </p>
            <div className="button-row">
              <Link href="/login" className="button button-dark">
                Client Login <ArrowUpRight size={18} />
              </Link>
              <Link href="/services" className="button button-outline">
                Explore Services <ArrowRight size={18} />
              </Link>
            </div>
            <div className="hero-note">
              <ShieldCheck size={17} />
              <span>Your account. Your broker. Your visibility.</span>
            </div>
          </div>
          <div
            className="perspective-art"
            aria-label="Illustration of a considered investment approach"
          >
            <div className="art-grid" />
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <div className="art-orbit orbit-three" />
            <div className="art-centre">
              <span>{siteConfig.monogram}</span>
              <ArrowUpRight size={60} />
            </div>
            <div className="art-label label-top">
              <span className="status-dot" /> A connected perspective
            </div>
            <div className="art-card card-bottom">
              <span className="art-card-icon">
                <Layers3 size={23} />
              </span>
              <div>
                <strong>Clarity across markets</strong>
                <small>One private reporting space</small>
              </div>
              <ArrowUpRight size={19} />
            </div>
            <span className="art-caption">
              CONCEPTUAL ILLUSTRATION · NOT PERFORMANCE DATA
            </span>
          </div>
        </div>
      </section>
      <div className="principle-strip">
        <div className="container principle-inner">
          <span>Built around what matters</span>
          <p>
            <Check size={16} /> Broker-held funds
          </p>
          <p>
            <Check size={16} /> Dated portfolio updates
          </p>
          <p>
            <Check size={16} /> Private client reporting
          </p>
        </div>
      </div>
      <section className="section container" id="approach">
        <div className="section-heading">
          <div>
            <p className="eyebrow">A CLEARER APPROACH</p>
            <h2>
              Perspective first.
              <br />
              Every step of the way.
            </h2>
          </div>
          <p>
            Understand the process, see the recorded details, and stay informed
            through a dedicated client portal.
          </p>
        </div>
        <div className="feature-grid">
          {[
            {
              icon: ShieldCheck,
              number: "01",
              title: "Your funds stay yours",
              text: "Client funds remain in their own broker accounts. This website does not accept investment deposits.",
            },
            {
              icon: Layers3,
              number: "02",
              title: "A view across markets",
              text: "Stocks, forex, commodities and crypto, with each recorded holding clearly identified.",
            },
            {
              icon: FileChartColumnIncreasing,
              number: "03",
              title: "Reporting with context",
              text: "Manually reported updates, historical snapshots and private reports, with dates and calculation details.",
            },
          ].map((item) => (
            <article className="feature-card" key={item.title}>
              <div className="feature-card-top">
                <item.icon size={26} />
                <span>{item.number}</span>
              </div>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="markets-section">
        <div className="container">
          <div className="section-heading">
            <div>
              <p className="eyebrow">THE MARKETS</p>
              <h2>
                Four markets.
                <br />A broader perspective.
              </h2>
            </div>
            <Link href="/markets" className="text-link">
              Explore markets <ArrowUpRight size={18} />
            </Link>
          </div>
          <div className="market-grid">
            {markets.map((m) => (
              <Link href="/markets" className="market-card" key={m.title}>
                <m.icon size={31} />
                <h3>{m.title}</h3>
                <p>{m.text}</p>
                <ArrowUpRight size={18} />
              </Link>
            ))}
          </div>
          <p className="small muted">
            Market availability depends on the client’s broker and authorized
            arrangement. All asset classes involve risk.
          </p>
        </div>
      </section>
      <section className="section container">
        <div className="section-heading">
          <div>
            <p className="eyebrow">HOW IT WORKS</p>
            <h2>
              From introduction
              <br />
              to informed oversight.
            </h2>
          </div>
        </div>
        <ol className="steps">
          <li>
            <span>01</span>
            <h3>Start a conversation</h3>
            <p>
              Discuss the service, eligibility and relevant arrangements with a
              human representative.
            </p>
          </li>
          <li>
            <span>02</span>
            <h3>Access your portal</h3>
            <p>
              Use your invitation to set up secure access to your own client
              account.
            </p>
          </li>
          <li>
            <span>03</span>
            <h3>Stay informed</h3>
            <p>
              Review dated portfolio updates, reporting history and documents in
              one place.
            </p>
          </li>
        </ol>
      </section>
      <section
        className="section container"
        aria-labelledby="home-benefits-title"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">MEMBER BENEFITS</p>
            <h2 id="home-benefits-title">More to explore.</h2>
          </div>
          <Link href="/benefits" className="text-link">
            View all benefits <ArrowUpRight size={18} />
          </Link>
        </div>
        <p className="muted">
          Member benefits, promotional offers and travel offers, when published.
          Check eligibility and terms. Benefits are not investment returns or
          guarantees.
        </p>
        <PublicOffers preview />
      </section>
      <section className="faq-section">
        <div className="container faq-grid">
          <div>
            <p className="eyebrow">GOOD TO KNOW</p>
            <h2>
              Clarity starts
              <br />
              with questions.
            </h2>
            <p>
              <Link href="/faq" className="text-link">
                Read all FAQs
              </Link>
            </p>
            <Link href="/contact" className="text-link">
              Get in touch <ArrowUpRight size={18} />
            </Link>
          </div>
          <FaqList />
        </div>
      </section>
      <section className="section container">
        <div className="cta-panel">
          <div>
            <p className="eyebrow">YOUR NEXT STEP</p>
            <h2>A clearer view starts here.</h2>
            <p>
              Explore the approach, or sign in to your private client space.
            </p>
          </div>
          <Link href="/contact" className="button button-light">
            Let’s talk <ArrowUpRight size={18} />
          </Link>
        </div>
      </section>
    </>
  );
}
