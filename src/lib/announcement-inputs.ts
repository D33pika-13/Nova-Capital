import { z } from "zod";
const fields = {
  requestId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  status: z.enum(["draft", "published", "archived"]),
  clientIds: z
    .array(z.uuid().transform((v) => v.toLowerCase()))
    .min(1)
    .max(200)
    .refine((v) => new Set(v).size === v.length, "Select each recipient once.")
    .transform((v) => v.sort()),
};
export const announcementSchema = z.object(fields).strict();
export const announcementEditSchema = z
  .object({ ...fields, expectedVersion: z.number().int().positive() })
  .strict();
export const announcementReadSchema = z
  .object({ requestId: z.uuid(), expectedVersion: z.number().int().positive() })
  .strict();
export const announcementPageSchema = z
  .object({ offset: z.coerce.number().int().min(0).max(1000000).default(0) })
  .strict();
export type AnnouncementInput = z.infer<typeof announcementSchema>;
export type AnnouncementEditInput = z.infer<typeof announcementEditSchema>;
export interface ClientAnnouncement {
  id: string;
  title: string;
  body: string;
  version: number;
  updatedAt: string;
  readVersion: number;
  readAt: string | null;
}
export interface AnnouncementRecipient {
  id: string;
  clientId: string;
  displayName: string;
  status: "active" | "suspended" | "deactivated";
  readVersion: number;
  readAt: string | null;
}
export interface ManagedAnnouncement {
  id: string;
  title: string;
  body: string;
  status: "draft" | "published" | "archived";
  version: number;
  updatedAt: string;
  recipients: AnnouncementRecipient[];
}
