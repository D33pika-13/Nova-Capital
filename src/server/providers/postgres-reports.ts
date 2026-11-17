import "server-only";
import {
  StorageLocationPolicy,
  type StorageLocation,
} from "./storage-location";
import { randomUUID } from "node:crypto";
import type { Database, SqlClient } from "@/server/database";
import type { AuthorizedContext } from "@/server/modules/identity/authorization-service";
import { toPublicReport } from "@/server/modules/reports/report-contracts";
import type {
  ReportRepository,
  StoredReport,
  ReportMetadata,
} from "@/server/modules/reports/report-contracts";
import { MutationStore, mapDatabaseError } from "@/server/mutation-store";
import { AppError } from "@/server/errors";
const columns = `id,client_id as "clientId",title,file_name as "fileName",period_start::text as "periodStart",period_end::text as "periodEnd",report_date::text as "reportDate",status,size_bytes as "sizeBytes",page_count as "pageCount",created_at::text as "createdAt",published_at::text as "publishedAt",(published_at is not null and file_sha256 is not null and status in ('available','archived')) as downloadable,storage_path as "storagePath",storage_provider as "storageProvider",storage_bucket as "storageBucket",file_sha256 as "fileSha256",storage_namespace as "storageNamespace"`;
function normalize(row: StoredReport): StoredReport {
  return {
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
    publishedAt: row.publishedAt
      ? new Date(row.publishedAt).toISOString()
      : null,
  };
}
export class PostgresReportRepository implements ReportRepository {
  private readonly mutations: MutationStore;
  private readonly policy: StorageLocationPolicy;
  constructor(
    private readonly db: Database,
    private readonly location?: StorageLocation,
  ) {
    this.mutations = new MutationStore(db);
    this.policy = new StorageLocationPolicy(location);
  }
  private async read(client: SqlClient, id: string) {
    const row = (
      await client.query<StoredReport>(
        `select ${columns} from public.client_reports where id=$1`,
        [id],
      )
    ).rows[0];
    return row ? normalize(row) : null;
  }
  async validateClient(context: AuthorizedContext, id: string) {
    await this.db.withIdentity(context.identity, async (client) => {
      if (
        !(
          await client.query(
            "select id from public.profiles where id=$1 and role='client'",
            [id],
          )
        ).rows.length
      )
        throw new AppError("NOT_FOUND", "Client not found.", 404);
    });
  }
  async abortCorrupt(context: AuthorizedContext, id: string) {
    return this.db.withIdentity(
      context.identity,
      async (client) =>
        (
          await client.query(
            "update public.client_reports set status='archived' where id=$1 and status='quarantined' returning id",
            [id],
          )
        ).rows.length === 1,
    );
  }
  async list(context: AuthorizedContext, clientId: string) {
    return this.db.withIdentity(context.identity, async (client) =>
      (
        await client.query<StoredReport>(
          `select ${columns} from public.client_reports where client_id=$1 order by report_date desc,created_at desc,id`,
          [clientId],
        )
      ).rows.map((row) => toPublicReport(normalize(row))),
    );
  }
  async storageReady(context: AuthorizedContext, bucket: string) {
    return this.db.withIdentity(context.identity, (sql) =>
      this.policy.ready(sql, bucket, "reports"),
    );
  }

  async reserve(
    context: AuthorizedContext,
    clientId: string,
    metadata: ReportMetadata,
    sha256: string,
    size: number,
    pageCount: number,
    bucket: string,
    provider: string,
  ) {
    const reserved = await this.mutations.run(
      context,
      metadata.requestId,
      "report.upload",
      {
        clientId,
        ...metadata,
        sha256,
        size,
        bucket,
        provider,
        ...(this.location ? { namespace: this.location.account } : {}),
      },
      async (client) => {
        if (
          !(
            await client.query(
              "select id from public.profiles where id=$1 and role='client'",
              [clientId],
            )
          ).rows.length
        )
          throw new AppError("NOT_FOUND", "Client not found.", 404);
        const id = randomUUID();
        const path = `${clientId.toLowerCase()}/${id}.pdf`;
        await client.query(
          "insert into public.client_reports(id,client_id,title,storage_path,period_start,period_end,report_date,size_bytes,uploaded_by,file_name,file_sha256,storage_bucket,storage_provider,scanned_at,page_count,storage_namespace) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,clock_timestamp(),$14,$15)",
          [
            id,
            clientId,
            metadata.title,
            path,
            metadata.periodStart,
            metadata.periodEnd,
            metadata.reportDate,
            size,
            context.profile.id,
            metadata.fileName,
            sha256,
            bucket,
            provider,
            pageCount,
            this.location?.account ?? null,
          ],
        );
        return { id };
      },
    );
    const row = await this.find(context, reserved.id);
    if (!row)
      throw new AppError(
        "REPORT_STATE",
        "Report upload state is unavailable.",
        409,
      );
    return row;
  }
  async find(context: AuthorizedContext, id: string) {
    return this.db.withIdentity(context.identity, (client) =>
      this.read(client, id),
    );
  }
  async withDownload<T>(
    context: AuthorizedContext,
    id: string,
    work: (report: StoredReport | null) => Promise<T>,
  ) {
    try {
      return await this.db.withIdentity(context.identity, async (client) => {
        await client.query("select private.lock_active_profile()");
        return work(await this.read(client, id));
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
  async publish(context: AuthorizedContext, id: string) {
    try {
      return await this.db.withIdentity(context.identity, async (client) => {
        await client.query(
          "update public.client_reports set status='available' where id=$1 and status='quarantined'",
          [id],
        );
        const report = await this.read(client, id);
        if (!report || report.status !== "available")
          throw new AppError(
            "REPORT_STATE",
            "The upload was archived or is no longer publishable.",
            409,
          );
        return toPublicReport(report);
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
  async archive(
    context: AuthorizedContext,
    id: string,
    requestId: string,
    expectedStatus: "quarantined" | "available",
  ) {
    return this.mutations.run(
      context,
      requestId,
      "report.archive",
      { id, expectedStatus },
      async (client) => {
        const result = await client.query(
          "update public.client_reports set status='archived' where id=$1 and status=$2 returning id",
          [id, expectedStatus],
        );
        if (!result.rows.length)
          throw new AppError(
            "STALE_REPORT",
            "This report changed or is unavailable. Refresh before archiving.",
            409,
          );
        return toPublicReport((await this.read(client, id))!);
      },
    );
  }
}
