import "server-only";
import type { Database, SqlClient } from "@/server/database";
import type { AuthorizedContext } from "@/server/modules/identity/authorization-service";
import type { PortfolioRepository } from "@/server/modules/portfolio/portfolio-service";
import type {
  NewInvestment,
  EditInvestment,
  ArchiveInvestment,
  NewSnapshot,
} from "@/lib/portfolio-inputs";
import type {
  InvestmentRecord,
  InvestmentRevision,
  PortfolioSnapshot,
} from "@/lib/models";
import { MutationStore } from "@/server/mutation-store";
import { AppError } from "@/server/errors";
const investmentColumns = `id,client_id as "clientId",asset_class as "assetClass",description,currency,invested_amount::text as "investedAmount",reported_value::text as "reportedValue",reported_at::text as "reportedAt",archived_at::text as "archivedAt",version,correction_reason as "correctionReason"`;
const snapshotColumns = `s.id,s.client_id as "clientId",s.currency,s.adjusted_basis::text as "adjustedBasis",s.reported_value::text as "reportedValue",s.basis_explanation as "basisExplanation",s.reported_at::text as "reportedAt",s.created_at::text as "createdAt",s.correction_of as "correctionOf",s.correction_reason as "correctionReason",exists(select 1 from public.portfolio_snapshots c where c.correction_of=s.id) as superseded`;
function investment(row: InvestmentRecord): InvestmentRecord {
  return {
    ...row,
    reportedAt: new Date(row.reportedAt).toISOString(),
    archivedAt: row.archivedAt ? new Date(row.archivedAt).toISOString() : null,
  };
}
function snapshot(row: PortfolioSnapshot): PortfolioSnapshot {
  return {
    ...row,
    reportedAt: new Date(row.reportedAt).toISOString(),
    createdAt: new Date(row.createdAt).toISOString(),
  };
}
export class PostgresPortfolioRepository implements PortfolioRepository {
  private readonly mutations: MutationStore;
  constructor(private readonly db: Database) {
    this.mutations = new MutationStore(db);
  }
  private async checkClient(client: SqlClient, id: string) {
    const row = (
      await client.query(
        "select id from public.profiles where id=$1 and role='client'",
        [id],
      )
    ).rows[0];
    if (!row) throw new AppError("NOT_FOUND", "Client not found.", 404);
  }
  async read(context: AuthorizedContext, clientId: string) {
    return this.db.withIdentity(context.identity, async (client) => {
      if (context.profile.role === "admin")
        await this.checkClient(client, clientId);
      const investments = (
        await client.query<InvestmentRecord>(
          `select ${investmentColumns} from public.investments where client_id=$1 order by archived_at nulls first,reported_at desc,id`,
          [clientId],
        )
      ).rows.map(investment);
      const snapshots = (
        await client.query<PortfolioSnapshot>(
          `select ${snapshotColumns} from public.portfolio_snapshots s where s.client_id=$1 order by s.reported_at desc,s.created_at desc,s.id`,
          [clientId],
        )
      ).rows.map(snapshot);
      const revisions = (
        await client.query<InvestmentRevision>(
          `select ${investmentColumns},investment_id as "investmentId",recorded_at::text as "recordedAt" from public.investment_revisions where client_id=$1 order by recorded_at desc,id`,
          [clientId],
        )
      ).rows.map((row) => ({
        ...investment(row),
        investmentId: row.investmentId,
        recordedAt: new Date(row.recordedAt).toISOString(),
      }));
      return { investments, snapshots, revisions };
    });
  }
  createInvestment(context: AuthorizedContext, input: NewInvestment) {
    return this.mutations.run(
      context,
      input.requestId,
      "investment.create",
      input,
      async (client) => {
        await this.checkClient(client, input.clientId);
        const row = (
          await client.query<InvestmentRecord>(
            `insert into public.investments(client_id,asset_class,description,currency,invested_amount,reported_value,reported_at,created_by) values($1,$2,$3,$4,$5,$6,$7,$8) returning ${investmentColumns}`,
            [
              input.clientId,
              input.assetClass,
              input.description,
              input.currency,
              input.investedAmount,
              input.reportedValue,
              input.reportedAt,
              context.profile.id,
            ],
          )
        ).rows[0];
        return investment(row);
      },
    );
  }
  editInvestment(
    context: AuthorizedContext,
    clientId: string,
    id: string,
    input: EditInvestment,
  ) {
    return this.mutations.run(
      context,
      input.requestId,
      "investment.edit",
      { clientId, id, ...input },
      async (client) => {
        const row = (
          await client.query<InvestmentRecord>(
            `update public.investments set asset_class=$4,description=$5,invested_amount=$6,reported_value=$7,reported_at=$8,correction_reason=$9 where id=$1 and client_id=$2 and version=$3 and archived_at is null returning ${investmentColumns}`,
            [
              id,
              clientId,
              input.expectedVersion,
              input.assetClass,
              input.description,
              input.investedAmount,
              input.reportedValue,
              input.reportedAt,
              input.correctionReason,
            ],
          )
        ).rows[0];
        if (!row)
          throw new AppError(
            "STALE_RECORD",
            "The investment changed, was archived or is unavailable. Refresh before editing.",
            409,
          );
        return investment(row);
      },
    );
  }
  archiveInvestment(
    context: AuthorizedContext,
    clientId: string,
    id: string,
    input: ArchiveInvestment,
  ) {
    return this.mutations.run(
      context,
      input.requestId,
      "investment.archive",
      { clientId, id, ...input },
      async (client) => {
        const row = (
          await client.query<InvestmentRecord>(
            `update public.investments set archived_at=now(),correction_reason=$4 where id=$1 and client_id=$2 and version=$3 and archived_at is null returning ${investmentColumns}`,
            [id, clientId, input.expectedVersion, input.reason],
          )
        ).rows[0];
        if (!row)
          throw new AppError(
            "STALE_RECORD",
            "The investment changed, was archived or is unavailable. Refresh before archiving.",
            409,
          );
        return investment(row);
      },
    );
  }
  appendSnapshot(context: AuthorizedContext, input: NewSnapshot) {
    return this.mutations.run(
      context,
      input.requestId,
      "snapshot.create",
      input,
      async (client) => {
        await this.checkClient(client, input.clientId);
        if (input.correctionOf) {
          const original = (
            await client.query<{ reported_at: string; superseded: boolean }>(
              "select reported_at::text,exists(select 1 from public.portfolio_snapshots c where c.correction_of=s.id) as superseded from public.portfolio_snapshots s where s.id=$1 and s.client_id=$2 and s.currency=$3",
              [input.correctionOf, input.clientId, input.currency],
            )
          ).rows[0];
          if (!original || original.superseded)
            throw new AppError(
              "STALE_RECORD",
              "Choose the latest effective snapshot for this client and currency.",
              409,
            );
          if (
            new Date(original.reported_at).toISOString() !==
            new Date(input.reportedAt).toISOString()
          )
            throw new AppError(
              "CORRECTION_DATE",
              "A correction retains the original reporting date. Append a new snapshot for a different date.",
              422,
            );
        }
        const id = (
          await client.query<{ id: string }>(
            "insert into public.portfolio_snapshots(client_id,currency,adjusted_basis,reported_value,basis_explanation,reported_at,correction_of,correction_reason,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id",
            [
              input.clientId,
              input.currency,
              input.adjustedBasis,
              input.reportedValue,
              input.basisExplanation,
              input.reportedAt,
              input.correctionOf,
              input.correctionReason,
              context.profile.id,
            ],
          )
        ).rows[0].id;
        return snapshot(
          (
            await client.query<PortfolioSnapshot>(
              `select ${snapshotColumns} from public.portfolio_snapshots s where s.id=$1`,
              [id],
            )
          ).rows[0],
        );
      },
    );
  }
}
