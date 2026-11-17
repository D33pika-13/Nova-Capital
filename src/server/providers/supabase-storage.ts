import "server-only";
import { z } from "zod";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PrivateStorage } from "@/server/contracts";
import { AppError } from "@/server/errors";
export class SupabasePrivateStorage implements PrivateStorage {
  constructor(
    private readonly client: SupabaseClient,
    private readonly bucket: string,
    private readonly baseUrl: string,
    private readonly maximumBytes: number,
  ) {}
  private path(value: string) {
    if (
      value.split("/").length !== 2 ||
      !z.uuid().safeParse(value.split("/")[0]).success ||
      !value.endsWith(".pdf") ||
      !z.uuid().safeParse(value.split("/")[1].slice(0, -4)).success
    )
      throw new AppError("INVALID_PATH", "Invalid report storage path.", 422);
  }
  async verifyConfiguration() {
    const { data, error } = await this.client.storage.getBucket(this.bucket);
    if (
      error ||
      !data ||
      data.public !== false ||
      !data.allowed_mime_types ||
      data.allowed_mime_types.length !== 1 ||
      data.allowed_mime_types[0] !== "application/pdf" ||
      !data.file_size_limit ||
      Number(data.file_size_limit) < this.maximumBytes ||
      Number(data.file_size_limit) > 10485760
    )
      throw new AppError(
        "STORAGE_CONFIGURATION",
        "Private report storage is not configured correctly.",
        503,
      );
  }
  async putIfAbsent(path: string, body: Uint8Array, contentType: string) {
    this.path(path);
    if (
      body.byteLength > this.maximumBytes ||
      contentType !== "application/pdf"
    )
      throw new AppError(
        "INVALID_UPLOAD",
        "Invalid report upload size or type.",
        422,
      );
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(path, body, { contentType, upsert: false, cacheControl: "0" });
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
        "Upload could not be confirmed. Retry the same file and request; the report remains quarantined.",
        503,
      );
  }
  async checksum(path: string, maxBytes: number) {
    this.path(path);
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .download(path);
    if (error || !data || data.size > Math.min(maxBytes, 10485760))
      throw new AppError(
        "STORAGE_READ",
        "The stored report could not be verified.",
        503,
      );
    return createHash("sha256")
      .update(new Uint8Array(await data.arrayBuffer()))
      .digest("hex");
  }
  async downloadUrl(path: string, expiresIn: number, fileName: string) {
    this.path(path);
    if (
      !Number.isInteger(expiresIn) ||
      expiresIn < 10 ||
      expiresIn > 120 ||
      !/^[^/\\\u0000-\u001f\u007f]+\.pdf$/i.test(fileName)
    )
      throw new AppError("INVALID_EXPIRY", "Invalid download lifetime.", 422);
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(path, expiresIn);
    if (error || !data)
      throw new AppError(
        "STORAGE_LINK",
        "Download is temporarily unavailable.",
        503,
      );
    const url = new URL(data.signedUrl);
    if (
      url.origin !== new URL(this.baseUrl).origin ||
      !url.pathname.startsWith(`/storage/v1/object/sign/${this.bucket}/`)
    )
      throw new AppError(
        "STORAGE_LINK",
        "The download destination could not be verified.",
        503,
      );
    // Append after SDK URL construction to avoid double-encoding Unicode names.
    url.searchParams.set("download", fileName);
    return url.toString();
  }
  async remove(path: string) {
    this.path(path);
    const { error } = await this.client.storage
      .from(this.bucket)
      .remove([path]);
    if (error)
      throw new AppError(
        "STORAGE_CLEANUP",
        "The quarantined object could not be removed.",
        503,
      );
  }
}
