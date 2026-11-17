import "server-only";
import type { Database, SqlClient } from "@/server/database";
import type { ClientRecord } from "@/lib/models";
import type {
  ClientRepository,
  CreateClient,
  UpdateClient,
} from "@/server/modules/clients/client-service";
import type { AuthorizedContext } from "@/server/modules/identity/authorization-service";
import { MutationStore } from "@/server/mutation-store";
import { AppError } from "@/server/errors";
const columns = `p.id,p.client_id as "clientId",p.display_name as "displayName",p.email,p.status,p.created_at::text as "createdAt",to_char(p.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt",exists(select 1 from public.provider_identities i where i.profile_id=p.id) as "identityLinked",(select v.status from public.client_invitations v where v.client_id=p.id order by v.created_at desc,v.id desc limit 1) as "invitationStatus"`;
function normalized(row: ClientRecord): ClientRecord {
  return {
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: row.updatedAt,
  };
}
export class PostgresClientRepository implements ClientRepository {
  private readonly mutations: MutationStore;
  constructor(private readonly db: Database) {
    this.mutations = new MutationStore(db);
  }
  private async find(client: SqlClient, id: string) {
    const row = (
      await client.query<ClientRecord>(
        `select ${columns} from public.profiles p where p.id=$1 and p.role='client'`,
        [id],
      )
    ).rows[0];
    return row ? normalized(row) : null;
  }
  list(
    context: AuthorizedContext,
    query: string,
    status: string,
    offset: number,
  ) {
    return this.db.withIdentity(context.identity, async (client) =>
      (
        await client.query<ClientRecord>(
          `select ${columns} from public.profiles p where p.role='client' and ($1='' or position(lower($1) in lower(p.display_name||' '||p.email||' '||p.client_id))>0) and ($2='all' or p.status=$2) order by p.created_at desc,p.id limit 50 offset $3`,
          [query, status, offset],
        )
      ).rows.map(normalized),
    );
  }
  get(context: AuthorizedContext, id: string) {
    return this.db.withIdentity(context.identity, (client) =>
      this.find(client, id),
    );
  }
  create(context: AuthorizedContext, input: CreateClient) {
    return this.mutations.run(
      context,
      input.requestId,
      "client.create",
      input,
      async (client) => {
        const result = await client.query<{ id: string }>(
          "insert into public.profiles(client_id,display_name,email,role,status) values(coalesce($1,private.next_client_id()),$2,$3,'client','active') returning id",
          [input.clientId ?? null, input.displayName, input.email],
        );
        return (await this.find(client, result.rows[0].id))!;
      },
    );
  }
  update(context: AuthorizedContext, id: string, input: UpdateClient) {
    return this.mutations.run(
      context,
      input.requestId,
      "client.update",
      { id, ...input },
      async (client) => {
        const row = await client.query(
          "update public.profiles set display_name=$2,status=$3 where id=$1 and role='client' and updated_at=$4::timestamptz returning id",
          [id, input.displayName, input.status, input.expectedUpdatedAt],
        );
        if (!row.rows.length)
          throw new AppError(
            "STALE_RECORD",
            "This client changed or is unavailable. Refresh before editing.",
            409,
          );
        return (await this.find(client, id))!;
      },
    );
  }
  addNote(
    context: AuthorizedContext,
    id: string,
    requestId: string,
    note: string,
  ) {
    return this.mutations.run(
      context,
      requestId,
      "client.note",
      { id, note },
      async (client) => {
        if (!(await this.find(client, id)))
          throw new AppError("NOT_FOUND", "Client not found.", 404);
        return (
          await client.query<{ id: string }>(
            "insert into public.admin_notes(client_id,note,created_by) values($1,$2,$3) returning id",
            [id, note, context.profile.id],
          )
        ).rows[0];
      },
    );
  }
  notes(context: AuthorizedContext, id: string) {
    return this.db.withIdentity(context.identity, async (client) =>
      (
        await client.query<{ id: string; note: string; createdAt: string }>(
          'select id,note,created_at::text as "createdAt" from public.admin_notes where client_id=$1 order by created_at desc,id desc limit 100',
          [id],
        )
      ).rows.map((r) => ({
        ...r,
        createdAt: new Date(r.createdAt).toISOString(),
      })),
    );
  }
  metrics(context: AuthorizedContext) {
    return this.db.withIdentity(context.identity, async (client) => {
      const row = (
        await client.query<{
          totalClients: number;
          activeClients: number;
          investmentRecords: number;
        }>(
          `select (select count(*)::int from public.profiles where role='client') as "totalClients",(select count(*)::int from public.profiles where role='client' and status='active') as "activeClients",(select count(*)::int from public.investments) as "investmentRecords"`,
        )
      ).rows[0];
      const activity = (
        await client.query<{
          entity: string;
          action: string;
          createdAt: string;
        }>(
          `select entity,action,created_at::text as "createdAt" from public.audit_logs order by created_at desc,id desc limit 8`,
        )
      ).rows.map((r) => ({
        ...r,
        createdAt: new Date(r.createdAt).toISOString(),
      }));
      return { ...row, latestActivity: activity };
    });
  }
}
