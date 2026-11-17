import { requirePageUser } from "@/server/page-auth";
import { MaintenanceButton } from "@/components/maintenance-button";
import { OfferImageForm } from "@/components/offer-image-form";
import { OfferEditor } from "@/components/offer-editor";
export default async function OffersPage() {
  const { services } = await requirePageUser(true);
  const offers = await services.offers.manage();
  return (
    <>
      <p className="eyebrow">CONTENT MANAGEMENT</p>
      <h1>Offers & benefits</h1>
      <p>
        Published offers are public while valid. Saving as draft unpublishes an
        offer. All edits are audited.
      </p>
      <MaintenanceButton />
      <details className="panel">
        <summary>Create offer</summary>
        <OfferEditor />
      </details>
      {offers.length === 0 && <p>No offers created.</p>}
      {offers.map((offer) => (
        <details className="panel" key={`${offer.id}:${offer.version}`}>
          <summary>
            {offer.title} · {offer.status} · version {offer.version}
          </summary>
          <OfferEditor offer={offer} />
          <OfferImageForm
            offer={offer}
            maxBytes={services.config.OFFER_IMAGE_MAX_BYTES}
          />
        </details>
      ))}
    </>
  );
}
