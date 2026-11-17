"use client";
import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import type { ReportRecord } from "@/lib/models";
import { reportMetadataSchema, reportCalendarDay } from "@/lib/report-inputs";
import { Button } from "./ui/button";
import { useSubmission } from "./use-submission";
export function ReportUploadForm({
  clientId,
  maxBytes,
  timeZone,
}: {
  clientId: string;
  maxBytes: number;
  timeZone: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const attempt = useRef<{ fingerprint: string; id: string } | null>(null);
  const { register, handleSubmit, reset } = useForm<{
    title: string;
    periodStart: string;
    periodEnd: string;
    reportDate: string;
  }>();
  async function upload(data: {
    title: string;
    periodStart: string;
    periodEnd: string;
    reportDate: string;
  }) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const file = input.current?.files?.[0];
      if (!file) throw new Error("Select a PDF report.");
      if (file.size > maxBytes)
        throw new Error(`Maximum upload size is ${maxBytes / 1048576} MiB.`);
      const bytes = await file.arrayBuffer();
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      )
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      const fingerprint = JSON.stringify({
        clientId,
        ...data,
        fileName: file.name,
        hash,
      });
      if (attempt.current?.fingerprint !== fingerprint)
        attempt.current = { fingerprint, id: crypto.randomUUID() };
      const metadata = reportMetadataSchema.safeParse({
        ...data,
        fileName: file.name,
        requestId: attempt.current.id,
      });
      if (!metadata.success)
        throw new Error(
          "Check the title, PDF filename and reporting period. The period must end on or before the report date.",
        );
      const response = await fetch(`/api/admin/clients/${clientId}/reports`, {
        method: "POST",
        headers: {
          "Content-Type": "application/pdf",
          "X-Report-Metadata": encodeURIComponent(
            JSON.stringify(metadata.data),
          ),
        },
        body: file,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error ??
            "Upload could not be confirmed. Retry the same file and details to check its status.",
        );
      setMessage(
        "Report published after scanning and original-file verification.",
      );
      reset();
      if (input.current) input.current.value = "";
      attempt.current = null;
      router.refresh();
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "Upload outcome is uncertain. Retry the same file and details to check its status.",
      );
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        void handleSubmit(upload)(event);
      }}
    >
      <fieldset disabled={busy}>
        <div className="field">
          <label htmlFor="report-title">Report title</label>
          <input
            id="report-title"
            required
            maxLength={200}
            {...register("title", { required: true })}
          />
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="report-period-start">Period start</label>
            <input
              id="report-period-start"
              type="date"
              required
              {...register("periodStart", { required: true })}
            />
          </div>
          <div className="field">
            <label htmlFor="report-period-end">Period end</label>
            <input
              id="report-period-end"
              type="date"
              required
              {...register("periodEnd", { required: true })}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="report-date">Report date ({timeZone})</label>
          <input
            id="report-date"
            type="date"
            max={reportCalendarDay(new Date(), timeZone)}
            required
            {...register("reportDate", { required: true })}
          />
        </div>
        <div className="field">
          <label htmlFor="report-file">Original PDF report</label>
          <input
            id="report-file"
            type="file"
            accept="application/pdf,.pdf"
            required
            ref={input}
          />
        </div>
        <p className="small muted">
          Maximum {maxBytes / 1048576} MiB. Password-protected PDFs, scripts and
          embedded attachments are not accepted. The original file is preserved.
          Interrupted uploads remain private; retry the same file and details
          before creating another request.
        </p>
        <Button type="submit">
          {busy ? "Scanning and verifying…" : "Upload private report"}
        </Button>
      </fieldset>
      {message && (
        <p
          role="status"
          className={`form-message ${failed ? "error-text" : "success-text"}`}
        >
          {message}
        </p>
      )}
    </form>
  );
}
export function ReportArchiveButton({ report }: { report: ReportRecord }) {
  const state = useSubmission();
  const router = useRouter();
  if (report.status === "archived") return null;
  return (
    <div>
      <Button
        type="button"
        variant="outline"
        disabled={state.working}
        onClick={async () => {
          if (
            await state.submit(`/api/admin/reports/${report.id}`, {
              expectedStatus: report.status,
            })
          )
            router.refresh();
        }}
      >
        {state.working ? "Archiving…" : "Archive"}
      </Button>
      {state.message && (
        <p className={state.error ? "error-text small" : "small"} role="status">
          {state.message}
        </p>
      )}
    </div>
  );
}
