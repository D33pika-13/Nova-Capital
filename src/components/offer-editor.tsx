"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Offer } from "@/lib/offer-inputs";
import { useSubmission } from "./use-submission";
export function OfferEditor({ offer }: { offer?: Offer }) {
  const router = useRouter();
  const submission = useSubmission();
  const [status, setStatus] = useState(offer?.status ?? "draft");
  return (
    <form
      className="form-stack"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const result = await submission.submit(
          offer ? `/api/admin/offers/${offer.id}` : "/api/admin/offers",
          {
            title: data.get("title"),
            description: data.get("description"),
            category: data.get("category"),
            eligibility: data.get("eligibility"),
            terms: data.get("terms"),
            status,
            startsAt: new Date(
              String(data.get("startsAt")) + "Z",
            ).toISOString(),
            endsAt: new Date(String(data.get("endsAt")) + "Z").toISOString(),
            ...(offer ? { expectedVersion: offer.version } : {}),
          },
        );
        if (result) {
          if (!offer) {
            form.reset();
            setStatus("draft");
          }
          submission.newRequest(false);
          router.refresh();
          if (!offer) router.push("/admin/offers");
        }
      }}
    >
      <label className="field">
        Title
        <input
          name="title"
          defaultValue={offer?.title}
          maxLength={200}
          required
        />
      </label>
      <label className="field">
        Category
        <select name="category" defaultValue={offer?.category ?? "member"}>
          <option value="member">Member benefit</option>
          <option value="promotion">Promotion</option>
          <option value="travel">Travel</option>
        </select>
      </label>
      <label className="field">
        Description
        <textarea
          name="description"
          defaultValue={offer?.description}
          maxLength={5000}
          required
        />
      </label>
      <label className="field">
        Eligibility
        <textarea
          name="eligibility"
          defaultValue={offer?.eligibility}
          maxLength={5000}
          required
        />
      </label>
      <label className="field">
        Terms
        <textarea
          name="terms"
          defaultValue={offer?.terms}
          maxLength={10000}
          required
        />
      </label>
      <p>
        Enter validity in UTC. Offers appear from the start instant until, but
        excluding, the end instant. Publishing a future offer schedules its
        visibility.
      </p>
      <label className="field">
        Starts at (UTC)
        <input
          type="datetime-local"
          step="0.001"
          name="startsAt"
          defaultValue={offer?.startsAt.slice(0, 23)}
          required
        />
      </label>
      <label className="field">
        Ends at (UTC)
        <input
          type="datetime-local"
          step="0.001"
          name="endsAt"
          defaultValue={offer?.endsAt.slice(0, 23)}
          required
        />
      </label>
      <label className="field">
        Publication status
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as Offer["status"])}
        >
          <option value="draft">Draft / unpublished</option>
          <option value="published">Published</option>
          <option value="expired">Expired</option>
        </select>
      </label>
      <button className="button button-dark" disabled={submission.working}>
        {submission.working ? "Saving…" : "Save offer"}
      </button>
      {submission.message && (
        <p role={submission.error ? "alert" : "status"}>{submission.message}</p>
      )}
    </form>
  );
}
