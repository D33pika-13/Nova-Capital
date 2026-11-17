import { renderToStaticMarkup } from "react-dom/server";
import { it, expect, vi } from "vitest";
import { OfferImageForm } from "@/components/offer-image-form";
import type { Offer } from "@/lib/offer-inputs";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const offer: Offer = {
  id: "synthetic-offer",
  title: "SYNTHETIC offer",
  description: "test",
  category: "member",
  eligibility: "test",
  terms: "test",
  startsAt: "2026-01-01T00:00:00Z",
  endsAt: "2090-01-01T00:00:00Z",
  status: "draft",
  version: 1,
};
it("labels supported inputs and limits and uses a non-optimized authorized image route with escaped alt text", () => {
  const empty = renderToStaticMarkup(
    <OfferImageForm offer={offer} maxBytes={5242880} />,
  );
  expect(empty).toContain("PNG or JPEG image");
  expect(empty).toContain("Image description (alt text)");
  expect(empty).toContain("Maximum 5 MiB");
  expect(empty).not.toContain("Remove image");
  const html = renderToStaticMarkup(
    <OfferImageForm
      offer={{
        ...offer,
        image: {
          id: "synthetic-image",
          width: 80,
          height: 40,
          alt: "<script>fixture</script>",
        },
      }}
      maxBytes={5242880}
    />,
  );
  expect(html).toContain(
    "/api/admin/offers/synthetic-offer/image?version=synthetic-image",
  );
  expect(html).toContain("&lt;script&gt;fixture&lt;/script&gt;");
  expect(html).toContain("Remove image");
  expect(html).not.toContain("/_next/image");
  expect(html).not.toContain("token=");
});
