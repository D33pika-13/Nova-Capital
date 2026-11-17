import "server-only";
import type { Database, SqlClient } from "../database";
import type { ContactStatus } from "@/lib/contact-inputs";
import type { ContactRepository } from "../modules/support/contact-service";
import { AppError } from "../errors";
export class PostgresContactRepository implements ContactRepository {
  constructor(private readonly db: Database) {}
  private async run<T>(work: (client: SqlClient) => Promise<T>): Promise<T> {
    try {
      return await this.db.withIdentity(null, work);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      )
        throw new AppError(
          "REQUEST_CONFLICT",
          "This reference conflicts with a different submission or service profile. Contact support through another verified method before creating a new enquiry.",
          409,
        );
      throw error;
    }
  }
  status(id: string, hash: string) {
    return this.run<ContactStatus | null>(
      async (sql) =>
        (
          await sql.query<{ status: ContactStatus | null }>(
            "select private.contact_status($1,$2) as status",
            [id, hash],
          )
        ).rows[0].status,
    );
  }
  claim(id: string, hash: string) {
    return this.run<{ claimed: boolean; status: ContactStatus }>(
      async (sql) =>
        (
          await sql.query<{ claimed: boolean; status: ContactStatus }>(
            "select * from private.claim_contact($1,$2)",
            [id, hash],
          )
        ).rows[0],
    );
  }
  finish(id: string, hash: string, status: "accepted" | "unknown") {
    return this.run<ContactStatus>(
      async (sql) =>
        (
          await sql.query<{ status: ContactStatus }>(
            "select private.finish_contact($1,$2,$3) as status",
            [id, hash, status],
          )
        ).rows[0].status,
    );
  }
}
