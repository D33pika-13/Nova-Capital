import "server-only";
import Image from "next/image";
import Link from "next/link";
import { createServices } from "@/server/composition";
import { loadConfig } from "@/server/config";
import { formatDate } from "@/lib/format";
import type { Offer } from "@/lib/offer-inputs";
/** Server UI entrypoint. Public offers always use the service's anonymous read. */
export async function PublicOffers({
  preview = false,
}: { preview?: boolean } = {}) {
  let offers: Offer[] = [];
  if ((await loadConfig()).SERVICES_ENABLED) {
    try {
      offers = await (await createServices()).offers.current();
    } catch {
      return (
        <p role="status">
          Offers are temporarily unavailable. Please try again later.
        </p>
      );
    }
  }
  if (!offers.length) return <p>No current offers are published.</p>;
  return (
    <div className={preview ? "public-offer-grid" : "prose"}>
      {(preview ? offers.slice(0, 3) : offers).map((offer) => (
        <article
          key={offer.id}
          className={preview ? "panel public-offer-card" : undefined}
        >
          <p className="eyebrow">
            {
              {
                member: "Member benefit",
                promotion: "Promotional offer",
                travel: "Travel offer",
              }[offer.category]
            }
          </p>
          {preview ? <h3>{offer.title}</h3> : <h2>{offer.title}</h2>}
          {!preview && offer.image && (
            <Image
              unoptimized
              src={`/api/offers/${offer.id}/image?version=${offer.image.id}`}
              width={offer.image.width}
              height={offer.image.height}
              alt={offer.image.alt}
              className="offer-image"
            />
          )}
          <p
            className={preview ? "public-offer-description" : undefined}
            style={{ whiteSpace: "pre-wrap" }}
          >
            {offer.description}
          </p>
          <p className="small">
            Valid from{" "}
            <time dateTime={offer.startsAt}>{formatDate(offer.startsAt)}</time>{" "}
            until{" "}
            <time dateTime={offer.endsAt}>{formatDate(offer.endsAt)}</time> (end
            excluded).
          </p>
          {preview ? (
            <Link className="text-link" href="/benefits">
              View full eligibility and terms
            </Link>
          ) : (
            <>
              <h3>Eligibility</h3>
              <p style={{ whiteSpace: "pre-wrap" }}>{offer.eligibility}</p>
              <h3>Terms</h3>
              <p style={{ whiteSpace: "pre-wrap" }}>{offer.terms}</p>
            </>
          )}
        </article>
      ))}
    </div>
  );
}
