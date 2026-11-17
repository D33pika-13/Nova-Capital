import "server-only";
import { Pool } from "pg";
import type { Database, SqlClient } from "@/server/database";
import type {
  VerifiedIdentity,
  ProfileRepository,
  Profile,
  RateLimiter,
} from "@/server/contracts";
import { createHash } from "node:crypto";
import { AppError } from "@/server/errors";
export class PostgresDatabase implements Database {
  constructor(private readonly pool: Pool) {}
  async withIdentity<T>(
    identity: VerifiedIdentity | null,
    work: (client: SqlClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    let transaction = false;
    let committing = false;
    let discard = false;
    try {
      const role = await client.query<{
        rolname: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(
        "select rolname,rolsuper,rolbypassrls from pg_roles where rolname=current_user",
      );
      if (
        role.rows[0]?.rolname !== "nova_app" ||
        role.rows[0].rolsuper ||
        role.rows[0].rolbypassrls
      ) {
        discard = true;
        throw new AppError(
          "UNSAFE_DATABASE_ROLE",
          "The database connection is not configured safely.",
          503,
        );
      }
      await client.query("begin");
      transaction = true;
      await client.query(
        "select set_config('app.provider',$1,true),set_config('app.subject',$2,true),set_config('app.assurance',$3,true)",
        [
          identity?.provider ?? "",
          identity?.subject ?? "",
          identity?.assurance ?? "",
        ],
      );
      const result = await work(client);
      committing = true;
      await client.query("commit");
      transaction = false;
      return result;
    } catch (error) {
      if (!transaction || committing) discard = true;
      if (transaction) {
        try {
          await client.query("rollback");
        } catch {
          discard = true;
        }
      }
      throw error;
    } finally {
      client.release(discard);
    }
  }
}
export class PostgresProfileRepository implements ProfileRepository {
  constructor(private readonly database: Database) {}
  findByIdentity(identity: VerifiedIdentity): Promise<Profile | null> {
    return this.database.withIdentity(identity, async (client) => {
      const result = await client.query<{
        id: string;
        role: "admin" | "client";
        status: "active" | "suspended" | "deactivated";
        client_id: string | null;
        display_name: string;
      }>(
        "select p.id,p.role,p.status,p.client_id,p.display_name from public.profiles p join public.provider_identities i on p.id=i.profile_id where i.provider=$1 and i.subject=$2",
        [identity.provider, identity.subject],
      );
      const row = result.rows[0];
      return row
        ? {
            id: row.id,
            role: row.role,
            status: row.status,
            clientId: row.client_id,
            displayName: row.display_name,
            externalSubject: identity.subject,
          }
        : null;
    });
  }
}
export class PostgresRateLimiter implements RateLimiter {
  constructor(private readonly database: Database) {}
  consume(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    return this.database.withIdentity(null, async (client) => {
      const result = await client.query<{ allowed: boolean }>(
        "select private.consume_rate_limit($1,$2,$3) as allowed",
        [createHash("sha256").update(key).digest("hex"), limit, windowSeconds],
      );
      return result.rows[0]?.allowed === true;
    });
  }
}
