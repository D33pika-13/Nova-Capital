import "server-only";
import type { Database } from "../database";
import type { AuthorizedContext } from "../modules/identity/authorization-service";
import type {
  SupportFacts,
  SupportSnapshot,
  SupportHolding,
} from "../modules/support/support-contracts";
const date = (field: string) =>
  `to_char(${field} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
export class PostgresSupportFacts implements SupportFacts {
  constructor(private readonly db: Database) {}
  async snapshots(context: AuthorizedContext, currency: string | null) {
    return this.db.withIdentity(
      context.identity,
      async (sql) =>
        (
          await sql.query<SupportSnapshot>(
            `select distinct on(s.currency) s.currency,s.reported_value::text as "reportedValue",s.adjusted_basis::text as "adjustedBasis",left(s.basis_explanation,300) as "basisExplanation",${date("s.reported_at")} as "reportedAt" from public.portfolio_snapshots s where s.client_id=$1 and ($2::text is null or s.currency=$2) and not exists(select 1 from public.portfolio_snapshots c where c.correction_of=s.id) order by s.currency,s.reported_at desc,s.created_at desc,s.id limit 10`,
            [context.profile.id, currency],
          )
        ).rows,
    );
  }
  async lastUpdate(context: AuthorizedContext) {
    return this.db.withIdentity(
      context.identity,
      async (sql) =>
        (
          await sql.query<{ recordedAt: string; reportedAt: string }>(
            `select ${date("created_at")} as "recordedAt",${date("reported_at")} as "reportedAt" from public.portfolio_snapshots where client_id=$1 order by created_at desc,id limit 1`,
            [context.profile.id],
          )
        ).rows[0] ?? null,
    );
  }
  async holdings(context: AuthorizedContext, currency: string | null) {
    return this.db.withIdentity(
      context.identity,
      async (sql) =>
        (
          await sql.query<SupportHolding>(
            `select currency,asset_class as "assetClass",sum(reported_value)::text as "reportedValue",null::text as "archivedAt" from public.investments where client_id=$1 and archived_at is null and ($2::text is null or currency=$2) group by currency,asset_class order by currency,asset_class`,
            [context.profile.id, currency],
          )
        ).rows,
    );
  }
  async reports(context: AuthorizedContext) {
    return this.db.withIdentity(
      context.identity,
      async (sql) =>
        (
          await sql.query<{ title: string; reportDate: string }>(
            `select title,report_date::text as "reportDate" from public.client_reports where client_id=$1 and status='available' order by report_date desc,id limit 6`,
            [context.profile.id],
          )
        ).rows,
    );
  }
  async offers() {
    return this.db.withIdentity(
      null,
      async (sql) =>
        (
          await sql.query<{ title: string; endsAt: string }>(
            `select title,${date("ends_at")} as "endsAt" from public.offers where status='published' and starts_at<=now() and ends_at>now() order by ends_at,id limit 6`,
          )
        ).rows,
    );
  }
  async announcements(context: AuthorizedContext) {
    return this.db.withIdentity(
      context.identity,
      async (sql) =>
        (
          await sql.query<{ title: string; body: string }>(
            `select a.title,left(a.body,300) as body from public.announcements a join public.announcement_recipients r on r.announcement_id=a.id where r.client_id=$1 and r.included and a.status='published' order by a.updated_at desc,a.id limit 4`,
            [context.profile.id],
          )
        ).rows,
    );
  }
}
