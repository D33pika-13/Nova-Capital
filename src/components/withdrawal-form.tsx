"use client";
import { useRouter } from "next/navigation";
import { supportedCurrencies } from "@/lib/portfolio-inputs";
import { fromUtcInput, toUtcInput } from "@/lib/format";
import type { WithdrawalRecord } from "@/lib/withdrawal-inputs";
import { useSubmission } from "./use-submission";

export function WithdrawalForm({
  clientId,
  original,
}: {
  clientId: string;
  original?: WithdrawalRecord;
}) {
  const router = useRouter();
  const submission = useSubmission();
  const prefix = `withdrawal-${original?.id ?? "new"}`;
  return (
    <form
      className="form-stack"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const result = await submission.submit("/api/admin/withdrawals", {
          clientId,
          currency: original?.currency ?? values.get("currency"),
          amount: values.get("amount"),
          withdrawnAt: fromUtcInput(String(values.get("withdrawnAt"))),
          reference: values.get("reference"),
          correctionOf: original?.id ?? null,
          correctionReason: original ? values.get("correctionReason") : null,
        });
        if (result) {
          submission.newRequest(false);
          if (!original) form.reset();
          router.refresh();
        }
      }}
    >
      <div className="field">
        <label htmlFor={`${prefix}-amount`}>Withdrawal amount</label>
        <input
          id={`${prefix}-amount`}
          name="amount"
          type="number"
          min="0.0001"
          step="0.0001"
          max="9999999999999999.9999"
          defaultValue={original?.amount}
          required
        />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-currency`}>Withdrawal currency</label>
        <select
          id={`${prefix}-currency`}
          name="currency"
          defaultValue={original?.currency ?? "INR"}
          disabled={!!original}
        >
          {supportedCurrencies.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-date`}>Withdrawal date/time (UTC)</label>
        <input
          id={`${prefix}-date`}
          name="withdrawnAt"
          type="datetime-local"
          step="0.001"
          defaultValue={original ? toUtcInput(original.withdrawnAt) : undefined}
          required
        />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-reference`}>
          Withdrawal reference / description
        </label>
        <input
          id={`${prefix}-reference`}
          name="reference"
          maxLength={300}
          defaultValue={original?.reference}
          required
        />
      </div>
      {original && (
        <div className="field">
          <label htmlFor={`${prefix}-reason`}>Correction reason</label>
          <textarea
            id={`${prefix}-reason`}
            name="correctionReason"
            maxLength={1000}
            required
          />
        </div>
      )}
      <p className="small muted">
        Record a completed broker withdrawal. This does not send money.
        Corrections retain the original record.
      </p>
      <button className="button button-dark" disabled={submission.working}>
        {submission.working
          ? "Saving…"
          : original
            ? "Save correction"
            : "Record withdrawal"}
      </button>
      {submission.message && (
        <p
          role="status"
          className={submission.error ? "error-text" : "form-message"}
        >
          {submission.message}
        </p>
      )}
    </form>
  );
}
