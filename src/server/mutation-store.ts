import "server-only";
import { createHash } from "node:crypto";
import type { Database, SqlClient } from "./database";
import type { AuthorizedContext } from "./modules/identity/authorization-service";
import { AppError } from "./errors";
export class MutationStore {
  constructor(private readonly db: Database) {}
  async run<T>(
    context: AuthorizedContext,
    requestId: string,
    action: string,
    payload: unknown,
    work: (client: SqlClient) => Promise<T>,
  ): Promise<T> {
    const hash = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
    try {
      return await this.db.withIdentity(context.identity, async (client) => {
        const inserted = await client.query(
          "insert into public.write_requests(actor_id,request_id,action,payload_hash) values($1,$2,$3,$4) on conflict(actor_id,request_id) do nothing returning request_id",
          [context.profile.id, requestId, action, hash],
        );
        if (!inserted.rows.length) {
          const previous = await client.query<{
            action: string;
            payload_hash: string;
            result: T | null;
          }>(
            "select action,payload_hash,result from public.write_requests where actor_id=$1 and request_id=$2",
            [context.profile.id, requestId],
          );
          const row = previous.rows[0];
          if (!row || row.action !== action || row.payload_hash !== hash)
            throw new AppError(
              "REQUEST_CONFLICT",
              "This submission key has already been used for another change.",
              409,
            );
          if (row.result === null)
            throw new AppError(
              "REQUEST_PENDING",
              "This submission is still processing.",
              409,
            );
          return row.result;
        }
        const result = await work(client);
        await client.query(
          "update public.write_requests set result=$3::jsonb where actor_id=$1 and request_id=$2",
          [context.profile.id, requestId, JSON.stringify(result)],
        );
        return result;
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
export function mapDatabaseError(error: unknown): unknown {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  if (code === "23505")
    return new AppError(
      "CONFLICT",
      "A record with these identifiers or reporting date already exists. Refresh before retrying.",
      409,
    );
  if (code === "23503" || code === "23514" || code === "22P02")
    return new AppError(
      "INVALID_RECORD",
      "The record could not be saved. Check its values and associations.",
      422,
    );
  if (code === "42501")
    return new AppError("FORBIDDEN", "This operation is not authorized.", 403);
  return error;
}
