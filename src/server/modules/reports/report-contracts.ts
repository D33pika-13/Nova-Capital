import "server-only";
import type { AuthorizedContext } from "@/server/modules/identity/authorization-service";
import type { ReportRecord } from "@/lib/models";
import type { z } from "zod";
import type { reportMetadataSchema } from "@/lib/report-inputs";
export type ReportMetadata = z.infer<typeof reportMetadataSchema>;
export interface MalwareScanner {
  scan(bytes: Uint8Array): Promise<void>;
}
export interface PdfValidator {
  validate(bytes: Uint8Array): Promise<{ pageCount: number }>;
}
export interface StoredReport extends ReportRecord {
  storagePath: string;
  storageProvider: string;
  storageBucket: string;
  storageNamespace?: string | null;
  fileSha256: string | null;
}
export interface ReportRepository {
  validateClient(context: AuthorizedContext, clientId: string): Promise<void>;
  abortCorrupt(context: AuthorizedContext, id: string): Promise<boolean>;
  list(context: AuthorizedContext, clientId: string): Promise<ReportRecord[]>;
  reserve(
    context: AuthorizedContext,
    clientId: string,
    metadata: ReportMetadata,
    sha256: string,
    size: number,
    pageCount: number,
    bucket: string,
    provider: string,
  ): Promise<StoredReport>;
  withDownload<T>(
    context: AuthorizedContext,
    id: string,
    work: (report: StoredReport | null) => Promise<T>,
  ): Promise<T>;
  find(context: AuthorizedContext, id: string): Promise<StoredReport | null>;
  publish(context: AuthorizedContext, id: string): Promise<ReportRecord>;
  archive(
    context: AuthorizedContext,
    id: string,
    requestId: string,
    expectedStatus: "quarantined" | "available",
  ): Promise<ReportRecord>;
  storageReady(context: AuthorizedContext, bucket: string): Promise<boolean>;
}

export function toPublicReport(report: StoredReport): ReportRecord {
  return {
    id: report.id,
    clientId: report.clientId,
    title: report.title,
    fileName: report.fileName,
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
    reportDate: report.reportDate,
    status: report.status,
    sizeBytes: report.sizeBytes,
    pageCount: report.pageCount,
    createdAt: report.createdAt,
    publishedAt: report.publishedAt,
    downloadable: report.downloadable,
  };
}
