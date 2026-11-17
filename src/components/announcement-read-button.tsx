"use client";
import { useRouter } from "next/navigation";
import { useSubmission } from "./use-submission";
export function AnnouncementReadButton({
  id,
  version,
}: {
  id: string;
  version: number;
}) {
  const router = useRouter();
  const submission = useSubmission();
  return (
    <>
      <button
        className="button button-outline"
        disabled={submission.working}
        onClick={async () => {
          const result = await submission.submit(
            `/api/portal/announcements/${id}/read`,
            { expectedVersion: version },
          );
          if (result) router.refresh();
        }}
      >
        {submission.working ? "Saving…" : "Mark as read"}
      </button>
      {submission.message && (
        <p role={submission.error ? "alert" : "status"}>{submission.message}</p>
      )}
    </>
  );
}
