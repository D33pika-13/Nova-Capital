"use client";
import { useState } from "react";
import { supportedCurrencies } from "@/lib/portfolio-inputs";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import type { PortfolioSnapshot } from "@/lib/models";
import { formatMoney, formatDate } from "@/lib/format";
export function PortfolioChart({
  snapshots,
}: {
  snapshots: PortfolioSnapshot[];
}) {
  const recordedCurrencies = [
    ...new Set(snapshots.filter((s) => !s.superseded).map((s) => s.currency)),
  ].sort();
  const currencies = [
    ...new Set([...supportedCurrencies, ...recordedCurrencies]),
  ];
  const [currency, setCurrency] = useState(recordedCurrencies[0] ?? "USD");
  const data = snapshots
    .filter((s) => !s.superseded && s.currency === currency)
    .sort(
      (a, b) =>
        new Date(a.reportedAt).getTime() - new Date(b.reportedAt).getTime(),
    )
    .slice(-100)
    .map((s) => ({
      date: new Date(s.reportedAt).getTime(),
      value: Number(s.reportedValue),
      exact: s.reportedValue,
      currency: s.currency,
    }));
  return (
    <div>
      <div className="chart-toolbar">
        <h3>Reported portfolio value</h3>
        <div className="field">
          <label htmlFor="chart-currency" className="small">
            Chart currency
          </label>
          <select
            id="chart-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>
      {!data.length ? (
        <div className="empty-state" role="status">
          <h3>No {currency} snapshots recorded</h3>
          <p>
            Select a currency with recorded history, or ask your team about a
            dated update. No conversion or balance is inferred.
          </p>
        </div>
      ) : (
        <div
          className="chart-container"
          role="img"
          aria-label={`Reported ${currency} portfolio values from ${data.length} stored snapshots. Exact values are listed in snapshot history.`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 15, right: 20, bottom: 5, left: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#dde5e2" />
              <XAxis
                dataKey="date"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(value) =>
                  new Intl.DateTimeFormat("en-GB", {
                    day: "numeric",
                    month: "short",
                    timeZone: "UTC",
                  }).format(new Date(value))
                }
                tick={{ fontSize: 10 }}
              />
              <YAxis
                tickFormatter={(value) =>
                  new Intl.NumberFormat("en", { notation: "compact" }).format(
                    value,
                  )
                }
                tick={{ fontSize: 10 }}
              />
              <Tooltip
                labelFormatter={(label) =>
                  formatDate(new Date(Number(label)).toISOString())
                }
                formatter={(_value, _name, item) => {
                  const point = item.payload as {
                    exact: string;
                    currency: string;
                  };
                  return [
                    formatMoney(point.exact, point.currency),
                    "Reported value",
                  ];
                }}
              />
              <Line
                type="linear"
                dataKey="value"
                stroke="#16786a"
                strokeWidth={2}
                dot={{ r: 3 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="small muted">
        Latest 100 effective snapshots in {currency}; full history below. Lines
        connect reported points, not live prices. Chart positions are
        approximate; tables retain the recorded precision.
      </p>
    </div>
  );
}
