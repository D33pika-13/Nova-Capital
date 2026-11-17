import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MfaProvider } from "@/server/modules/identity/mfa-service";
import { AppError } from "@/server/errors";
export class SupabaseMfaProvider implements MfaProvider {
  constructor(private readonly client: SupabaseClient) {}
  async prepare() {
    const factors = await this.client.auth.mfa.listFactors();
    if (factors.error)
      throw new AppError(
        "MFA_UNAVAILABLE",
        "Could not prepare authentication.",
        503,
      );
    const verified = factors.data.totp.find((f) => f.status === "verified");
    if (verified) return { factorId: verified.id, enrolled: true };
    for (const factor of factors.data.totp.filter(
      (f) => f.status !== "verified",
    )) {
      const result = await this.client.auth.mfa.unenroll({
        factorId: factor.id,
      });
      if (result.error)
        throw new AppError(
          "MFA_UNAVAILABLE",
          "Could not prepare authentication.",
          503,
        );
    }
    const result = await this.client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "NOVA Account",
      issuer: "NOVA CAPITAL",
    });
    if (result.error)
      throw new AppError(
        "MFA_UNAVAILABLE",
        "Could not prepare authentication.",
        503,
      );
    return {
      factorId: result.data.id,
      enrolled: false,
      setupKey: result.data.totp.secret,
      qrCode: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.data.totp.qr_code.replace(/^data:image\/svg\+xml;utf-8,/, ""))}`,
    };
  }
  async verify(factorId: string, code: string) {
    const result = await this.client.auth.mfa.challengeAndVerify({
      factorId,
      code,
    });
    if (result.error)
      throw new AppError(
        "INVALID_CODE",
        "The authentication code could not be verified.",
        400,
      );
  }
}
