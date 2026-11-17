import "server-only";
import {
  StorageLocationPolicy,
  type StorageLocation,
} from "./storage-location";
import { randomUUID } from "node:crypto";
import type { Database, SqlClient } from "../database";
import type { AuthorizedContext } from "../modules/identity/authorization-service";
import type {
  OfferImageRepository,
  StoredOfferImage,
  NormalizedImage,
} from "../modules/offers/image-contracts";
import type { OfferImageInput } from "@/lib/offer-image-inputs";
import type { Offer } from "@/lib/offer-inputs";
import { offerColumns } from "./postgres-offers";
import { MutationStore } from "../mutation-store";
import { AppError } from "../errors";
const columns = `i.id,i.offer_id as "offerId",i.storage_path as "storagePath",i.storage_bucket as "storageBucket",i.storage_provider as "storageProvider",i.storage_namespace as "storageNamespace",i.source_sha256 as "sourceSha256",i.file_sha256 as "fileSha256",i.size_bytes as "sizeBytes",i.width,i.height,i.alt,i.expected_version as "expectedVersion",i.status`;
export class PostgresOfferImageRepository implements OfferImageRepository {
  private readonly mutations: MutationStore;
  private readonly policy: StorageLocationPolicy;
  constructor(
    private readonly db: Database,
    private readonly location?: StorageLocation,
  ) {
    this.mutations = new MutationStore(db);
    this.policy = new StorageLocationPolicy(location);
  }
  private async offer(sql: SqlClient, id: string) {
    return (
      await sql.query<Offer>(
        `select ${offerColumns} from public.offers where id=$1`,
        [id],
      )
    ).rows[0];
  }
  async validateOffer(context: AuthorizedContext, id: string) {
    await this.db.withIdentity(context.identity, async (sql) => {
      if (!(await this.offer(sql, id)))
        throw new AppError("NOT_FOUND", "Offer not found.", 404);
    });
  }
  async storageReady(context: AuthorizedContext | null, bucket: string) {
    return this.db.withIdentity(context?.identity ?? null, (sql) =>
      this.policy.ready(sql, bucket, "offer_images"),
    );
  }
  async reserve(
    context: AuthorizedContext,
    offerId: string,
    input: OfferImageInput,
    sourceSha256: string,
    fileSha256: string,
    image: NormalizedImage,
    bucket: string,
    provider: string,
  ) {
    const reservation = await this.mutations.run(
      context,
      input.requestId,
      "offer.image.reserve",
      {
        offerId: offerId.toLowerCase(),
        ...input,
        sourceSha256,
        fileSha256,
        bucket,
        provider,
        ...(this.location ? { namespace: this.location.account } : {}),
        width: image.width,
        height: image.height,
        size: image.bytes.byteLength,
      },
      async (sql) => {
        const offer = await this.offer(sql, offerId);
        if (!offer) throw new AppError("NOT_FOUND", "Offer not found.", 404);
        if (offer.version !== input.expectedVersion)
          throw new AppError(
            "STALE_RECORD",
            "Offer changed. Refresh before uploading an image.",
            409,
          );
        const id = randomUUID();
        return (
          await sql.query<StoredOfferImage>(
            `insert into public.offer_images as i(id,offer_id,storage_path,storage_bucket,storage_provider,source_sha256,file_sha256,size_bytes,width,height,alt,expected_version,created_by,storage_namespace) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning ${columns}`,
            [
              id,
              offerId,
              `${offerId.toLowerCase()}/${id}.webp`,
              bucket,
              provider,
              sourceSha256,
              fileSha256,
              image.bytes.byteLength,
              image.width,
              image.height,
              input.alt,
              input.expectedVersion,
              context.profile.id,
              this.location?.account ?? null,
            ],
          )
        ).rows[0];
      },
    );
    return this.db.withIdentity(context.identity, async (sql) => {
      const row = (
        await sql.query<StoredOfferImage>(
          `select ${columns} from public.offer_images i where i.id=$1`,
          [reservation.id],
        )
      ).rows[0];
      if (!row)
        throw new AppError(
          "FORBIDDEN",
          "Image reservation is unavailable.",
          403,
        );
      return row;
    });
  }
  async activate(context: AuthorizedContext, id: string) {
    return this.db.withIdentity(context.identity, async (sql) => {
      const image = (
        await sql.query<StoredOfferImage>(
          `select ${columns} from public.offer_images i where i.id=$1 for update`,
          [id],
        )
      ).rows[0];
      if (!image || image.status === "aborted") return null;
      const offer = (
        await sql.query<{ version: number }>(
          "select version from public.offers where id=$1 for update",
          [image.offerId],
        )
      ).rows[0];
      if (!offer) return null;
      if (image.status === "ready")
        return (await this.offer(sql, image.offerId)) ?? null;
      if (offer.version !== image.expectedVersion) return null;
      await sql.query(
        "update public.offer_images set status='ready' where id=$1",
        [id],
      );
      await sql.query("update public.offers set image_id=$2 where id=$1", [
        image.offerId,
        id,
      ]);
      return (await this.offer(sql, image.offerId))!;
    });
  }
  async abort(context: AuthorizedContext, id: string) {
    return this.db.withIdentity(context.identity, async (sql) => {
      const row = (
        await sql.query<{ status: string }>(
          "select status from public.offer_images where id=$1 for update",
          [id],
        )
      ).rows[0];
      if (!row || row.status === "ready") return false;
      if (row.status === "quarantined")
        await sql.query(
          "update public.offer_images set status='aborted' where id=$1",
          [id],
        );
      return true;
    });
  }
  async current(context: AuthorizedContext | null, offerId: string) {
    return this.db.withIdentity(
      context?.identity ?? null,
      async (sql) =>
        (
          await sql.query<StoredOfferImage>(
            `select ${columns} from public.offer_images i join public.offers o on o.image_id=i.id and o.id=i.offer_id where o.id=$1 and i.status='ready'`,
            [offerId],
          )
        ).rows[0] ?? null,
    );
  }
  async remove(
    context: AuthorizedContext,
    offerId: string,
    requestId: string,
    expectedVersion: number,
  ) {
    return this.mutations.run(
      context,
      requestId,
      "offer.image.remove",
      { offerId, expectedVersion },
      async (sql) => {
        const row = await sql.query(
          "update public.offers set image_id=null where id=$1 and version=$2 returning id",
          [offerId, expectedVersion],
        );
        if (!row.rows.length)
          throw new AppError(
            "STALE_RECORD",
            "Offer changed or is unavailable. Refresh before removing its image.",
            409,
          );
        return (await this.offer(sql, offerId))!;
      },
    );
  }
}
