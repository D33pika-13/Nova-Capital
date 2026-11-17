import "server-only";
import type { SqlClient } from "../database";
export interface StorageLocation {
  provider: "azure";
  account: string;
  maximumBytes: number;
}
export class StorageLocationPolicy {
  constructor(private readonly location?: StorageLocation) {}
  async ready(
    sql: SqlClient,
    bucket: string,
    purpose: "reports" | "offer_images",
  ) {
    const query = this.location
      ? "select private.azure_storage_ready($1,$2,$3,$4) as ready"
      : purpose === "reports"
        ? "select private.report_bucket_ready($1) as ready"
        : "select private.offer_image_bucket_ready($1) as ready";
    const values = this.location
      ? [this.location.account, bucket, purpose, this.location.maximumBytes]
      : [bucket];
    return (await sql.query<{ ready: boolean }>(query, values)).rows[0].ready;
  }
}
