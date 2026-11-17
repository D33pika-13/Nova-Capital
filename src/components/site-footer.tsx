import Link from "next/link";
import { SocialLinks } from "./social-links";
import { siteConfig } from "@/lib/site-config";
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-top">
          <div>
            <Link className="brand" href="/">
              {siteConfig.name}
              <span className="teal">↗</span>
            </Link>
            <p>A clearer view. A considered approach.</p>
            <SocialLinks />
          </div>
          <nav aria-label="Footer navigation">
            {siteConfig.legalLinks.map((link) => (
              <Link href={link.href} key={link.href}>
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="footer-bottom">
          <p>
            © {new Date().getFullYear()} {siteConfig.name}. Temporary brand ·
            pre-launch website.
          </p>
          <p>
            Investments involve risk. No returns are guaranteed. Portfolio
            information is manually reported and is not a live market feed.
            Client funds remain with their brokers.
          </p>
        </div>
      </div>
    </footer>
  );
}
