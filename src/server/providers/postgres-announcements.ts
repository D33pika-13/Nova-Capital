import "server-only";
import type { Database, SqlClient } from "../database";
import type { AuthorizedContext } from "../modules/identity/authorization-service";
import type { AnnouncementRepository } from "../modules/offers/announcement-service";
import type {
  AnnouncementInput,
  AnnouncementEditInput,
  ManagedAnnouncement,
  ClientAnnouncement,
} from "@/lib/announcement-inputs";
import { MutationStore, mapDatabaseError } from "../mutation-store";
import { AppError } from "../errors";
const timestamp = (column: string) =>
  `to_char(${column} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const managedColumns = `a.id,a.title,a.body,a.status,a.version,${timestamp("a.updated_at")} as "updatedAt",coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'clientId',p.client_id,'displayName',p.display_name,'status',p.status,'readVersion',r.read_version,'readAt',${timestamp("r.read_at")}) order by p.client_id) from public.announcement_recipients r join public.profiles p on p.id=r.client_id where r.announcement_id=a.id and r.included),'[]'::jsonb) as recipients`;
export class PostgresAnnouncementRepository implements AnnouncementRepository {
  private readonly mutations: MutationStore;
  constructor(private readonly db: Database) {
    this.mutations = new MutationStore(db);
  }
  private async find(sql: SqlClient, id: string) {
    return (
      await sql.query<ManagedAnnouncement>(
        `select ${managedColumns} from public.announcements a where a.id=$1`,
        [id],
      )
    ).rows[0];
  }
  async manage(context: AuthorizedContext, offset: number) {
    return this.db.withIdentity(
      context.identity,
      async (sql) =>
        (
          await sql.query<ManagedAnnouncement>(
            `select ${managedColumns} from public.announcements a order by a.updated_at desc,a.id limit 50 offset $1`,
            [offset],
          )
        ).rows,
    );
  }
  async inbox(context: AuthorizedContext, offset: number) {
    return this.db.withIdentity(
      context.identity,
      async (sql) =>
        (
          await sql.query<ClientAnnouncement>(
            `select a.id,a.title,a.body,a.version,${timestamp("a.updated_at")} as "updatedAt",r.read_version as "readVersion",${timestamp("r.read_at")} as "readAt" from public.announcements a join public.announcement_recipients r on r.announcement_id=a.id where r.client_id=$1 and r.included and a.status='published' order by a.updated_at desc,a.id limit 50 offset $2`,
            [context.profile.id, offset],
          )
        ).rows,
    );
  }
  async save(
    context: AuthorizedContext,
    input: AnnouncementInput | AnnouncementEditInput,
    id?: string,
  ) {
    return this.mutations.run(
      context,
      input.requestId,
      "announcement.save",
      { ...input, id },
      async (sql) => {
        const recipients = await sql.query<{ id: string }>(
          "select id from public.profiles where id=any($1::uuid[]) and role='client'",
          [input.clientIds],
        );
        if (recipients.rows.length !== input.clientIds.length)
          throw new AppError(
            "INVALID_RECIPIENTS",
            "One or more selected clients are unavailable. Refresh the recipient list.",
            422,
          );
        const row = id
          ? (
              await sql.query<{ id: string }>(
                "update public.announcements set title=$1,body=$2,status=$3 where id=$4 and version=$5 returning id",
                [
                  input.title,
                  input.body,
                  input.status,
                  id,
                  (input as AnnouncementEditInput).expectedVersion,
                ],
              )
            ).rows[0]
          : (
              await sql.query<{ id: string }>(
                "insert into public.announcements(title,body,status,created_by) values($1,$2,$3,$4) returning id",
                [input.title, input.body, input.status, context.profile.id],
              )
            ).rows[0];
        if (!row)
          throw new AppError(
            "STALE_RECORD",
            "Announcement changed or is unavailable. Refresh before editing.",
            409,
          );
        await sql.query(
          "update public.announcement_recipients set included=false where announcement_id=$1 and included and not(client_id=any($2::uuid[]))",
          [row.id, input.clientIds],
        );
        await sql.query(
          "insert into public.announcement_recipients(announcement_id,client_id) select $1,unnest($2::uuid[]) on conflict(announcement_id,client_id) do update set included=true where not announcement_recipients.included",
          [row.id, input.clientIds],
        );
        return (await this.find(sql, row.id))!;
      },
    );
  }
  async markRead(context: AuthorizedContext, id: string, version: number) {
    try {
      return await this.db.withIdentity(context.identity, async (sql) => {
        await sql.query(
          "update public.announcement_recipients r set read_version=$3 from public.announcements a where a.id=r.announcement_id and a.id=$1 and a.version=$3 and a.status='published' and r.client_id=$2 and r.included and r.read_version<$3",
          [id, context.profile.id, version],
        );
        const result = (
          await sql.query<{ readVersion: number; readAt: string }>(
            `select r.read_version as "readVersion",${timestamp("r.read_at")} as "readAt" from public.announcement_recipients r join public.announcements a on a.id=r.announcement_id where a.id=$1 and a.version=$3 and a.status='published' and r.client_id=$2 and r.included and r.read_version=$3`,
            [id, context.profile.id, version],
          )
        ).rows[0];
        if (!result)
          throw new AppError(
            "NOTICE_UNAVAILABLE",
            "This announcement changed or is unavailable. Refresh your inbox.",
            409,
          );
        return result;
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
