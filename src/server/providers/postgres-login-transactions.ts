import "server-only";
import type { Database } from "../database";
import { AppError } from "../errors";
import type {
  LoginTransaction,
  EntraLoginPurpose,
  LoginTransactionRepository,
} from "../modules/identity/oidc-login-contracts";

export class PostgresLoginTransactions implements LoginTransactionRepository {
  constructor(private readonly database: Database) {}
  async create(value: LoginTransaction) {
    const stored = await this.database.withIdentity(
      null,
      async (sql) =>
        (
          await sql.query<{ stored: boolean }>(
            "select private.store_entra_transaction_flow($1,$2,$3,$4,$5,$6) as stored",
            [
              value.stateHash,
              value.bindingHash,
              value.configurationHash,
              value.nonce,
              value.codeVerifier,
              value.purpose ?? "login",
            ],
          )
        ).rows[0]?.stored,
    );
    if (!stored)
      throw new AppError(
        "RATE_LIMITED",
        "Too many active sign-in requests. Try again later.",
        429,
      );
  }
  async take(
    stateHash: string,
    bindingHash: string,
    configurationHash: string,
  ) {
    return this.database.withIdentity(null, async (sql) => {
      const row = (
        await sql.query<{
          nonce: string;
          code_verifier: string;
          purpose: EntraLoginPurpose;
        }>("select * from private.take_entra_transaction_flow($1,$2,$3)", [
          stateHash,
          bindingHash,
          configurationHash,
        ])
      ).rows[0];
      return row
        ? {
            nonce: row.nonce,
            codeVerifier: row.code_verifier,
            purpose: row.purpose,
          }
        : null;
    });
  }
}
