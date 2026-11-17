import "server-only";
import type { AuthorizedContext } from "../identity/authorization-service";
import type { Offer } from "@/lib/offer-inputs";
import type { OfferImageInput } from "@/lib/offer-image-inputs";
export interface NormalizedImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}
export interface ImageProcessor {
  normalize(bytes: Uint8Array): Promise<NormalizedImage>;
}
export interface OfferImageStorage {
  verifyConfiguration(): Promise<void>;
  putIfAbsent(path: string, bytes: Uint8Array): Promise<void>;
  read(path: string, maxBytes: number): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
}
export interface StoredOfferImage {
  id: string;
  offerId: string;
  storagePath: string;
  storageBucket: string;
  storageNamespace?: string | null;
  storageProvider: string;
  sourceSha256: string;
  fileSha256: string;
  sizeBytes: number;
  width: number;
  height: number;
  alt: string;
  expectedVersion: number;
  status: "quarantined" | "ready" | "aborted";
}
export interface OfferImageRepository {
  validateOffer(context: AuthorizedContext, id: string): Promise<void>;
  storageReady(
    context: AuthorizedContext | null,
    bucket: string,
  ): Promise<boolean>;
  reserve(
    context: AuthorizedContext,
    offerId: string,
    input: OfferImageInput,
    sourceSha256: string,
    fileSha256: string,
    image: NormalizedImage,
    bucket: string,
    provider: string,
  ): Promise<StoredOfferImage>;
  activate(context: AuthorizedContext, id: string): Promise<Offer | null>;
  abort(context: AuthorizedContext, id: string): Promise<boolean>;
  current(
    context: AuthorizedContext | null,
    offerId: string,
  ): Promise<StoredOfferImage | null>;
  remove(
    context: AuthorizedContext,
    offerId: string,
    requestId: string,
    expectedVersion: number,
  ): Promise<Offer>;
}
