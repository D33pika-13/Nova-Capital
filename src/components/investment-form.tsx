"use client";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import type { InvestmentRecord, PortfolioSnapshot } from "@/lib/models";
import { supportedCurrencies, assetClasses } from "@/lib/portfolio-inputs";
import { toUtcInput, fromUtcInput } from "@/lib/format";
import { useSubmission } from "./use-submission";
import { Button } from "./ui/button";
const moneyRules = {
  required: true,
  pattern: /^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,4})?$/,
};
export function InvestmentForm({
  clientId,
  record,
}: {
  clientId: string;
  record?: InvestmentRecord;
}) {
  const router = useRouter();
  const state = useSubmission();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    defaultValues: {
      assetClass: record?.assetClass ?? "stocks",
      description: record?.description ?? "",
      currency: record?.currency ?? "INR",
      investedAmount: record?.investedAmount ?? "",
      reportedValue: record?.reportedValue ?? "",
      reportedAt: record ? toUtcInput(record.reportedAt) : "",
      correctionReason: "",
    },
  });
  return (
    <form
      className="form-stack"
      onSubmit={handleSubmit(async (data) => {
        const body = {
          assetClass: data.assetClass,
          description: data.description,
          investedAmount: data.investedAmount,
          reportedValue: data.reportedValue,
          reportedAt: fromUtcInput(data.reportedAt),
          ...(record
            ? {
                expectedVersion: record.version,
                correctionReason: data.correctionReason,
              }
            : { clientId, currency: data.currency }),
        };
        if (
          await state.submit(
            record
              ? `/api/admin/clients/${clientId}/investments/${record.id}`
              : "/api/admin/investments",
            body,
            record ? "PATCH" : "POST",
          )
        ) {
          if (record) router.push(`/admin/clients/${clientId}`);
          else {
            state.newRequest(false);
            reset();
          }
          router.refresh();
        }
      })}
    >
      <fieldset disabled={state.working}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="investment-asset">Asset class</label>
            <select id="investment-asset" {...register("assetClass")}>
              {assetClasses.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="investment-currency">Valuation currency</label>
            <select
              id="investment-currency"
              disabled={!!record}
              {...register("currency")}
            >
              {supportedCurrencies.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="investment-description">Investment description</label>
          <input
            id="investment-description"
            required
            maxLength={500}
            {...register("description", { required: true, maxLength: 500 })}
          />
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="investment-basis">Amount invested</label>
            <input
              id="investment-basis"
              required
              inputMode="decimal"
              {...register("investedAmount", moneyRules)}
              aria-invalid={!!errors.investedAmount}
            />
          </div>
          <div className="field">
            <label htmlFor="investment-value">Current reported value</label>
            <input
              id="investment-value"
              required
              inputMode="decimal"
              {...register("reportedValue", moneyRules)}
              aria-invalid={!!errors.reportedValue}
            />
          </div>
        </div>
        {(errors.investedAmount || errors.reportedValue) && (
          <p className="error-text small">
            Use nonnegative amounts with up to four decimal places and no
            separators.
          </p>
        )}
        <div className="field">
          <label htmlFor="investment-date">Reporting date/time (UTC)</label>
          <input
            id="investment-date"
            required
            type="datetime-local"
            step="0.001"
            {...register("reportedAt", { required: true })}
          />
        </div>
        {record && (
          <div className="field">
            <label htmlFor="investment-reason">
              Correction reason (shown in client history)
            </label>
            <textarea
              id="investment-reason"
              required
              maxLength={1000}
              {...register("correctionReason", {
                required: true,
                maxLength: 1000,
              })}
            />
          </div>
        )}
        <p className="small muted">
          Manually reported values only. Recording a holding does not execute a
          trade or update the portfolio snapshot automatically.
        </p>
        <Button type="submit">
          {state.working
            ? "Saving…"
            : record
              ? "Save correction"
              : "Add investment"}
        </Button>
      </fieldset>
      {state.message && (
        <p
          role="status"
          className={`form-message ${state.error ? "error-text" : "success-text"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
export function ArchiveInvestmentForm({
  record,
}: {
  record: InvestmentRecord;
}) {
  const router = useRouter();
  const state = useSubmission();
  const { register, handleSubmit } = useForm<{ reason: string }>();
  return (
    <form
      className="form-stack"
      onSubmit={handleSubmit(async (data) => {
        if (
          await state.submit(
            `/api/admin/clients/${record.clientId}/investments/${record.id}/archive`,
            { reason: data.reason, expectedVersion: record.version },
          )
        ) {
          router.push(`/admin/clients/${record.clientId}`);
          router.refresh();
        }
      })}
    >
      <fieldset disabled={state.working}>
        <div className="field">
          <label htmlFor="archive-reason">
            Archival reason (shown in client history)
          </label>
          <textarea
            id="archive-reason"
            required
            maxLength={1000}
            {...register("reason", { required: true, maxLength: 1000 })}
          />
        </div>
        <p className="small muted">
          Archiving removes this holding from active allocation. Its records and
          revisions remain available. Archived holdings cannot be edited.
        </p>
        <Button type="submit" variant="outline">
          {state.working ? "Archiving…" : "Archive investment"}
        </Button>
      </fieldset>
      {state.message && (
        <p
          role="status"
          className={`form-message ${state.error ? "error-text" : "success-text"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
export function SnapshotForm({
  clientId,
  original,
}: {
  clientId: string;
  original?: PortfolioSnapshot;
}) {
  const router = useRouter();
  const state = useSubmission();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    defaultValues: {
      currency: original?.currency ?? "INR",
      adjustedBasis: original?.adjustedBasis ?? "",
      reportedValue: original?.reportedValue ?? "",
      reportedAt: original ? toUtcInput(original.reportedAt) : "",
      basisExplanation: original?.basisExplanation ?? "",
      correctionReason: "",
    },
  });
  return (
    <form
      className="form-stack"
      onSubmit={handleSubmit(async (data) => {
        const body = {
          clientId,
          currency: original?.currency ?? data.currency,
          adjustedBasis: data.adjustedBasis.trim() || null,
          reportedValue: data.reportedValue,
          reportedAt: original?.reportedAt ?? fromUtcInput(data.reportedAt),
          basisExplanation: data.basisExplanation,
          ...(original
            ? {
                correctionOf: original.id,
                correctionReason: data.correctionReason,
              }
            : {}),
        };
        if (await state.submit("/api/admin/snapshots", body)) {
          if (original) router.push(`/admin/clients/${clientId}`);
          else {
            state.newRequest(false);
            reset();
          }
          router.refresh();
        }
      })}
    >
      <fieldset disabled={state.working}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="snapshot-currency">Currency</label>
            <select
              id="snapshot-currency"
              {...register("currency")}
              disabled={!!original}
            >
              {supportedCurrencies.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="snapshot-date">Reporting date/time (UTC)</label>
            <input
              id="snapshot-date"
              required
              type="datetime-local"
              step="0.001"
              readOnly={!!original}
              {...register("reportedAt", { required: true })}
            />
          </div>
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="snapshot-basis">
              Adjusted cost basis (optional)
            </label>
            <input
              id="snapshot-basis"
              inputMode="decimal"
              {...register("adjustedBasis", {
                pattern: /^$|^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,4})?$/,
              })}
            />
          </div>
          <div className="field">
            <label htmlFor="snapshot-value">Reported portfolio value</label>
            <input
              id="snapshot-value"
              required
              inputMode="decimal"
              {...register("reportedValue", moneyRules)}
            />
          </div>
        </div>
        {(errors.adjustedBasis || errors.reportedValue) && (
          <p className="small error-text">
            Use nonnegative amounts with up to four decimal places.
          </p>
        )}
        <div className="field">
          <label htmlFor="snapshot-basis-explanation">
            Basis and cash-flow explanation
          </label>
          <textarea
            id="snapshot-basis-explanation"
            required
            maxLength={1000}
            {...register("basisExplanation", {
              required: true,
              maxLength: 1000,
            })}
          />
        </div>
        {original && (
          <div className="field">
            <label htmlFor="snapshot-reason">
              Correction reason (shown in client history)
            </label>
            <textarea
              id="snapshot-reason"
              required
              maxLength={1000}
              {...register("correctionReason", {
                required: true,
                maxLength: 1000,
              })}
            />
          </div>
        )}
        <p className="small muted">
          Return = (reported value − adjusted cost basis) ÷ adjusted cost basis
          × 100. Explain contributions/withdrawals in the basis. This is a
          simple, non-annualized return. Missing or zero basis produces no
          percentage. Currencies remain separate.
        </p>
        <Button type="submit">
          {state.working
            ? "Saving…"
            : original
              ? "Append correction"
              : "Add dated snapshot"}
        </Button>
      </fieldset>
      {state.message && (
        <p
          role="status"
          className={`form-message ${state.error ? "error-text" : "success-text"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
