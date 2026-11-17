"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
const schema = z.object({
  email: z.email(),
  password: z.string().min(1).max(512),
});
type Fields = z.infer<typeof schema>;
export function AuthForm({
  mode = "login",
}: {
  mode?: "login" | "reset" | "password" | "change-password";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Fields>({
    resolver: zodResolver(
      mode === "reset"
        ? schema.extend({ password: z.string() })
        : mode === "password" || mode === "change-password"
          ? schema.extend({
              email: z.string(),
              password: z.string().min(12).max(128),
            })
          : schema,
    ),
    defaultValues: { email: "", password: "" },
  });
  async function submit(data: Fields) {
    setBusy(true);
    setFailed(false);
    setMessage("");
    try {
      const body =
        mode === "reset"
          ? { email: data.email }
          : mode === "password" || mode === "change-password"
            ? { password: data.password }
            : data;
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Please try again.");
      if (result.redirect) {
        router.replace(result.redirect);
        router.refresh();
        return;
      }
      setMessage(result.message);
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "The service is unavailable. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-stack" onSubmit={handleSubmit(submit)} noValidate>
      {mode !== "password" && mode !== "change-password" && (
        <div className="field">
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            {...register("email")}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "email-error" : undefined}
          />
          {errors.email && (
            <span className="error-text" id="email-error">
              Enter a valid email address.
            </span>
          )}
        </div>
      )}
      {mode !== "reset" && (
        <div className="field">
          <label htmlFor="password">
            {mode === "password" || mode === "change-password"
              ? "New password"
              : "Password"}
          </label>
          <input
            id="password"
            type="password"
            autoComplete={
              mode === "password" || mode === "change-password"
                ? "new-password"
                : "current-password"
            }
            {...register("password")}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "password-error" : undefined}
          />
          {errors.password && (
            <span className="error-text" id="password-error">
              {mode === "password" || mode === "change-password"
                ? "Use 12–128 characters."
                : "Enter your password."}
            </span>
          )}
        </div>
      )}
      <button className="button button-dark" disabled={busy} type="submit">
        {busy
          ? "Please wait…"
          : mode === "reset"
            ? "Request reset link"
            : mode === "password" || mode === "change-password"
              ? "Set password"
              : "Sign in →"}
      </button>
      {message && (
        <p
          role="status"
          className={`form-message ${failed ? "error-text" : ""}`}
        >
          {message}
        </p>
      )}
    </form>
  );
}
