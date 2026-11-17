import "server-only";
import type { VerifiedIdentity } from "./contracts";
export interface SqlClient {
  query<T extends object = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}
export interface Database {
  withIdentity<T>(
    identity: VerifiedIdentity | null,
    work: (client: SqlClient) => Promise<T>,
  ): Promise<T>;
}
