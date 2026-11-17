import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { reportMetadataSchema, reportCalendarDay } from "@/lib/report-inputs";
import type { PrivateStorage, RateLimiter } from "@/server/contracts";
import type {
  AuthorizationService,
  AuthorizedContext,
} from "@/server/modules/identity/authorization-service";
import { toPublicReport } from "./report-contracts";
import type {
  ReportRepository,
  MalwareScanner,
  PdfValidator,
  StoredReport,
} from "./report-contracts";
import { AppError } from "@/server/errors";
export interface ReportSettings {
  bucket: string;
  provider: string;
  maxBytes: number;
  downloadTtl: number;
  reportTimeZone?: string;
  namespace?: string;
}
export class ReportService {
  constructor(
    private readonly auth: AuthorizationService,
    private readonly repository: ReportRepository,
    private readonly storage: PrivateStorage,
    private readonly scanner: MalwareScanner,
    private readonly pdf: PdfValidator,
    private readonly limits: RateLimiter,
    private readonly settings: ReportSettings,
    private readonly now: () => Date = () => new Date(),
  ) {}
  private async verifyStorage(context: AuthorizedContext) {
    if (!(await this.repository.storageReady(context, this.settings.bucket)))
      throw new AppError(
        "STORAGE_POLICY",
        "Private report storage has not passed its policy checks.",
        503,
      );
    await this.storage.verifyConfiguration();
  }
  async adminList(clientId: string) {
    const context = await this.auth.requireAdmin();
    if (!z.uuid().safeParse(clientId).success)
      throw new AppError("NOT_FOUND", "Client not found.", 404);
    return this.repository.list(context, clientId);
  }
  async clientList() {
    const context = await this.auth.requireUser();
    return this.repository.list(context, context.profile.id);
  }
  async upload(
    clientId: string,
    input: unknown,
    file: { mime: string; bytes: Uint8Array },
  ) {
    const context = await this.auth.requireAdmin();
    const metadata = reportMetadataSchema.safeParse(input);
    if (!z.uuid().safeParse(clientId).success || !metadata.success)
      throw new AppError(
        "INVALID_REPORT",
        "Check the title, PDF filename, reporting date and period.",
        422,
      );
    if (
      metadata.data.reportDate >
      reportCalendarDay(
        this.now(),
        this.settings.reportTimeZone ?? "Asia/Kolkata",
      )
    )
      throw new AppError(
        "INVALID_REPORT_DATE",
        "Report dates cannot be in the future.",
        422,
      );
    if (
      file.mime !== "application/pdf" ||
      file.bytes.byteLength < 8 ||
      !Buffer.from(file.bytes.subarray(0, 8))
        .toString("ascii")
        .match(/^%PDF-[12]\.[0-9]/)
    )
      throw new AppError(
        "INVALID_PDF",
        "Upload a PDF file with a valid PDF header.",
        422,
      );
    if (file.bytes.byteLength > this.settings.maxBytes)
      throw new AppError(
        "TOO_LARGE",
        "The PDF exceeds the configured upload limit.",
        413,
      );
    if (
      !(await this.limits.consume(
        `reports:upload:${context.profile.id}`,
        10,
        60,
      ))
    )
      throw new AppError(
        "RATE_LIMITED",
        "Too many report uploads. Try again later.",
        429,
      );
    await this.repository.validateClient(context, clientId);
    await this.verifyStorage(context);
    const sha256 = createHash("sha256").update(file.bytes).digest("hex");
    await this.scanner.scan(file.bytes);
    const { pageCount } = await this.pdf.validate(file.bytes);
    const reserved = await this.repository.reserve(
      context,
      clientId,
      metadata.data,
      sha256,
      file.bytes.byteLength,
      pageCount,
      this.settings.bucket,
      this.settings.provider,
    );
    if (reserved.status === "archived")
      throw new AppError(
        "ARCHIVED_REPORT",
        "This upload was archived. Start a new report request.",
        409,
      );
    this.assertProvider(reserved);
    if (reserved.status === "available") return toPublicReport(reserved);
    // No overwrite: a lost acknowledgement can be retried against the same immutable object.
    await this.storage.putIfAbsent(
      reserved.storagePath,
      file.bytes,
      "application/pdf",
    );
    const storedHash = await this.storage.checksum(
      reserved.storagePath,
      reserved.sizeBytes,
    );
    if (storedHash !== sha256) {
      if (await this.repository.abortCorrupt(context, reserved.id))
        await this.storage.remove(reserved.storagePath).catch(() => {});
      throw new AppError(
        "FILE_INTEGRITY",
        "Stored bytes do not match the validated PDF. Refresh the report status before starting a new upload.",
        503,
      );
    }
    return this.repository.publish(context, reserved.id);
  }
  private assertProvider(report: StoredReport) {
    if (
      report.storageProvider !== this.settings.provider ||
      report.storageBucket !== this.settings.bucket ||
      (report.storageNamespace ?? null) !== (this.settings.namespace ?? null)
    )
      throw new AppError(
        "STORAGE_MIGRATION",
        "This report requires a completed storage migration before access.",
        503,
      );
  }
  async download(id: string) {
    let context = await this.auth.requireUser();
    if (context.profile.role === "admin")
      context = await this.auth.requireAdmin();
    if (!z.uuid().safeParse(id).success)
      throw new AppError("NOT_FOUND", "Report not found.", 404);
    if (
      !(await this.limits.consume(
        `reports:download:${context.profile.id}`,
        30,
        60,
      ))
    )
      throw new AppError(
        "RATE_LIMITED",
        "Too many downloads. Try again later.",
        429,
      );
    const initial = await this.repository.find(context, id);
    if (
      !initial ||
      !initial.downloadable ||
      (context.profile.role !== "admin" && initial.status !== "available")
    )
      throw new AppError(
        "NOT_FOUND",
        "Report not found or not available.",
        404,
      );
    await this.verifyStorage(context);
    return this.repository.withDownload(context, id, async (report) => {
      if (
        !report ||
        !report.downloadable ||
        (context.profile.role !== "admin" && report.status !== "available")
      )
        throw new AppError(
          "NOT_FOUND",
          "Report not found or not available.",
          404,
        );
      this.assertProvider(report);
      if (
        (await this.storage.checksum(report.storagePath, report.sizeBytes)) !==
        report.fileSha256
      )
        throw new AppError(
          "FILE_INTEGRITY",
          "This report failed its integrity check. Contact support.",
          503,
        );
      return this.storage.downloadUrl(
        report.storagePath,
        this.settings.downloadTtl,
        report.fileName,
      );
    });
  }
  async archive(id: string, input: unknown) {
    const context = await this.auth.requireAdmin();
    const parsed = z
      .object({
        requestId: z.uuid(),
        expectedStatus: z.enum(["quarantined", "available"]),
      })
      .strict()
      .safeParse(input);
    if (!z.uuid().safeParse(id).success || !parsed.success)
      throw new AppError(
        "INVALID_REPORT",
        "Invalid report archival request.",
        422,
      );
    return this.repository.archive(
      context,
      id,
      parsed.data.requestId,
      parsed.data.expectedStatus,
    );
  }
}
