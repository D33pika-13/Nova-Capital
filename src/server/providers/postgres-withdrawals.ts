import "server-only";
import type { Database } from "@/server/database";
import type { AuthorizedContext } from "@/server/modules/identity/authorization-service";
import type { WithdrawalRepository } from "@/server/modules/portfolio/withdrawal-service";
import type { NewWithdrawal, WithdrawalRecord } from "@/lib/withdrawal-inputs";
import { MutationStore } from "@/server/mutation-store";
import { AppError } from "@/server/errors";

const columns = `w.id,w.client_id as "clientId",w.currency,w.amount::text,w.withdrawn_at::text as "withdrawnAt",w.reference,w.created_at::text as "createdAt",w.correction_of as "correctionOf",w.correction_reason as "correctionReason",exists(select 1 from public.withdrawals c where c.correction_of=w.id) as superseded`;
const normalize = (row: WithdrawalRecord): WithdrawalRecord => ({
  ...row,
  withdrawnAt: new Date(row.withdrawnAt).toISOString(),
  createdAt: new Date(row.createdAt).toISOString(),
});
export class PostgresWithdrawalRepository implements WithdrawalRepository {
  constructor(
    private readonly db: Database,
    private readonly mutations: MutationStore,
  ) {}
  async list(context: AuthorizedContext, clientId: string) {
    return this.db.withIdentity(context.identity, async (client) =>
      (
        await client.query<WithdrawalRecord>(
          `select ${columns} from public.withdrawals w where w.client_id=$1 order by w.withdrawn_at desc,w.created_at desc,w.id`,
          [clientId],
        )
      ).rows.map(normalize),
    );
  }
  record(context: AuthorizedContext, input: NewWithdrawal) {
    return this.mutations.run(
      context,
      input.requestId,
      "withdrawal.record",
      input,
      async (client) => {
        if (input.correctionOf) {
          const original = (
            await client.query<{ id: string }>(
              `select id from public.withdrawals w where id=$1 and client_id=$2 and currency=$3 and not exists(select 1 from public.withdrawals c where c.correction_of=w.id)`,
              [input.correctionOf, input.clientId, input.currency],
            )
          ).rows[0];
          if (!original)
            throw new AppError(
              "STALE_RECORD",
              "Choose the latest withdrawal for this client and currency.",
              409,
            );
        }
        const row = (
          await client.query<{ id: string }>(
            `insert into public.withdrawals(client_id,currency,amount,withdrawn_at,reference,correction_of,correction_reason,created_by) values($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
            [
              input.clientId,
              input.currency,
              input.amount,
              input.withdrawnAt,
              input.reference,
              input.correctionOf,
              input.correctionReason,
              context.profile.id,
            ],
          )
        ).rows[0];
        return normalize(
          (
            await client.query<WithdrawalRecord>(
              `select ${columns} from public.withdrawals w where w.id=$1`,
              [row.id],
            )
          ).rows[0],
        );
      },
    );
  }
}
