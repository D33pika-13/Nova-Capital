import "server-only";
import type { Database } from "@/server/database";
import type { AuthorizedContext } from "@/server/modules/identity/authorization-service";
import type {
  InvitationRepository,
  PreparedInvitation,
} from "@/server/modules/clients/invitation-service";
import { AppError } from "@/server/errors";
import { mapDatabaseError } from "@/server/mutation-store";
export class PostgresInvitationRepository implements InvitationRepository {
  constructor(private readonly db: Database) {}
  async claim(
    context: AuthorizedContext,
    clientId: string,
    requestId: string,
    purpose: "setup" | "reset",
    acknowledgeDuplicateRisk: boolean,
  ) {
    try {
      return await this.db.withIdentity(context.identity, async (client) => {
        const profile = (
          await client.query<{ email: string; status: string }>(
            "select email,status from public.profiles where id=$1 and role='client' for update",
            [clientId],
          )
        ).rows[0];
        if (!profile) throw new AppError("NOT_FOUND", "Client not found.", 404);
        if (profile.status !== "active")
          throw new AppError(
            "INACTIVE_CLIENT",
            "Activate this client before requesting an invitation.",
            409,
          );
        const old = (
          await client.query<{
            id: string;
            client_id: string;
            purpose: string;
            status: string;
          }>(
            "select id,client_id,purpose,status from public.client_invitations where actor_id=$1 and request_id=$2",
            [context.profile.id, requestId],
          )
        ).rows[0];
        if (old && (old.client_id !== clientId || old.purpose !== purpose))
          throw new AppError(
            "REQUEST_CONFLICT",
            "This request key was used for another invitation.",
            409,
          );
        const identity =
          (
            await client.query<{ subject: string }>(
              "select subject from public.provider_identities where profile_id=$1 and provider=$2",
              [clientId, context.identity.provider],
            )
          ).rows[0]?.subject ?? null;
        if (purpose === "reset" && !identity)
          throw new AppError(
            "NOT_INVITED",
            "Send an account setup invitation first.",
            409,
          );
        if (old && old.status !== "failed" && old.status !== "pending")
          return {
            id: old.id,
            status: old.status,
            claimed: false,
            email: profile.email,
            subject: identity,
          };
        const previous = (
          await client.query<{ status: string; recent: boolean }>(
            "select status,created_at>now()-interval '10 minutes' as recent from public.client_invitations where client_id=$1 and status in ('processing','unknown') order by created_at desc limit 1",
            [clientId],
          )
        ).rows[0];
        if (previous) {
          if (previous.status === "processing" && previous.recent)
            throw new AppError(
              "REQUEST_PENDING",
              "An invitation is already processing.",
              409,
            );
          if (!acknowledgeDuplicateRisk)
            throw new AppError(
              "DELIVERY_UNCERTAIN",
              "The previous request has uncertain delivery. Confirm that you checked the inbox before resending.",
              409,
            );
        }
        const row = old
          ? old
          : (
              await client.query<{ id: string }>(
                "insert into public.client_invitations(client_id,actor_id,request_id,purpose) values($1,$2,$3,$4) returning id",
                [clientId, context.profile.id, requestId, purpose],
              )
            ).rows[0];
        await client.query(
          "update public.client_invitations set status='processing',updated_at=now() where id=$1",
          [row.id],
        );
        return {
          id: row.id,
          status: "processing",
          claimed: true,
          email: profile.email,
          subject: identity,
        };
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
  async attach(
    context: AuthorizedContext,
    clientId: string,
    invitation: PreparedInvitation,
  ) {
    try {
      await this.db.withIdentity(context.identity, async (client) => {
        const profile = (
          await client.query<{ status: string }>(
            "select status from public.profiles where id=$1 and role='client' for update",
            [clientId],
          )
        ).rows[0];
        if (profile?.status !== "active")
          throw new AppError("INACTIVE_CLIENT", "Client is not active.", 409);
        await client.query(
          "insert into public.provider_identities(profile_id,provider,subject) values($1,$2,$3) on conflict(profile_id,provider) do nothing",
          [clientId, invitation.provider, invitation.subject],
        );
        const row = (
          await client.query<{ subject: string }>(
            "select subject from public.provider_identities where profile_id=$1 and provider=$2",
            [clientId, invitation.provider],
          )
        ).rows[0];
        if (row?.subject !== invitation.subject)
          throw new AppError(
            "IDENTITY_CONFLICT",
            "The identity association does not match.",
            409,
          );
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
  async finish(
    context: AuthorizedContext,
    id: string,
    status: "accepted" | "failed" | "unknown",
  ) {
    await this.db.withIdentity(context.identity, async (client) => {
      const result = await client.query(
        "update public.client_invitations set status=$2,updated_at=now() where id=$1 and actor_id=$3 and status='processing' returning id",
        [id, status, context.profile.id],
      );
      if (!result.rows.length)
        throw new AppError(
          "INVITATION_STATE",
          "Invitation status could not be confirmed.",
          409,
        );
    });
  }
}
