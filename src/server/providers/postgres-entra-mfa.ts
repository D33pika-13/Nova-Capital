import "server-only";
import type { Database } from "../database";
import type { EntraMfaRepository } from "../modules/identity/entra-mfa-service";

export class PostgresEntraMfa implements EntraMfaRepository {
  constructor(private readonly database: Database) {}
  profile(tokenHash: string, realmHash: string) {
    return this.database.withIdentity(
      null,
      async (sql) =>
        (
          await sql.query<{ id: string | null }>(
            "select private.entra_mfa_profile($1,$2) id",
            [tokenHash, realmHash],
          )
        ).rows[0]?.id ?? null,
    );
  }
  prepare(
    tokenHash: string,
    realmHash: string,
    factorId: string,
    encryptedSecret: string,
  ) {
    return this.database.withIdentity(null, async (sql) => {
      const row = (
        await sql.query<{
          factor_id: string;
          profile_id: string;
          encrypted_secret: string | null;
          enrolled: boolean;
        }>("select * from private.prepare_entra_mfa($1,$2,$3,$4)", [
          tokenHash,
          realmHash,
          factorId,
          encryptedSecret,
        ])
      ).rows[0];
      return row
        ? {
            factorId: row.factor_id,
            profileId: row.profile_id,
            encryptedSecret: row.encrypted_secret,
            enrolled: row.enrolled,
          }
        : null;
    });
  }
  begin(
    tokenHash: string,
    realmHash: string,
    proofHash: string,
    recovery: boolean,
  ) {
    return this.database.withIdentity(null, async (sql) => {
      const row = (
        await sql.query<{
          factor_id: string;
          profile_id: string;
          encrypted_secret: string | null;
          last_step: number | string | null;
          enrolling: boolean;
        }>("select * from private.begin_entra_mfa($1,$2,$3,$4)", [
          tokenHash,
          realmHash,
          proofHash,
          recovery,
        ])
      ).rows[0];
      return row
        ? {
            factorId: row.factor_id,
            profileId: row.profile_id,
            encryptedSecret: row.encrypted_secret,
            lastStep: row.last_step === null ? null : Number(row.last_step),
            enrolled: !row.enrolling,
          }
        : null;
    });
  }
  finish(input: Parameters<EntraMfaRepository["finish"]>[0]) {
    return this.database.withIdentity(null, async (sql) => {
      const row = (
        await sql.query<{ expires_at: string }>(
          "select expires_at::text from private.finish_entra_mfa($1,$2,$3,$4,$5,$6,$7)",
          [
            input.tokenHash,
            input.realmHash,
            input.proofHash,
            input.step,
            input.recoveryDigest,
            input.newTokenHash,
            input.recoveryDigests,
          ],
        )
      ).rows[0];
      return row ? { expiresAt: new Date(row.expires_at).toISOString() } : null;
    });
  }
  beginAction(
    tokenHash: string,
    realmHash: string,
    proofHash: string,
    recovery: boolean,
    operation: Parameters<EntraMfaRepository["beginAction"]>[4],
  ) {
    return this.database.withIdentity(null, async (sql) => {
      const row = (
        await sql.query<{
          factor_id: string;
          profile_id: string;
          encrypted_secret: string | null;
          last_step: number | string | null;
          enrolling: boolean;
        }>("select * from private.begin_entra_mfa_action($1,$2,$3,$4,$5)", [
          tokenHash,
          realmHash,
          proofHash,
          recovery,
          operation,
        ])
      ).rows[0];
      return row
        ? {
            factorId: row.factor_id,
            profileId: row.profile_id,
            encryptedSecret: row.encrypted_secret,
            lastStep: row.last_step === null ? null : Number(row.last_step),
            enrolled: !row.enrolling,
          }
        : null;
    });
  }
  finishAction(input: Parameters<EntraMfaRepository["finishAction"]>[0]) {
    return this.database.withIdentity(null, async (sql) => {
      const row = (
        await sql.query<{ expires_at: string | null; removed: boolean }>(
          "select expires_at::text,removed from private.finish_entra_mfa_action($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            input.tokenHash,
            input.realmHash,
            input.proofHash,
            input.operation,
            input.step,
            input.recoveryDigest,
            input.newTokenHash,
            input.recoveryDigests,
          ],
        )
      ).rows[0];
      return row
        ? {
            expiresAt:
              row.expires_at === null
                ? null
                : new Date(row.expires_at).toISOString(),
            removed: row.removed,
          }
        : null;
    });
  }
}
