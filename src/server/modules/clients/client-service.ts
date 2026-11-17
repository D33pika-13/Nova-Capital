import "server-only";
import { z } from "zod";
import type { ClientRecord } from "@/lib/models";
import type {
  AuthorizedContext,
  AuthorizationService,
} from "@/server/modules/identity/authorization-service";
import { AppError } from "@/server/errors";
export interface ClientRepository {
  list(
    context: AuthorizedContext,
    query: string,
    status: string,
    offset: number,
  ): Promise<ClientRecord[]>;
  get(context: AuthorizedContext, id: string): Promise<ClientRecord | null>;
  create(
    context: AuthorizedContext,
    input: CreateClient,
  ): Promise<ClientRecord>;
  update(
    context: AuthorizedContext,
    id: string,
    input: UpdateClient,
  ): Promise<ClientRecord>;
  addNote(
    context: AuthorizedContext,
    id: string,
    requestId: string,
    note: string,
  ): Promise<{ id: string }>;
  notes(
    context: AuthorizedContext,
    id: string,
  ): Promise<{ id: string; note: string; createdAt: string }[]>;
  metrics(context: AuthorizedContext): Promise<{
    totalClients: number;
    activeClients: number;
    investmentRecords: number;
    latestActivity: { entity: string; action: string; createdAt: string }[];
  }>;
}
export const createClientSchema = z
  .object({
    requestId: z.uuid(),
    displayName: z.string().trim().min(1).max(150),
    email: z
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    clientId: z
      .string()
      .regex(/^INV-[0-9]{4,12}$/)
      .optional(),
  })
  .strict();
export const updateClientSchema = z
  .object({
    requestId: z.uuid(),
    displayName: z.string().trim().min(1).max(150),
    status: z.enum(["active", "suspended", "deactivated"]),
    expectedUpdatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type CreateClient = z.infer<typeof createClientSchema>;
export type UpdateClient = z.infer<typeof updateClientSchema>;
export class ClientService {
  constructor(
    private readonly auth: AuthorizationService,
    private readonly repository: ClientRepository,
  ) {}
  async list(input: unknown = {}) {
    const context = await this.auth.requireAdmin();
    const data = z
      .object({
        query: z.string().trim().max(150).default(""),
        status: z
          .enum(["all", "active", "suspended", "deactivated"])
          .default("all"),
        offset: z.coerce.number().int().min(0).max(1000000).default(0),
      })
      .strict()
      .safeParse(input);
    if (!data.success)
      throw new AppError("INVALID_INPUT", "Invalid client search.", 422);
    return this.repository.list(
      context,
      data.data.query,
      data.data.status,
      data.data.offset,
    );
  }
  async get(id: string) {
    const context = await this.auth.requireAdmin();
    if (!z.uuid().safeParse(id).success)
      throw new AppError("NOT_FOUND", "Client not found.", 404);
    const client = await this.repository.get(context, id);
    if (!client) throw new AppError("NOT_FOUND", "Client not found.", 404);
    return client;
  }
  async create(input: unknown) {
    const context = await this.auth.requireAdmin();
    const data = createClientSchema.safeParse(input);
    if (!data.success)
      throw new AppError(
        "INVALID_INPUT",
        "Enter a valid name, email and optional INV client ID.",
        422,
      );
    return this.repository.create(context, data.data);
  }
  async update(id: string, input: unknown) {
    const context = await this.auth.requireAdmin();
    const data = updateClientSchema.safeParse(input);
    if (!z.uuid().safeParse(id).success || !data.success)
      throw new AppError(
        "INVALID_INPUT",
        "Invalid client update. Refresh and try again.",
        422,
      );
    return this.repository.update(context, id, data.data);
  }
  async addNote(id: string, input: unknown) {
    const context = await this.auth.requireAdmin();
    const data = z
      .object({ requestId: z.uuid(), note: z.string().trim().min(1).max(5000) })
      .strict()
      .safeParse(input);
    if (!z.uuid().safeParse(id).success || !data.success)
      throw new AppError(
        "INVALID_INPUT",
        "Enter a valid administrative note.",
        422,
      );
    return this.repository.addNote(
      context,
      id,
      data.data.requestId,
      data.data.note,
    );
  }
  async notes(id: string) {
    const context = await this.auth.requireAdmin();
    if (!z.uuid().safeParse(id).success)
      throw new AppError("NOT_FOUND", "Client not found.", 404);
    return this.repository.notes(context, id);
  }
  async metrics() {
    return this.repository.metrics(await this.auth.requireAdmin());
  }
}
