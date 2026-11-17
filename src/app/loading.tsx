import { siteConfig } from "@/lib/site-config";
export default function Loading() {
  return (
    <section className="container section" role="status" aria-live="polite">
      <p className="eyebrow">{siteConfig.name}</p>
      <h2>Loading your view…</h2>
    </section>
  );
}
