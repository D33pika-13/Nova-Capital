"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ManagedAnnouncement,
  AnnouncementRecipient,
} from "@/lib/announcement-inputs";
import { useSubmission } from "./use-submission";
type RecipientOption = Pick<
  AnnouncementRecipient,
  "id" | "clientId" | "displayName" | "status"
>;
export function AnnouncementEditor({
  announcement,
  initialClients,
}: {
  announcement?: ManagedAnnouncement;
  initialClients: RecipientOption[];
}) {
  const router = useRouter();
  const submission = useSubmission();
  const [selected, setSelected] = useState<RecipientOption[]>(
    announcement?.recipients ?? [],
  );
  const [status, setStatus] = useState(announcement?.status ?? "draft");
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState(initialClients);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [validation, setValidation] = useState("");
  const requestNumber = useRef(0);
  async function search() {
    const current = ++requestNumber.current;
    setSearching(true);
    setSearchError("");
    try {
      const response = await fetch(
        `/api/admin/clients?query=${encodeURIComponent(query)}`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Client search is unavailable.");
      if (current === requestNumber.current)
        setOptions(result as RecipientOption[]);
    } catch (error) {
      if (current === requestNumber.current)
        setSearchError(
          error instanceof Error
            ? error.message
            : "Client search is unavailable.",
        );
    } finally {
      if (current === requestNumber.current) setSearching(false);
    }
  }
  return (
    <form
      className="form-stack"
      onSubmit={async (event) => {
        event.preventDefault();
        setValidation("");
        if (!selected.length) {
          setValidation("Select at least one client.");
          return;
        }
        const form = event.currentTarget;
        const data = new FormData(form);
        const result = await submission.submit(
          announcement
            ? `/api/admin/announcements/${announcement.id}`
            : "/api/admin/announcements",
          {
            title: data.get("title"),
            body: data.get("body"),
            status,
            clientIds: selected.map((c) => c.id),
            ...(announcement ? { expectedVersion: announcement.version } : {}),
          },
        );
        if (result) {
          submission.newRequest(false);
          if (!announcement) {
            form.reset();
            setSelected([]);
            setStatus("draft");
          }
          router.refresh();
        }
      }}
    >
      <label className="field">
        Title
        <input
          name="title"
          disabled={submission.working}
          defaultValue={announcement?.title}
          required
          maxLength={200}
        />
      </label>
      <label className="field">
        Message
        <textarea
          name="body"
          disabled={submission.working}
          defaultValue={announcement?.body}
          required
          maxLength={5000}
        />
      </label>
      <fieldset disabled={submission.working}>
        <legend>Recipients ({selected.length}/200)</legend>
        <p>
          Only selected clients can see a published notice. Suspended or
          deactivated clients have no access until reactivated. No email is
          sent.
        </p>
        <label className="field">
          Find clients by name, INV ID or email
          <input
            value={query}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void search();
              }
            }}
            maxLength={150}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="button button-outline"
          onClick={search}
          disabled={searching}
        >
          {searching ? "Searching…" : "Search clients"}
        </button>
        {searchError && <p role="alert">{searchError}</p>}
        <p className="small muted">
          Up to 50 matches per search. Refine the search to find another client.
        </p>
        <div className="recipient-options">
          {options.map((client) => (
            <label key={client.id}>
              <input
                type="checkbox"
                checked={selected.some((c) => c.id === client.id)}
                disabled={
                  selected.length >= 200 &&
                  !selected.some((c) => c.id === client.id)
                }
                onChange={(e) => {
                  setSelected((previous) =>
                    e.target.checked
                      ? [...previous, client]
                      : previous.filter((c) => c.id !== client.id),
                  );
                }}
              />
              {client.clientId} · {client.displayName} · {client.status}
            </label>
          ))}
        </div>
        {options.length === 0 && <p>No matching clients.</p>}
        {selected.length > 0 && (
          <>
            <h3>Selected recipients</h3>
            <ul>
              {selected.map((client) => (
                <li key={client.id}>
                  {client.clientId} · {client.displayName}{" "}
                  <button
                    type="button"
                    onClick={() =>
                      setSelected((previous) =>
                        previous.filter((c) => c.id !== client.id),
                      )
                    }
                    aria-label={`Remove ${client.clientId} from recipients`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </fieldset>
      <label className="field">
        Publication status
        <select
          value={status}
          disabled={submission.working}
          onChange={(e) =>
            setStatus(e.target.value as ManagedAnnouncement["status"])
          }
        >
          <option value="draft">Draft / unpublished</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>
      </label>
      <p className="small muted">
        Each saved edit creates a new version and makes the notice unread for
        its recipients. Previous read acknowledgments stay in the audit history.
      </p>
      <button className="button button-dark" disabled={submission.working}>
        {submission.working ? "Saving…" : "Save announcement"}
      </button>
      {validation && <p role="alert">{validation}</p>}
      {submission.message && (
        <p role={submission.error ? "alert" : "status"}>{submission.message}</p>
      )}
    </form>
  );
}
