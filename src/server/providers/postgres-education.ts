import "server-only";
import type { Database } from "../database";
import type { EducationRepository } from "../modules/education/education-service";
import type {
  EducationInput,
  EducationPage,
  EducationRequest,
} from "@/lib/education-inputs";
import type { AuthorizedContext } from "../modules/identity/authorization-service";
import { AppError } from "../errors";
export class PostgresEducationRepository implements EducationRepository {
  constructor(private readonly db: Database) {}
  async submit(input: EducationInput, hash: string) {
    try {
      await this.db.withIdentity(null, async (sql) => {
        await sql.query(
          "select private.submit_education($1,$2,$3,$4,$5,$6,$7)",
          [
            input.requestId,
            hash,
            input.name,
            input.email,
            input.phone,
            input.service,
            input.message,
          ],
        );
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      )
        throw new AppError(
          "REQUEST_CONFLICT",
          "This submission reference has already been used for different details. Retry your original request.",
          409,
        );
      throw error;
    }
  }
  list(context: AuthorizedContext, page: EducationPage) {
    return this.db.withIdentity(
      context.identity,
      async (sql) =>
        (
          await sql.query<EducationRequest>(
            `select id,name,email,phone,service,message,to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt" from private.education_requests where ($1='all' or service=$1) order by created_at desc,id limit 50 offset $2`,
            [page.service, page.offset],
          )
        ).rows,
    );
  }
}
