import "server-only";
import type { Database } from "../database";
import type { VerifiedIdentity } from "../contracts";
import type { EntraSessionRepository } from "../modules/identity/entra-session-service";

export class PostgresEntraSessions implements EntraSessionRepository {
  constructor(private readonly database: Database) {}
  create(identity: VerifiedIdentity, tokenHash: string, realmHash: string) {
    return this.database.withIdentity(identity, async (sql) => {
      const row = (
        await sql.query<{ expires_at: string }>(
          "select expires_at::text from private.create_entra_session($1,$2)",
          [tokenHash, realmHash],
        )
      ).rows[0];
      return row ? { expiresAt: new Date(row.expires_at).toISOString() } : null;
    });
  }
  revokeVerified(identity: VerifiedIdentity, realmHash: string) {
    return this.database.withIdentity(
      identity,
      async (sql) =>
        (
          await sql.query<{ revoked: boolean }>(
            "select private.revoke_entra_verified_sessions($1) revoked",
            [realmHash],
          )
        ).rows[0]?.revoked === true,
    );
  }
  resolve(tokenHash: string, realmHash: string) {
    return this.database.withIdentity(null, async (sql) => {
      const row = (
        await sql.query<{ subject: string; assurance: "aal1" | "aal2" }>(
          "select * from private.resolve_entra_session_assured($1,$2)",
          [tokenHash, realmHash],
        )
      ).rows[0];
      return row
        ? {
            provider: "entra",
            subject: row.subject,
            assurance: row.assurance,
          }
        : null;
    });
  }
  async revoke(tokenHash: string, realmHash: string, all: boolean) {
    await this.database.withIdentity(null, (sql) =>
      sql.query("select private.revoke_entra_session($1,$2,$3)", [
        tokenHash,
        realmHash,
        all,
      ]),
    );
  }
}
