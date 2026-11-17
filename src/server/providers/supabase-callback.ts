import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthCallbackProvider } from "@/server/modules/identity/callback-service";
import { AppError } from "@/server/errors";

export class SupabaseCallbackProvider implements AuthCallbackProvider {
  constructor(private readonly client: SupabaseClient) {}
  async exchangeCode(code: string, flowId?: string) {
    const result = await this.client.auth.exchangeCodeForSession(
      code,
      flowId ? { flowId } : undefined,
    );
    this.requireSession(result);
  }
  async verifyLink(token: string, purpose: "invite" | "recovery") {
    const result = await this.client.auth.verifyOtp({
      token_hash: token,
      type: purpose,
    });
    this.requireSession(result);
  }
  private requireSession(result: {
    error: unknown;
    data: {
      user: { id: string } | null;
      session: { user: { id: string } } | null;
    };
  }) {
    if (
      result.error ||
      !result.data.user ||
      !result.data.session ||
      result.data.user.id !== result.data.session.user.id
    )
      throw new AppError(
        "INVALID_AUTH_LINK",
        "This secure link is invalid or expired.",
        400,
      );
  }
}
