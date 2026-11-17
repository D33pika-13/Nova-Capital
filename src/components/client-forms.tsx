"use client";
import { useForm } from "react-hook-form";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientRecord } from "@/lib/models";
import { useSubmission } from "./use-submission";
import { Button } from "./ui/button";
function Feedback({ state }: { state: { message: string; error: boolean } }) {
  return state.message ? (
    <p
      role="status"
      className={`form-message ${state.error ? "error-text" : "success-text"}`}
    >
      {state.message}
    </p>
  ) : null;
}
export function CreateClientForm() {
  const router = useRouter();
  const state = useSubmission();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<{ displayName: string; email: string; clientId: string }>();
  return (
    <form
      onSubmit={handleSubmit(async (data) => {
        const result = await state.submit<ClientRecord>("/api/admin/clients", {
          displayName: data.displayName.trim(),
          email: data.email.trim(),
          ...(data.clientId.trim() ? { clientId: data.clientId.trim() } : {}),
        });
        if (result) router.push(`/admin/clients/${result.id}`);
      })}
      className="form-stack"
    >
      <fieldset disabled={state.working}>
        <div className="field">
          <label htmlFor="display-name">Client name</label>
          <input
            id="display-name"
            required
            maxLength={150}
            {...register("displayName", { required: true, maxLength: 150 })}
          />
          {errors.displayName && (
            <span className="error-text">Enter a name.</span>
          )}
        </div>
        <div className="field">
          <label htmlFor="client-email">Email address</label>
          <input
            id="client-email"
            type="email"
            required
            maxLength={254}
            {...register("email", { required: true, maxLength: 254 })}
          />
        </div>
        <div className="field">
          <label htmlFor="client-number">Client ID (optional)</label>
          <input
            id="client-number"
            placeholder="Assigned automatically when blank"
            {...register("clientId", { pattern: /^$|^INV-[0-9]{4,12}$/ })}
          />
          {errors.clientId && (
            <span className="error-text">
              Use INV- followed by 4–12 digits.
            </span>
          )}
        </div>
        <p className="small muted">
          Creating a record does not send an invitation. Client ID and login
          email are fixed after creation; changes to login identity require an
          operator review.
        </p>
        <Button type="submit">
          {state.working ? "Creating…" : "Create client"}
        </Button>
      </fieldset>
      <Feedback state={state} />
    </form>
  );
}
export function EditClientForm({ client }: { client: ClientRecord }) {
  const router = useRouter();
  const state = useSubmission();
  const { register, handleSubmit } = useForm({
    defaultValues: { displayName: client.displayName, status: client.status },
  });
  return (
    <form
      onSubmit={handleSubmit(async (data) => {
        const result = await state.submit(
          `/api/admin/clients/${client.id}`,
          { ...data, expectedUpdatedAt: client.updatedAt },
          "PATCH",
        );
        if (result) router.refresh();
      })}
      className="form-stack"
    >
      <fieldset disabled={state.working}>
        <div className="field">
          <label htmlFor="edit-client-name">Client name</label>
          <input
            id="edit-client-name"
            required
            maxLength={150}
            {...register("displayName", { required: true, maxLength: 150 })}
          />
        </div>
        <div className="field">
          <label htmlFor="client-status">Account status</label>
          <select id="client-status" {...register("status")}>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="deactivated">Deactivated</option>
          </select>
        </div>
        <p className="small muted">
          Suspension and deactivation block subsequent protected requests.
          Financial history is retained.
        </p>
        <Button type="submit">
          {state.working ? "Saving…" : "Save client"}
        </Button>
      </fieldset>
      <Feedback state={state} />
    </form>
  );
}
export function InvitationForm({ client }: { client: ClientRecord }) {
  const router = useRouter();
  const state = useSubmission();
  const [purpose, setPurpose] = useState("setup");
  const [ack, setAck] = useState(false);
  return (
    <form
      className="form-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const result = await state.submit(
          `/api/admin/clients/${client.id}/invitations`,
          { purpose, acknowledgeDuplicateRisk: ack },
        );
        if (result) router.refresh();
      }}
    >
      <fieldset disabled={state.working || client.status !== "active"}>
        <p className="small muted">
          Recipient: {client.email}. Latest request:{" "}
          {client.invitationStatus ?? "none"}. Email-service acceptance does not
          confirm inbox delivery.
        </p>
        <div className="field">
          <label htmlFor="invitation-purpose">Secure email</label>
          <select
            id="invitation-purpose"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          >
            <option value="setup">Account setup link</option>
            <option value="reset" disabled={!client.identityLinked}>
              Password reset link
            </option>
          </select>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
          />
          I checked the inbox. I accept that retrying an uncertain request may
          send another message.
        </label>
        <div className="button-row">
          <Button type="submit">
            {state.working ? "Processing…" : "Send secure email"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              state.newRequest();
              setAck(false);
            }}
          >
            Start a new request
          </Button>
        </div>
      </fieldset>
      {client.status !== "active" && (
        <p className="notice">
          Activate this client to send a setup or reset email.
        </p>
      )}
      <Feedback state={state} />
    </form>
  );
}
export function AdminNoteForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const state = useSubmission();
  const { register, handleSubmit, reset } = useForm<{ note: string }>();
  return (
    <form
      className="form-stack"
      onSubmit={handleSubmit(async (data) => {
        if (await state.submit(`/api/admin/clients/${clientId}/notes`, data)) {
          state.newRequest(false);
          reset();
          router.refresh();
        }
      })}
    >
      <fieldset disabled={state.working}>
        <div className="field">
          <label htmlFor="admin-note">Private administrative note</label>
          <textarea
            id="admin-note"
            required
            maxLength={5000}
            {...register("note", { required: true, maxLength: 5000 })}
          />
        </div>
        <p className="small muted">
          Visible only to administrators. Do not record passwords or trading
          credentials.
        </p>
        <Button type="submit">{state.working ? "Saving…" : "Add note"}</Button>
      </fieldset>
      <Feedback state={state} />
    </form>
  );
}
