"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSubmission } from "./use-submission";
export function MaintenanceButton() {
  const router = useRouter();
  const submission = useSubmission();
  const [outcome, setOutcome] = useState("");
  return (
    <>
      <button
        className="button button-outline"
        disabled={submission.working}
        onClick={async () => {
          setOutcome("");
          const result = await submission.submit<{
            expiredOffers: number;
            mayHaveMore: boolean;
          }>("/api/admin/maintenance", {});
          if (result) {
            setOutcome(
              `${result.expiredOffers} ended published offers expired.${result.mayHaveMore ? " Another batch may remain; run maintenance again." : ""}`,
            );
            submission.newRequest(false);
            router.refresh();
          }
        }}
      >
        {submission.working ? "Running…" : "Expire ended offers"}
      </button>
      {submission.message && (
        <p role={submission.error ? "alert" : "status"}>
          {submission.error ? submission.message : outcome}
        </p>
      )}
    </>
  );
}
