"use client";
import { useRef, useState } from "react";
export function useSubmission() {
  const attempt = useRef<{ fingerprint: string; id: string } | null>(null);
  const active = useRef(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  async function submit<T>(
    url: string,
    body: Record<string, unknown>,
    method = "POST",
  ): Promise<T | null> {
    if (active.current) return null;
    active.current = true;
    setWorking(true);
    setMessage("");
    setError(false);
    const fingerprint = JSON.stringify({ url, method, body });
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, requestId: attempt.current.id }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "The request could not be completed.");
      setMessage(result.message ?? "Saved.");
      return result as T;
    } catch (cause) {
      setError(true);
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Request outcome is unknown. Retry the same submission to check it safely.",
      );
      return null;
    } finally {
      active.current = false;
      setWorking(false);
    }
  }
  return {
    working,
    message,
    error,
    submit,
    newRequest: (clearMessage = true) => {
      attempt.current = null;
      if (clearMessage) setMessage("");
    },
  };
}
