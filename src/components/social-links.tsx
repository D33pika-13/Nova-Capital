import { siteConfig } from "@/lib/site-config";
export function SocialLinks({
  links = siteConfig.socialLinks,
}: { links?: readonly { label: string; href: string }[] } = {}) {
  if (!links.length) return null;
  const profiles = links.map((link) => {
    try {
      const url = new URL(link.href);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        !link.label.trim()
      )
        throw Error();
      return { label: link.label.trim(), href: url.href };
    } catch {
      throw Error("Invalid public social link configuration.");
    }
  });
  return (
    <nav aria-label="Social profiles" className="social-links">
      {profiles.map((link, index) => (
        <a
          key={`${link.href}-${index}`}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {link.label}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ))}
    </nav>
  );
}
