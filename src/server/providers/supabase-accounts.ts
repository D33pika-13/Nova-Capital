import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountInvitationProvider } from "@/server/modules/clients/invitation-service";
import { AppError } from "@/server/errors";
export class SupabaseAccountInvitationProvider implements AccountInvitationProvider {
  constructor(
    private readonly client: SupabaseClient,
    private readonly appUrl: string,
  ) {}
  async prepare(
    email: string,
    subject: string | null,
    purpose: "setup" | "reset",
  ) {
    let type: "invite" | "recovery" =
      subject || purpose === "reset" ? "recovery" : "invite";
    let result = await this.client.auth.admin.generateLink({ type, email });
    if (
      type === "invite" &&
      result.error &&
      ["email_exists", "user_already_exists"].includes(result.error.code ?? "")
    ) {
      type = "recovery";
      result = await this.client.auth.admin.generateLink({ type, email });
    }
    if (
      result.error ||
      !result.data.user ||
      !result.data.properties?.hashed_token
    )
      throw new AppError(
        "INVITATION_PROVIDER",
        "Could not prepare a secure invitation.",
        503,
      );
    const user = result.data.user;
    if (
      user.email?.toLowerCase() !== email.toLowerCase() ||
      (subject && subject !== user.id)
    )
      throw new AppError(
        "IDENTITY_CONFLICT",
        "The account identity does not match this client.",
        409,
      );
    const link = new URL("/auth/callback", this.appUrl);
    link.searchParams.set("token_hash", result.data.properties.hashed_token);
    link.searchParams.set("type", type === "invite" ? "invite" : "recovery");
    return { subject: user.id, provider: "supabase", link: link.toString() };
  }
}
