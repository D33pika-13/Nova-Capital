import "server-only";
import { z } from "zod";
import {
  offerSchema,
  offerEditSchema,
  type Offer,
  type OfferInput,
  type OfferEditInput,
} from "@/lib/offer-inputs";
import type {
  AuthorizationService,
  AuthorizedContext,
} from "../identity/authorization-service";
import { AppError } from "@/server/errors";
export interface OfferRepository {
  list(context: AuthorizedContext | null): Promise<Offer[]>;
  save(
    context: AuthorizedContext,
    input: OfferInput | OfferEditInput,
    id?: string,
  ): Promise<Offer>;
}
export class OfferService {
  constructor(
    private readonly auth: AuthorizationService,
    private readonly repository: OfferRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async current() {
    return this.repository.list(null);
  }
  async manage() {
    return this.repository.list(await this.auth.requireAdmin());
  }
  async save(raw: unknown, id?: string) {
    const context = await this.auth.requireAdmin();
    if (id !== undefined && !z.uuid().safeParse(id).success)
      throw new AppError("INVALID_INPUT", "Invalid offer identifier.", 422);
    const parsed = (id ? offerEditSchema : offerSchema).safeParse(raw);
    if (!parsed.success)
      throw new AppError(
        "INVALID_INPUT",
        "Check offer content, validity dates and submission key.",
        422,
      );
    if (
      parsed.data.status === "published" &&
      new Date(parsed.data.endsAt) <= this.now()
    )
      throw new AppError(
        "INVALID_INPUT",
        "An ended offer cannot be published. Update its validity first.",
        422,
      );
    return this.repository.save(context, parsed.data, id);
  }
}
