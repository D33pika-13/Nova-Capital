"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import {
  educationServices,
  educationConfirmation,
} from "@/lib/education-inputs";
export function EducationForm({
  service,
  enabled,
}: {
  service: string;
  enabled: boolean;
}) {
  const active = useRef(false);
  const attempt = useRef<Record<string, unknown> | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const [locked, setLocked] = useState(false);
  async function send(body: Record<string, unknown>) {
    if (active.current) return;
    active.current = true;
    setWorking(true);
    setLocked(true);
    setError("");
    try {
      const response = await fetch("/api/education/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 400 || response.status === 422) {
          attempt.current = null;
          setLocked(false);
        }
        throw new Error(
          data.error ??
            "Your request could not be confirmed. Retry the same request.",
        );
      }
      if (data.status !== "received" || data.reference !== body.requestId)
        throw new Error(
          "Your request could not be confirmed. Retry the same request.",
        );
      setReference(data.reference);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.name === "Error"
          ? cause.message
          : "Your request could not be confirmed. Retry the same request.",
      );
    } finally {
      active.current = false;
      setWorking(false);
    }
  }
  if (reference)
    return (
      <div role="status" className="education-confirmation">
        <h2>Request received</h2>
        <p>{educationConfirmation}</p>
        <p className="small">Reference: {reference}</p>
      </div>
    );
  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (!enabled || active.current || locked) return;
        const fields = new FormData(event.currentTarget);
        const body = {
          requestId: crypto.randomUUID(),
          name: String(fields.get("name") ?? ""),
          email: String(fields.get("email") ?? ""),
          phone: String(fields.get("phone") ?? ""),
          service: String(fields.get("service") ?? ""),
          message: String(fields.get("message") ?? ""),
          consent: fields.get("consent") === "on",
          website: String(fields.get("website") ?? ""),
        };
        attempt.current = body;
        void send(body);
      }}
    >
      {!enabled && (
        <p role="status">
          Education requests are not connected in this environment.
        </p>
      )}
      <fieldset disabled={!enabled || locked || working}>
        <legend>Request information</legend>
        <label className="field">
          Full Name
          <input name="name" autoComplete="name" maxLength={150} required />
        </label>
        <label className="field">
          Email Address
          <input
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
          />
        </label>
        <label className="field">
          Phone Number / WhatsApp Number
          <input
            name="phone"
            type="tel"
            autoComplete="tel"
            minLength={7}
            maxLength={30}
            required
            aria-describedby="education-phone-hint"
          />
          <span id="education-phone-hint" className="small muted">
            Include your country code, for example +44 7700 900123.
          </span>
        </label>
        <label className="field">
          Preferred Service
          <select name="service" defaultValue={service} required>
            <option value="" disabled>
              Select a service
            </option>
            {Object.entries(educationServices).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Message or Query (Optional)
          <textarea name="message" rows={5} maxLength={3000} />
        </label>
        <div className="contact-honeypot" aria-hidden="true">
          <label>
            Leave this field empty
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        <label className="contact-consent">
          <input type="checkbox" name="consent" required />I agree that the team
          may store these details and contact me about this education request.
        </label>
        <p className="small muted">
          Read the <Link href="/legal/privacy">privacy information</Link>. Do
          not include passwords, identity documents or financial account
          details.
        </p>
        <button
          className="button button-dark"
          disabled={!enabled || working || locked}
        >
          {working ? "Submitting…" : "Submit request"}
        </button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {locked && !working && error && (
        <button
          type="button"
          className="button button-outline"
          onClick={() => {
            if (attempt.current) void send(attempt.current);
          }}
        >
          Retry same request
        </button>
      )}
    </form>
  );
}
