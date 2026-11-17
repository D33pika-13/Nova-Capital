import "server-only";
import type { Database, SqlClient } from "../database";
import type { AuthorizedContext } from "../modules/identity/authorization-service";
import type {
  EntraProvisioningRepository,
  EntraProvisioningClaim,
} from "../modules/clients/entra-provisioning-service";
import { AppError } from "../errors";
import { mapDatabaseError } from "../mutation-store";
export class PostgresEntraProvisioning implements EntraProvisioningRepository {
  constructor(private readonly database: Database) {}
  private async run<T>(
    context: AuthorizedContext,
    work: (sql: SqlClient) => Promise<T>,
  ) {
    try {
      return await this.database.withIdentity(context.identity, work);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
  claim(
    context: AuthorizedContext,
    tenantId: string,
    domain: string,
    clientId: string,
    leaseId: string,
  ) {
    return this.run(context, async (sql) => {
      const row = (
        await sql.query<{
          mode: EntraProvisioningClaim["mode"];
          email: string;
          display_name: string;
          object_id: string | null;
        }>("select * from private.claim_entra_provisioning($1,$2,$3,$4)", [
          tenantId,
          domain,
          clientId,
          leaseId,
        ])
      ).rows[0];
      if (!row)
        throw new AppError(
          "PROVISIONING_UNAVAILABLE",
          "Account preparation is unavailable.",
          503,
        );
      return {
        mode: row.mode,
        email: row.email,
        displayName: row.display_name,
        objectId: row.object_id,
      };
    });
  }
  start(
    context: AuthorizedContext,
    tenantId: string,
    clientId: string,
    leaseId: string,
  ) {
    return this.run(
      context,
      async (sql) =>
        (
          await sql.query<{ allowed: boolean }>(
            "select private.start_entra_provisioning($1,$2,$3) allowed",
            [tenantId, clientId, leaseId],
          )
        ).rows[0]?.allowed === true,
    );
  }
  complete(
    context: AuthorizedContext,
    tenantId: string,
    clientId: string,
    leaseId: string,
    objectId: string,
  ) {
    return this.run(
      context,
      async (sql) =>
        (
          await sql.query<{ allowed: boolean }>(
            "select private.complete_entra_provisioning($1,$2,$3,$4) allowed",
            [tenantId, clientId, leaseId, objectId],
          )
        ).rows[0]?.allowed === true,
    );
  }
  async release(
    context: AuthorizedContext,
    tenantId: string,
    clientId: string,
    leaseId: string,
    rejected: boolean,
  ) {
    await this.run(context, (sql) =>
      sql.query("select private.release_entra_provisioning($1,$2,$3,$4)", [
        tenantId,
        clientId,
        leaseId,
        rejected,
      ]),
    );
  }
}
