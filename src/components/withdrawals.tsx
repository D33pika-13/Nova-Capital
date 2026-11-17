import type { WithdrawalRecord } from "@/lib/withdrawal-inputs";
import { formatDate, formatMoney } from "@/lib/format";
import { WithdrawalForm } from "./withdrawal-form";

export function WithdrawalList({
  records,
  adminClientId,
}: {
  records: WithdrawalRecord[];
  adminClientId?: string;
}) {
  return (
    <section className="panel" id="withdrawals">
      <h2>Withdrawal history</h2>
      <p className="small muted">
        Recorded withdrawals from your broker account. Dates are shown in UTC.
        This website does not hold funds or execute withdrawals. Amounts stay in
        their original currency; these records do not automatically change
        portfolio snapshots or returns.
      </p>
      {!records.length ? (
        <p>No withdrawals recorded.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">
              Withdrawal amounts and dates, including correction history
            </caption>
            <thead>
              <tr>
                <th scope="col">Withdrawn on</th>
                <th scope="col">Amount</th>
                <th scope="col">Reference</th>
                <th scope="col">Record</th>
                {adminClientId && <th scope="col">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>
                    <time dateTime={record.withdrawnAt}>
                      {formatDate(record.withdrawnAt)}
                    </time>
                  </td>
                  <td>{formatMoney(record.amount, record.currency)}</td>
                  <td>{record.reference}</td>
                  <td>
                    {record.superseded
                      ? "Superseded"
                      : record.correctionOf
                        ? "Corrected"
                        : "Recorded"}
                    {record.correctionReason && (
                      <p className="small">{record.correctionReason}</p>
                    )}
                  </td>
                  {adminClientId && (
                    <td>
                      {!record.superseded && (
                        <details>
                          <summary>Correct withdrawal</summary>
                          <WithdrawalForm
                            clientId={adminClientId}
                            original={record}
                          />
                        </details>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
