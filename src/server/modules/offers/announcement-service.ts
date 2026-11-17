import "server-only";
import { z } from "zod";
import {
  announcementSchema,
  announcementEditSchema,
  announcementReadSchema,
  announcementPageSchema,
  type AnnouncementInput,
  type AnnouncementEditInput,
  type ManagedAnnouncement,
  type ClientAnnouncement,
} from "@/lib/announcement-inputs";
import type {
  AuthorizationService,
  AuthorizedContext,
} from "../identity/authorization-service";
import { AppError } from "@/server/errors";
export interface AnnouncementRepository {
  manage(
    context: AuthorizedContext,
    offset: number,
  ): Promise<ManagedAnnouncement[]>;
  inbox(
    context: AuthorizedContext,
    offset: number,
  ): Promise<ClientAnnouncement[]>;
  save(
    context: AuthorizedContext,
    input: AnnouncementInput | AnnouncementEditInput,
    id?: string,
  ): Promise<ManagedAnnouncement>;
  markRead(
    context: AuthorizedContext,
    id: string,
    version: number,
  ): Promise<{ readVersion: number; readAt: string }>;
}
export class AnnouncementService {
  constructor(
    private readonly auth: AuthorizationService,
    private readonly repository: AnnouncementRepository,
  ) {}
  private page(raw: unknown) {
    const data = announcementPageSchema.safeParse(raw);
    if (!data.success)
      throw new AppError("INVALID_INPUT", "Invalid announcement page.", 422);
    return data.data.offset;
  }
  private async client() {
    const context = await this.auth.requireUser();
    if (context.profile.role !== "client")
      throw new AppError("FORBIDDEN", "Client access is required.", 403);
    return context;
  }
  async manage(raw: unknown = {}) {
    const context = await this.auth.requireAdmin();
    return this.repository.manage(context, this.page(raw));
  }
  async inbox(raw: unknown = {}) {
    const context = await this.client();
    return this.repository.inbox(context, this.page(raw));
  }
  async save(raw: unknown, id?: string) {
    const context = await this.auth.requireAdmin();
    const data = (id ? announcementEditSchema : announcementSchema).safeParse(
      raw,
    );
    if (!data.success || (id !== undefined && !z.uuid().safeParse(id).success))
      throw new AppError(
        "INVALID_INPUT",
        "Check title, message, recipients and version.",
        422,
      );
    return this.repository.save(context, data.data, id);
  }
  async markRead(id: string, raw: unknown) {
    const context = await this.client();
    const data = announcementReadSchema.safeParse(raw);
    if (!z.uuid().safeParse(id).success || !data.success)
      throw new AppError("INVALID_INPUT", "Invalid acknowledgment.", 422);
    return this.repository.markRead(context, id, data.data.expectedVersion);
  }
}
