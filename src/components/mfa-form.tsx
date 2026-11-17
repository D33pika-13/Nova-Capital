"use client";
import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
export function MfaForm() {
  const router = useRouter();
  const [factor, setFactor] = useState<{
    factorId: string;
    enrolled: boolean;
    qrCode?: string;
    setupKey?: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function send(body: unknown) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Please try again.");
      if (result.redirect) {
        router.replace(result.redirect);
        router.refresh();
      } else {
        setFactor(result);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const qr = factor?.qrCode?.startsWith("data:image/svg+xml;")
    ? factor.qrCode
    : null;
  return (
    <div>
      {!factor ? (
        <button
          className="button button-dark"
          disabled={busy}
          onClick={() => send({ action: "setup" })}
        >
          {busy ? "Preparing…" : "Continue with authenticator"}
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send({ action: "verify", factorId: factor.factorId, code });
          }}
        >
          {qr && (
            <>
              <p className="small">
                Scan this QR code with your authenticator app, then enter its
                code.
              </p>
              <Image
                unoptimized
                src={qr}
                width={220}
                height={220}
                alt="Authenticator setup QR code"
              />
            </>
          )}
          {factor?.setupKey && (
            <p className="small">
              On this phone, enter this setup key in your authenticator instead:{" "}
              <code>{factor.setupKey}</code>. Keep it private.
            </p>
          )}
          <div className="field">
            <label htmlFor="mfa-code">Six-digit code</label>
            <input
              id="mfa-code"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <button className="button button-dark" disabled={busy} type="submit">
            {busy ? "Verifying…" : "Verify and continue"}
          </button>
        </form>
      )}
      {error && (
        <p className="error-text form-message" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
