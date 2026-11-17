import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  offerImageSchema,
  removeOfferImageSchema,
} from "@/lib/offer-image-inputs";
import type {
  AuthorizationService,
  AuthorizedContext,
} from "../identity/authorization-service";
import type { MalwareScanner } from "../reports/report-contracts";
import type { RateLimiter } from "@/server/contracts";
import type {
  OfferImageRepository,
  OfferImageStorage,
  ImageProcessor,
  StoredOfferImage,
} from "./image-contracts";
import { AppError } from "@/server/errors";
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export class OfferImageService {
  constructor(
    private readonly auth: AuthorizationService,
    private readonly repository: OfferImageRepository,
    private readonly storage: OfferImageStorage,
    private readonly scanner: MalwareScanner,
    private readonly processor: ImageProcessor,
    private readonly limits: RateLimiter,
    private readonly options: {
      bucket: string;
      provider: string;
      maxBytes: number;
      namespace?: string;
    },
  ) {}
  private id(id: string) {
    if (!z.uuid().safeParse(id).success)
      throw new AppError("NOT_FOUND", "Offer image not found.", 404);
  }
  private async ready(context: AuthorizedContext | null) {
    if (!(await this.repository.storageReady(context, this.options.bucket)))
      throw new AppError(
        "STORAGE_CONFIGURATION",
        "Private image storage policy is not configured.",
        503,
      );
    await this.storage.verifyConfiguration();
  }
  private async cleanup(image: StoredOfferImage) {
    try {
      await this.storage.remove(image.storagePath);
    } catch {
      /* Aborted metadata prevents publication; operators can retry cleanup. */
    }
  }
  async upload(
    offerId: string,
    raw: unknown,
    bytes: Uint8Array,
    contentType: string,
  ) {
    const context = await this.auth.requireAdmin();
    this.id(offerId);
    const input = offerImageSchema.safeParse(raw);
    if (!input.success)
      throw new AppError(
        "INVALID_INPUT",
        "Supply image alt text, current version and a submission key.",
        422,
      );
    const png =
      bytes.length >= 8 &&
      Buffer.from(bytes.subarray(0, 8)).equals(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (
      bytes.length === 0 ||
      bytes.length > this.options.maxBytes ||
      !(
        (contentType === "image/png" && png) ||
        (contentType === "image/jpeg" && jpeg)
      )
    )
      throw new AppError(
        "INVALID_IMAGE",
        "Upload a PNG or JPEG within the configured size limit.",
        422,
      );
    if (
      !(await this.limits.consume(`offer-image:${context.profile.id}`, 10, 60))
    )
      throw new AppError(
        "RATE_LIMITED",
        "Too many image uploads. Please wait and retry.",
        429,
      );
    await this.repository.validateOffer(context, offerId);
    await this.ready(context);
    await this.scanner.scan(bytes);
    const normalized = await this.processor.normalize(bytes);
    await this.scanner.scan(normalized.bytes);
    const checksum = hash(normalized.bytes);
    const image = await this.repository.reserve(
      context,
      offerId,
      input.data,
      hash(bytes),
      checksum,
      normalized,
      this.options.bucket,
      this.options.provider,
    );
    // Reservation replays hold initial metadata; reload activation handles already completed work.
    if (image.status === "aborted")
      throw new AppError(
        "UPLOAD_ABORTED",
        "This upload was abandoned. Refresh and start a new submission.",
        409,
      );
    if (
      image.storageBucket !== this.options.bucket ||
      image.storageProvider !== this.options.provider ||
      (image.storageNamespace ?? null) !== (this.options.namespace ?? null)
    )
      throw new AppError(
        "STORAGE_CONFIGURATION",
        "Image storage profile changed. Operator review is required.",
        503,
      );
    if (image.status === "ready") {
      const offer = await this.repository.activate(context, image.id);
      if (!offer)
        throw new AppError(
          "FORBIDDEN",
          "The completed upload is unavailable.",
          403,
        );
      return { offer, current: offer.image?.id === image.id };
    }
    await this.storage.putIfAbsent(image.storagePath, normalized.bytes);
    if (
      hash(await this.storage.read(image.storagePath, image.sizeBytes)) !==
      checksum
    ) {
      if (await this.repository.abort(context, image.id))
        await this.cleanup(image);
      throw new AppError(
        "IMAGE_CHECKSUM",
        "Stored image verification failed. Refresh and upload again.",
        409,
      );
    }
    const offer = await this.repository.activate(context, image.id);
    if (!offer) {
      if (await this.repository.abort(context, image.id))
        await this.cleanup(image);
      throw new AppError(
        "STALE_RECORD",
        "The offer changed while the image was processing. Refresh and upload again.",
        409,
      );
    }
    return { offer, current: offer.image?.id === image.id };
  }
  async read(offerId: string, admin = false, expectedImageId?: string) {
    this.id(offerId);
    if (expectedImageId !== undefined) this.id(expectedImageId);
    const context = admin ? await this.auth.requireAdmin() : null;
    const image = await this.repository.current(context, offerId);
    if (
      !image ||
      (expectedImageId !== undefined &&
        image.id !== expectedImageId.toLowerCase())
    )
      throw new AppError("NOT_FOUND", "Offer image not found.", 404);
    if (
      image.storageBucket !== this.options.bucket ||
      image.storageProvider !== this.options.provider ||
      (image.storageNamespace ?? null) !== (this.options.namespace ?? null)
    )
      throw new AppError(
        "STORAGE_CONFIGURATION",
        "Image storage profile is unavailable.",
        503,
      );
    await this.ready(context);
    const bytes = await this.storage.read(image.storagePath, image.sizeBytes);
    if (hash(bytes) !== image.fileSha256)
      throw new AppError("IMAGE_CHECKSUM", "Image verification failed.", 503);
    const current = await this.repository.current(context, offerId);
    if (current?.id !== image.id)
      throw new AppError(
        "NOT_FOUND",
        "Offer image is no longer available.",
        404,
      );
    return bytes;
  }
  async remove(offerId: string, raw: unknown) {
    const context = await this.auth.requireAdmin();
    this.id(offerId);
    const input = removeOfferImageSchema.safeParse(raw);
    if (!input.success)
      throw new AppError("INVALID_INPUT", "Invalid image removal.", 422);
    return this.repository.remove(
      context,
      offerId,
      input.data.requestId,
      input.data.expectedVersion,
    );
  }
}
