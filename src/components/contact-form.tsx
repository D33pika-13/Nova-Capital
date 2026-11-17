"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { contactTopics, type ContactResult } from "@/lib/contact-inputs";
export function ContactForm({ enabled }: { enabled: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const attempt = useRef<Record<string, unknown> | null>(null);
  const active = useRef(false);
  const [working, setWorking] = useState(false);
  const [locked, setLocked] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [result, setResult] = useState<ContactResult | null>(null);
  const [reference, setReference] = useState("");
  async function send(body: Record<string, unknown>) {
    if (active.current) return;
    active.current = true;
    setWorking(true);
    setLocked(true);
    setMessage("");
    setError(false);
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });
      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error(
          "The service response could not be confirmed. Retry the same submission.",
        );
      }
      if (!response.ok) {
        if (response.status === 400 || response.status === 422) {
          setLocked(false);
          attempt.current = null;
        }
        throw new Error(
          data.error ??
            "The enquiry could not be confirmed. Retry the same submission.",
        );
      }
      if (
        !["accepted", "processing", "unknown"].includes(data.status) ||
        data.reference !== body.requestId
      )
        throw new Error(
          "The submission outcome could not be confirmed. Retry the same submission.",
        );
      setResult(data as ContactResult);
      setMessage(data.message);
      setError(data.status === "unknown");
    } catch (cause) {
      setError(true);
      setMessage(
        cause instanceof Error &&
          !["TypeError", "TimeoutError", "AbortError"].includes(cause.name)
          ? cause.message
          : "The enquiry could not be confirmed. Retry the same submission.",
      );
    } finally {
      active.current = false;
      setWorking(false);
    }
  }
  return (
    <form
      ref={form}
      className="form-stack contact-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!enabled || locked || active.current) return;
        const fields = new FormData(event.currentTarget);
        const body = {
          requestId: crypto.randomUUID(),
          name: String(fields.get("name") ?? ""),
          email: String(fields.get("email") ?? ""),
          topic: String(fields.get("topic") ?? ""),
          message: String(fields.get("message") ?? ""),
          consent: fields.get("consent") === "on",
          website: String(fields.get("website") ?? ""),
        };
        attempt.current = body;
        setReference(body.requestId);
        void send(body);
      }}
    >
      {!enabled && (
        <p role="status">
          The contact service is not connected in this environment. No message
          will be sent.
        </p>
      )}
      <fieldset disabled={!enabled || working || locked}>
        <legend>Send a service enquiry</legend>
        <label className="field">
          Your name
          <input name="name" autoComplete="name" maxLength={150} required />
        </label>
        <label className="field">
          Email for a reply
          <input
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
          />
        </label>
        <label className="field">
          Topic
          <select name="topic" defaultValue="general">
            {Object.entries(contactTopics).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Message
          <textarea
            name="message"
            rows={6}
            minLength={10}
            maxLength={5000}
            required
          />
        </label>
        <div className="contact-honeypot" aria-hidden="true">
          <label>
            Leave this field empty
            <input
              name="website"
              tabIndex={-1}
              autoComplete="off"
              maxLength={200}
            />
          </label>
        </div>
        <label className="contact-consent">
          <input name="consent" type="checkbox" required />I permit this message
          and my contact details to be sent to support for a response.
        </label>
        <p className="small muted">
          Read the <Link href="/legal/privacy">privacy information</Link>. This
          form is for service enquiries; do not include passwords or broker
          credentials.
        </p>
        <button
          className="button button-dark"
          disabled={!enabled || working || locked}
        >
          {working ? "Submitting…" : "Send enquiry"}
        </button>
      </fieldset>
      {reference && <p className="small">Submission reference: {reference}</p>}
      {message && <p role={error ? "alert" : "status"}>{message}</p>}
      {enabled && locked && result?.status !== "accepted" && (
        <button
          type="button"
          className="button button-outline"
          disabled={working}
          onClick={() => {
            if (attempt.current) void send(attempt.current);
          }}
        >
          {working
            ? "Checking…"
            : result
              ? "Check submission status"
              : "Retry same submission"}
        </button>
      )}
      {result?.status === "accepted" && (
        <button
          type="button"
          className="button button-outline"
          onClick={() => {
            form.current?.reset();
            attempt.current = null;
            setLocked(false);
            setResult(null);
            setReference("");
            setMessage("");
            setError(false);
          }}
        >
          Start another enquiry
        </button>
      )}
    </form>
  );
}
