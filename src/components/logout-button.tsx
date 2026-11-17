"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function LogoutButton() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try {
      const result = await fetch("/api/auth/logout", { method: "POST" });
      if (!result.ok) throw new Error();
      router.replace("/login");
      router.refresh();
    } catch {
      setMessage("Sign out failed. Please try again.");
      setBusy(false);
    }
  }
  return (
    <div>
      <button
        className="button button-outline"
        onClick={logout}
        disabled={busy}
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {message && (
        <p role="status" className="error-text">
          {message}
        </p>
      )}
    </div>
  );
}
