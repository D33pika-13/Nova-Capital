"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Factor = { enrolled: boolean; secret?: string; issuer?: string };
const recoveryPattern = /^[A-Fa-f0-9]{4}(?:-[A-Fa-f0-9]{4}){7}$/;

/** Selected Entra MFA entry, with secrets retained only in current component state. */
export function EntraMfaForm() {
  const router = useRouter();
  const [factor, setFactor] = useState<Factor | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  function continueToAdmin() {
    setCodes(null);
    setFactor(null);
    setCode("");
    router.replace("/admin");
    router.refresh();
  }
  async function send(action: "setup" | "verify" | "recover") {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/mfa", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        cache: "no-store",
        body: JSON.stringify(
          action === "setup" ? { action } : { action, code },
        ),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(
          result.code === "MFA_DENIED"
            ? "The code could not be verified. Try a current code, or sign in again."
            : result.code === "RATE_LIMITED"
              ? "Too many attempts. Please try again later."
              : "Verification is unavailable. Please try again or sign in again.",
        );
        return;
      }
      if (action === "setup") {
        if (result.enrolled === true) setFactor({ enrolled: true });
        else if (
          result.enrolled === false &&
          typeof result.provisioningUri === "string"
        ) {
          const uri = new URL(result.provisioningUri);
          const secret = uri.searchParams.get("secret"),
            issuer = uri.searchParams.get("issuer");
          if (
            uri.protocol !== "otpauth:" ||
            uri.hostname !== "totp" ||
            !secret ||
            !/^[A-Z2-7]{32}$/.test(secret) ||
            !issuer ||
            issuer.length > 64
          )
            throw Error("setup");
          setFactor({ enrolled: false, secret, issuer });
        } else throw Error("setup");
      } else if (result.recoveryCodes === null) continueToAdmin();
      else if (
        action === "verify" &&
        Array.isArray(result.recoveryCodes) &&
        result.recoveryCodes.length === 10 &&
        new Set(result.recoveryCodes).size === 10 &&
        result.recoveryCodes.every(
          (value: unknown) =>
            typeof value === "string" && recoveryPattern.test(value),
        )
      ) {
        setFactor(null);
        setSaved(false);
        setCodes(result.recoveryCodes);
      } else throw Error("verification");
    } catch {
      setError(
        "Verification could not be confirmed. Please sign in again if the problem continues.",
      );
    } finally {
      setCode("");
      setBusy(false);
      inFlight.current = false;
    }
  }
  function switchMode(value: boolean) {
    setRecovery(value);
    setFactor(null);
    setCode("");
    setError("");
  }
  if (codes)
    return (
      <RecoveryCodeConfirmation
        codes={codes}
        saved={saved}
        onSaved={setSaved}
        onContinue={continueToAdmin}
      />
    );
  return (
    <div aria-busy={busy}>
      {!factor && !recovery ? (
        <button
          className="button button-dark"
          disabled={busy}
          type="button"
          onClick={() => void send("setup")}
        >
          {busy ? "Preparing…" : "Continue with authenticator"}
        </button>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send(recovery ? "recover" : "verify");
          }}
        >
          {factor && !factor.enrolled && (
            <div>
              <p>Add a new time-based account in your authenticator app.</p>
              <p>
                Issuer: <strong>{factor.issuer}</strong>
              </p>
              <p>
                Enter this setup key. Use SHA-1, six digits and a 30-second
                interval.
              </p>
              <p>
                <code style={{ overflowWrap: "anywhere" }}>
                  {factor.secret}
                </code>
              </p>
              <p className="small">
                Keep this key private. Setup expires after ten minutes.
              </p>
            </div>
          )}
          {recovery && (
            <p>
              Enter one unused recovery code. A successful verification consumes
              it.
            </p>
          )}
          <div className="field">
            <label htmlFor="entra-mfa-code">
              {recovery ? "Recovery code" : "Six-digit code"}
            </label>
            <input
              id="entra-mfa-code"
              type={recovery ? "password" : "text"}
              autoComplete={recovery ? "off" : "one-time-code"}
              autoCapitalize="none"
              spellCheck={false}
              inputMode={recovery ? "text" : "numeric"}
              pattern={
                recovery ? "[A-Fa-f0-9]{4}(-[A-Fa-f0-9]{4}){7}" : "[0-9]{6}"
              }
              maxLength={recovery ? 39 : 6}
              required
              value={code}
              disabled={busy}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          <button className="button button-dark" disabled={busy} type="submit">
            {busy ? "Verifying…" : "Verify and continue"}
          </button>
        </form>
      )}
      <p>
        <button
          type="button"
          className="button button-outline"
          disabled={busy}
          onClick={() => switchMode(!recovery)}
        >
          {recovery ? "Use authenticator" : "Use a recovery code"}
        </button>
      </p>
      {error && (
        <p className="error-text form-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function RecoveryCodeConfirmation({
  codes,
  saved,
  onSaved,
  onContinue,
}: {
  codes: readonly string[];
  saved: boolean;
  onSaved: (value: boolean) => void;
  onContinue: () => void;
}) {
  return (
    <section aria-label="Save recovery codes">
      <h2>Save your recovery codes</h2>
      <p>
        These codes are shown once. Store them in a secure password manager or a
        safe offline location. Each code can be used once.
      </p>
      <ol>
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ol>
      <p className="small">
        Do not send these codes to support. This page does not save them in
        browser storage.
      </p>
      <label>
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => onSaved(event.target.checked)}
        />{" "}
        I have saved my recovery codes securely.
      </label>
      <p>
        <button
          type="button"
          className="button button-dark"
          disabled={!saved}
          onClick={onContinue}
        >
          Continue to administrator dashboard
        </button>
      </p>
    </section>
  );
}

/** Self-service lifecycle UI; future protected security page selects the action. */
export function EntraMfaManagementForm({
  action,
}: {
  action: "regenerate" | "remove";
}) {
  const router = useRouter();
  const [recovery, setRecovery] = useState(false),
    [code, setCode] = useState("");
  const [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const inFlight = useRef(false);
  function go(path: "/admin" | "/login") {
    setCodes(null);
    setCode("");
    router.replace(path);
    router.refresh();
  }
  async function submit() {
    if (inFlight.current || (action === "remove" && !confirmed)) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/mfa", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        cache: "no-store",
        body: JSON.stringify({
          action,
          method: recovery ? "recovery" : "totp",
          code,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(
          result.code === "MFA_DENIED"
            ? "Sign in again, then use a new authenticator code or an unused recovery code."
            : "This change could not be confirmed. Please sign in again and try later.",
        );
        return;
      }
      if (action === "remove") {
        if (result.removed !== true) throw Error("removal");
        go("/login");
        return;
      }
      if (
        !Array.isArray(result.recoveryCodes) ||
        result.recoveryCodes.length !== 10 ||
        new Set(result.recoveryCodes).size !== 10 ||
        !result.recoveryCodes.every(
          (value: unknown) =>
            typeof value === "string" && recoveryPattern.test(value),
        )
      )
        throw Error("recovery");
      setCodes(result.recoveryCodes);
      setSaved(false);
    } catch {
      setError(
        "This change could not be confirmed. Sign in again before retrying. A completed change may already have invalidated earlier codes or sessions.",
      );
    } finally {
      setCode("");
      setBusy(false);
      inFlight.current = false;
    }
  }
  if (codes)
    return (
      <RecoveryCodeConfirmation
        codes={codes}
        saved={saved}
        onSaved={setSaved}
        onContinue={() => go("/admin")}
      />
    );
  return (
    <section
      aria-busy={busy}
      aria-label={
        action === "remove" ? "Remove authenticator" : "Replace recovery codes"
      }
    >
      <h2>
        {action === "remove"
          ? "Remove authenticator"
          : "Replace recovery codes"}
      </h2>
      <p>
        Sign in within the last ten minutes, then verify with a new
        authenticator code or an unused recovery code.
      </p>
      <p>
        {action === "remove"
          ? "This removes your authenticator and recovery codes and signs out all sessions for this application. Your next sign-in requires authenticator setup again."
          : "This invalidates all previous recovery codes and signs out your other sessions for this application. Save the replacement codes when shown."}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label htmlFor={`entra-${action}-method`}>Verification method</label>
          <select
            id={`entra-${action}-method`}
            disabled={busy}
            value={recovery ? "recovery" : "totp"}
            onChange={(event) => {
              setRecovery(event.target.value === "recovery");
              setCode("");
              setError("");
            }}
          >
            <option value="totp">Authenticator</option>
            <option value="recovery">Recovery code</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={`entra-${action}-code`}>
            {recovery ? "Unused recovery code" : "New six-digit code"}
          </label>
          <input
            id={`entra-${action}-code`}
            type={recovery ? "password" : "text"}
            autoComplete={recovery ? "off" : "one-time-code"}
            autoCapitalize="none"
            spellCheck={false}
            inputMode={recovery ? "text" : "numeric"}
            pattern={
              recovery ? "[A-Fa-f0-9]{4}(-[A-Fa-f0-9]{4}){7}" : "[0-9]{6}"
            }
            maxLength={recovery ? 39 : 6}
            required
            value={code}
            disabled={busy}
            onChange={(event) => setCode(event.target.value)}
          />
        </div>
        {action === "remove" && (
          <p>
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(event) => setConfirmed(event.target.checked)}
              />{" "}
              Remove my authenticator and sign out all sessions for this
              application.
            </label>
          </p>
        )}
        <button
          type="submit"
          className="button button-dark"
          disabled={busy || (action === "remove" && !confirmed)}
        >
          {busy
            ? "Verifying…"
            : action === "remove"
              ? "Verify and remove authenticator"
              : "Verify and replace codes"}
        </button>
      </form>
      {error && (
        <p role="alert" className="error-text form-message">
          {error}
        </p>
      )}
    </section>
  );
}
