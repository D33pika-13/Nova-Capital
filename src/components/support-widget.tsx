"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  supportSuggestions,
  supportMessageSchema,
  type SupportReply,
} from "@/lib/support-inputs";
import { siteConfig } from "@/lib/site-config";
import { formatDate } from "@/lib/format";
type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  reply: SupportReply | null;
};
type Session = { id: string; title: string; updatedAt: string };
export function SupportWidget({ companyName }: { companyName: string }) {
  const pathname = usePathname();
  return <SupportWidgetBody key={pathname} companyName={companyName} />;
}
function SupportWidgetBody({ companyName }: { companyName: string }) {
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState<"public" | "client" | "blocked">(
    "public",
  );
  const [mode, setMode] = useState("faq");
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [hasAttempt, setHasAttempt] = useState(false);
  const generation = useRef(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const attempt = useRef<{
    requestId: string;
    sessionId: string | null;
    message: string;
  } | null>(null);
  const sending = useRef(false);
  const wasWorking = useRef(false);
  async function json(url: string, body?: unknown) {
    const requestGeneration = generation.current;
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      cache: "no-store",
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(
        "Support response could not be confirmed. Retry the same question.",
      );
    }
    if (!response.ok) {
      if (
        (response.status === 401 ||
          response.status === 403 ||
          data.code === "CHAT_UNAVAILABLE") &&
        requestGeneration === generation.current
      ) {
        setMessages([]);
        setSessions([]);
        setSessionId(null);
        if (response.status === 401 || response.status === 403)
          setAudience("blocked");
        attempt.current = null;
        setHasAttempt(false);
      }
      throw new Error(data.error ?? "Support is temporarily unavailable.");
    }
    return data;
  }
  useEffect(() => {
    if (!open) return;
    const current = generation.current;
    void (async () => {
      try {
        const bootstrap = await json("/api/support");
        if (generation.current !== current) return;
        setAudience(bootstrap.audience);
        setMode(bootstrap.mode);
        if (bootstrap.audience === "client") {
          const rows = await json("/api/support/sessions");
          if (generation.current !== current) return;
          setSessions(rows);
          setHasMore(rows.length === 20);
          if (rows[0]) {
            const history = await json(`/api/support/sessions/${rows[0].id}`);
            if (generation.current !== current) return;
            setSessionId(rows[0].id);
            setMessages(history);
          }
        }
      } catch (cause) {
        if (generation.current === current)
          setError(
            cause instanceof Error ? cause.message : "Support is unavailable.",
          );
      } finally {
        if (generation.current === current) setLoading(false);
      }
    })();
  }, [open]);
  useEffect(() => {
    if (open && !loading) textarea.current?.focus();
  }, [open, loading]);
  useEffect(() => {
    const finished = wasWorking.current && !working;
    wasWorking.current = working;
    // Disabling the submitted control can leave focus on body. Restore it only
    // in that case; a response must not steal focus from another control.
    if (
      finished &&
      open &&
      !loading &&
      document.activeElement === document.body
    )
      textarea.current?.focus();
  }, [working, open, loading]);
  useEffect(() => {
    if (transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [messages, working]);
  async function refreshSessions() {
    const current = generation.current;
    const rows = await json("/api/support/sessions");
    if (current !== generation.current) return;
    setHasMore(rows.length === 20);
    setSessions(rows);
    setOffset(0);
  }
  async function send(message: string, retry = false) {
    if (sending.current || loading || audience === "blocked" || !message.trim())
      return;
    const validated = supportMessageSchema.safeParse({ message });
    if (!validated.success) {
      setError(
        "Enter a question up to 2000 characters without credentials or tokens.",
      );
      return;
    }
    const current = generation.current;
    sending.current = true;
    setWorking(true);
    setError("");
    const body =
      retry && attempt.current
        ? attempt.current
        : {
            requestId: crypto.randomUUID(),
            sessionId,
            message: message.trim(),
          };
    attempt.current = body;
    setHasAttempt(true);
    if (!retry)
      setMessages((previous) => [
        ...previous,
        {
          id: body.requestId,
          role: "user",
          content: body.message,
          createdAt: new Date().toISOString(),
          reply: null,
        },
      ]);
    try {
      if (audience === "client") {
        const result = await json("/api/support/messages", body);
        if (current !== generation.current) return;
        const history = await json(`/api/support/sessions/${result.sessionId}`);
        if (current !== generation.current) return;
        setSessionId(result.sessionId);
        setMessages(history);
        await refreshSessions();
        if (current !== generation.current) return;
      } else {
        const reply = await json("/api/support/public", {
          message: body.message,
        });
        if (current !== generation.current) return;
        const now = new Date().toISOString();
        setMessages((previous) => [
          ...previous,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: reply.text,
            createdAt: now,
            reply,
          },
        ]);
      }
      setDraft("");
      attempt.current = null;
      setHasAttempt(false);
    } catch (cause) {
      if (current === generation.current)
        setError(
          cause instanceof Error &&
            !["TypeError", "TimeoutError", "AbortError"].includes(cause.name)
            ? cause.message
            : "Support response could not be confirmed. Retry the same question.",
        );
    } finally {
      if (current === generation.current) {
        setWorking(false);
        sending.current = false;
      }
    }
  }
  function close() {
    generation.current++;
    setOpen(false);
    launcher.current?.focus();
  }
  return (
    <>
      <button
        ref={launcher}
        className="support-launcher button button-dark"
        aria-expanded={open}
        aria-controls="support-panel"
        onClick={() => {
          if (open) close();
          else {
            generation.current++;
            attempt.current = null;
            setHasAttempt(false);
            setMessages([]);
            setSessions([]);
            setSessionId(null);
            setOffset(0);
            setHasMore(false);
            setDraft("");
            setError("");
            setWorking(false);
            sending.current = false;
            setLoading(true);
            setOpen(true);
          }
        }}
      >
        {siteConfig.assistantName}
      </button>
      {open && (
        <section
          id="support-panel"
          className="support-panel"
          role="dialog"
          aria-labelledby="support-title"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
        >
          <header className="support-header">
            <div>
              <h2 id="support-title">
                {siteConfig.assistantName} · {companyName} Support
              </h2>
              <p className="small">
                {mode === "ai"
                  ? "AI-guided, read-only support"
                  : "FAQ-only · personalized AI unavailable"}
              </p>
            </div>
            <button type="button" onClick={close} aria-label="Close support">
              ×
            </button>
          </header>
          {audience === "client" && (
            <div className="support-history">
              <label>
                Conversation
                <select
                  aria-label="Conversation"
                  value={sessionId ?? ""}
                  disabled={working || loading}
                  onChange={async (event) => {
                    const id = event.target.value;
                    const current = ++generation.current;
                    attempt.current = null;
                    setHasAttempt(false);
                    setSessionId(id || null);
                    setMessages([]);
                    setError("");
                    if (id) {
                      setLoading(true);
                      try {
                        const rows = await json(`/api/support/sessions/${id}`);
                        if (generation.current === current) setMessages(rows);
                      } catch (cause) {
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : "History unavailable.",
                        );
                      } finally {
                        setLoading(false);
                      }
                    }
                  }}
                >
                  <option value="">New chat</option>
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.title}
                    </option>
                  ))}
                </select>
              </label>
              {hasMore && (
                <button
                  type="button"
                  disabled={working || loading}
                  onClick={async () => {
                    const current = generation.current;
                    setLoading(true);
                    try {
                      const rows = await json(
                        `/api/support/sessions?offset=${offset + 20}`,
                      );
                      if (current !== generation.current) return;
                      setSessions((previous) => [...previous, ...rows]);
                      setOffset((value) => value + 20);
                      setHasMore(rows.length === 20);
                    } catch {
                      if (current === generation.current)
                        setError("Older conversations are unavailable.");
                    } finally {
                      if (current === generation.current) setLoading(false);
                    }
                  }}
                >
                  Older chats
                </button>
              )}
            </div>
          )}
          <div
            ref={transcript}
            className="support-transcript"
            role="log"
            aria-label="Support conversation"
            aria-live="polite"
          >
            {loading ? (
              <p role="status">Loading support…</p>
            ) : (
              messages.length === 0 && (
                <p>
                  Hello! I’m {siteConfig.assistantName}, your {companyName}{" "}
                  support assistant. How can I assist you today?
                </p>
              )
            )}
            {messages.map((message) => (
              <article
                className={`support-message support-${message.role}`}
                key={message.id}
              >
                <strong>
                  {message.role === "user" ? "You" : siteConfig.assistantName}
                </strong>
                <p>{message.content}</p>
                {message.reply?.links.map((link) => (
                  <Link key={link.href} href={link.href}>
                    {link.label} ↗
                  </Link>
                ))}
                <time dateTime={message.createdAt}>
                  {formatDate(message.createdAt)}
                </time>
              </article>
            ))}
            {working && <p role="status">Preparing a read-only response…</p>}
          </div>
          {messages.length === 0 && !loading && (
            <div className="support-suggestions">
              {supportSuggestions.map((question) => (
                <button
                  key={question}
                  type="button"
                  disabled={working || audience === "blocked"}
                  onClick={() => {
                    setDraft(question);
                    textarea.current?.focus();
                  }}
                >
                  {question}
                </button>
              ))}
            </div>
          )}
          <div className="support-controls">
            <button
              type="button"
              disabled={working || loading}
              onClick={() => {
                generation.current++;
                attempt.current = null;
                setHasAttempt(false);
                setSessionId(null);
                setMessages([]);
                setDraft("");
                setError("");
              }}
            >
              New chat
            </button>
            {audience === "client" && sessionId && (
              <button
                type="button"
                disabled={working || loading}
                onClick={async () => {
                  const current = ++generation.current;
                  setLoading(true);
                  setError("");
                  try {
                    const rows = await json(
                      `/api/support/sessions/${sessionId}`,
                    );
                    if (current !== generation.current) return;
                    setMessages(rows);
                    if (rows.at(-1)?.role === "assistant") {
                      attempt.current = null;
                      setHasAttempt(false);
                    }
                  } catch (cause) {
                    if (current === generation.current)
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "History is unavailable.",
                      );
                  } finally {
                    if (current === generation.current) setLoading(false);
                  }
                }}
              >
                Refresh chat
              </button>
            )}
            <button
              type="button"
              disabled={loading || (audience === "client" && !sessionId)}
              onClick={async () => {
                const current = ++generation.current;
                attempt.current = null;
                setHasAttempt(false);
                setError("");
                setLoading(true);
                sending.current = true;
                try {
                  if (audience === "client" && sessionId)
                    await json(`/api/support/sessions/${sessionId}/clear`, {});
                  if (current !== generation.current) return;
                  setMessages([]);
                  setSessionId(null);
                  setDraft("");
                  if (audience === "client") await refreshSessions();
                } catch (cause) {
                  if (current === generation.current)
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "Chat could not be cleared.",
                    );
                } finally {
                  if (current === generation.current) {
                    setLoading(false);
                    setWorking(false);
                    sending.current = false;
                  }
                }
              }}
            >
              Clear chat
            </button>
          </div>
          {audience === "client" &&
            !working &&
            !loading &&
            messages.at(-1)?.role === "user" && (
              <p role="status" className="support-error">
                The last question is processing or was interrupted. Refresh this
                chat to check, or start a new chat. No automatic model retry
                will occur.
              </p>
            )}
          {error && (
            <p role="alert" className="support-error">
              {error} <Link href="/contact">Contact support</Link>
            </p>
          )}
          {error && hasAttempt && audience !== "blocked" && (
            <button
              type="button"
              disabled={working}
              onClick={() => {
                if (attempt.current) void send(attempt.current.message, true);
              }}
            >
              Retry same question
            </button>
          )}
          <form
            className="support-compose"
            onSubmit={(event) => {
              event.preventDefault();
              void send(draft);
            }}
          >
            <label className="sr-only" htmlFor="support-message">
              Your support question
            </label>
            <textarea
              ref={textarea}
              id="support-message"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={2000}
              rows={2}
              required
              disabled={working || loading || audience === "blocked"}
              placeholder="Ask about the website or your recorded information"
            />
            <button
              className="button button-dark"
              disabled={
                working || loading || audience === "blocked" || !draft.trim()
              }
            >
              Send
            </button>
          </form>
          <p className="support-disclosure small">
            {mode === "ai"
              ? "Your question is sent to the configured AI provider to select a topic. Recorded account facts stay server-side. "
              : ""}
            {audience === "client"
              ? "Client chat is stored privately; historical answers reflect their original reporting dates. "
              : "Public chat lasts while this panel stays open. "}
            Do not include passwords or access tokens.
          </p>
        </section>
      )}
    </>
  );
}
