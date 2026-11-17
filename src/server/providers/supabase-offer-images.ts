import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OfferImageStorage } from "../modules/offers/image-contracts";
import { AppError } from "../errors";
export class SupabaseOfferImageStorage implements OfferImageStorage {
  constructor(
    private readonly client: SupabaseClient,
    private readonly bucket: string,
    private readonly maximumBytes: number,
  ) {}
  private path(path: string) {
    const parts = path.split("/");
    if (
      parts.length !== 2 ||
      !z.uuid().safeParse(parts[0]).success ||
      !parts[1].endsWith(".webp") ||
      !z.uuid().safeParse(parts[1].slice(0, -5)).success
    )
      throw new AppError("INVALID_PATH", "Invalid image storage path.", 422);
  }
  async verifyConfiguration() {
    const { data, error } = await this.client.storage.getBucket(this.bucket);
    if (
      error ||
      !data ||
      data.public !== false ||
      data.allowed_mime_types?.length !== 1 ||
      data.allowed_mime_types[0] !== "image/webp" ||
      !data.file_size_limit ||
      Number(data.file_size_limit) < this.maximumBytes ||
      Number(data.file_size_limit) > 5242880
    )
      throw new AppError(
        "STORAGE_CONFIGURATION",
        "Private image storage is not configured correctly.",
        503,
      );
  }
  async putIfAbsent(path: string, bytes: Uint8Array) {
    this.path(path);
    if (
      bytes.length < 12 ||
      bytes.length > this.maximumBytes ||
      Buffer.from(bytes.subarray(0, 4)).toString("ascii") !== "RIFF" ||
      Buffer.from(bytes.subarray(8, 12)).toString("ascii") !== "WEBP"
    )
      throw new AppError("INVALID_IMAGE", "Invalid normalized image.", 422);
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(path, bytes, {
        contentType: "image/webp",
        upsert: false,
        cacheControl: "0",
      });
    if (
      error &&
      !(
        ("code" in error &&
          ["ResourceAlreadyExists", "Duplicate"].includes(
            String(error.code),
          )) ||
        ("statusCode" in error &&
          ["409", "400"].includes(String(error.statusCode)) &&
          /already exists|duplicate/i.test(error.message))
      )
    )
      throw new AppError(
        "STORAGE_UPLOAD",
        "Image upload could not be confirmed. Retry the same file and submission.",
        503,
      );
  }
  async read(path: string, maxBytes: number) {
    this.path(path);
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 5242880)
      throw new AppError("INVALID_IMAGE", "Invalid image size.", 422);
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .download(path);
    if (error || !data || data.size > maxBytes || data.size === 0)
      throw new AppError(
        "STORAGE_READ",
        "Stored image could not be verified.",
        503,
      );
    return new Uint8Array(await data.arrayBuffer());
  }
  async remove(path: string) {
    this.path(path);
    const { error } = await this.client.storage
      .from(this.bucket)
      .remove([path]);
    if (error)
      throw new AppError(
        "STORAGE_CLEANUP",
        "Abandoned image cleanup could not be completed.",
        503,
      );
  }
}
