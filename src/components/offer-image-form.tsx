"use client";
import Image from "next/image";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Offer } from "@/lib/offer-inputs";
import { useSubmission } from "./use-submission";
export function OfferImageForm({
  offer,
  maxBytes,
}: {
  offer: Offer;
  maxBytes: number;
}) {
  const router = useRouter();
  const removal = useSubmission();
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const active = useRef(false);
  const attempt = useRef<{ fingerprint: string; id: string } | null>(null);
  return (
    <section>
      <h3>Offer image</h3>
      {offer.image && (
        <Image
          unoptimized
          src={`/api/admin/offers/${offer.id}/image?version=${offer.image.id}`}
          width={offer.image.width}
          height={offer.image.height}
          alt={offer.image.alt}
          className="offer-image"
        />
      )}
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          if (active.current) return;
          const form = event.currentTarget;
          const data = new FormData(form);
          const file = data.get("image");
          if (
            !(file instanceof File) ||
            file.size === 0 ||
            file.size > maxBytes ||
            !["image/png", "image/jpeg"].includes(file.type)
          ) {
            setError(true);
            setMessage("Choose a PNG or JPEG within the displayed size limit.");
            return;
          }
          active.current = true;
          setWorking(true);
          setError(false);
          setMessage("");
          try {
            const digest = Array.from(
              new Uint8Array(
                await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
              ),
              (byte) => byte.toString(16).padStart(2, "0"),
            ).join("");
            const alt = String(data.get("alt") ?? "");
            const fingerprint = JSON.stringify({
              digest,
              alt,
              version: offer.version,
            });
            if (attempt.current?.fingerprint !== fingerprint)
              attempt.current = { fingerprint, id: crypto.randomUUID() };
            const response = await fetch(
              `/api/admin/offers/${offer.id}/image`,
              {
                method: "POST",
                headers: {
                  "Content-Type": file.type,
                  "X-Image-Metadata": encodeURIComponent(
                    JSON.stringify({
                      requestId: attempt.current.id,
                      expectedVersion: offer.version,
                      alt,
                    }),
                  ),
                },
                body: file,
              },
            );
            const result = await response.json();
            if (!response.ok)
              throw new Error(
                result.error ??
                  "Image upload could not be confirmed. Retry the same file and text.",
              );
            attempt.current = null;
            form.reset();
            setMessage(
              result.current
                ? "Image saved."
                : "This upload completed earlier. The offer now has a later image change; refresh to see its current state.",
            );
            router.refresh();
          } catch (cause) {
            setError(true);
            setMessage(
              cause instanceof Error
                ? cause.message
                : "Image upload could not be confirmed. Retry the same submission.",
            );
          } finally {
            active.current = false;
            setWorking(false);
          }
        }}
      >
        <label className="field">
          PNG or JPEG image
          <input
            name="image"
            type="file"
            accept="image/png,image/jpeg"
            required
            disabled={working || removal.working}
          />
        </label>
        <label className="field">
          Image description (alt text)
          <input
            name="alt"
            defaultValue={offer.image?.alt ?? ""}
            maxLength={200}
            required
            disabled={working || removal.working}
          />
        </label>
        <p className="small muted">
          Maximum {Math.round((maxBytes / 1048576) * 10) / 10} MiB, 4096 pixels
          per side. Non-animated PNG/JPEG only. Images are scanned, metadata is
          removed, and display copies are resized to at most 1600 pixels. Save
          text edits before uploading; any concurrent change requires a refresh.
        </p>
        <button
          className="button button-dark"
          disabled={working || removal.working}
        >
          {working
            ? "Processing image…"
            : offer.image
              ? "Replace image"
              : "Upload image"}
        </button>
        {message && <p role={error ? "alert" : "status"}>{message}</p>}
      </form>
      {offer.image && (
        <button
          className="button button-outline"
          disabled={working || removal.working}
          onClick={async () => {
            const result = await removal.submit(
              `/api/admin/offers/${offer.id}/image/remove`,
              { expectedVersion: offer.version },
            );
            if (result) router.refresh();
          }}
        >
          Remove image
        </button>
      )}
      {removal.message && (
        <p role={removal.error ? "alert" : "status"}>{removal.message}</p>
      )}
    </section>
  );
}
