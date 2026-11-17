import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { TestDatabase, testAuth, ids } from "./fixtures/database";
import { ChatService } from "@/server/modules/support/chat-service";
import { SupportService } from "@/server/modules/support/support-service";
import { PostgresChatRepository } from "@/server/providers/postgres-chat";
import { PostgresSupportFacts } from "@/server/providers/postgres-support-facts";
import { FinancialCalculator } from "@/server/modules/portfolio/financial-calculator";
import { FaqResponder } from "@/server/modules/support/faq-responder";
import { DisabledSupportPlanner } from "@/server/providers/openai-support";
import type { SupportPlanner } from "@/server/modules/support/support-contracts";
import { AppError } from "@/server/errors";
const db = new TestDatabase();
const repo = new PostgresChatRepository(db);
const allowed = { consume: async () => true };
function engine(
  who: "a" | "b" | "admin" = "a",
  planner: SupportPlanner = new DisabledSupportPlanner(),
) {
  const auth = testAuth(db, who);
  return new ChatService(
    auth,
    repo,
    new SupportService(
      auth,
      new PostgresSupportFacts(db),
      planner,
      allowed,
      new FinancialCalculator(),
      new FaqResponder(),
    ),
    allowed,
    new FaqResponder(),
  );
}
const input = () => ({
  requestId: randomUUID(),
  sessionId: null,
  message: "Where are my funds held?",
});
beforeAll(() => db.initialize(), 20000);
afterAll(() => db.close());
it("uses the injected fallback after an answer failure and replays it without another call", async () => {
  const faq = new FaqResponder();
  const respond = vi.fn(faq.respond.bind(faq));
  const clientAnswer = vi.fn().mockRejectedValue(new Error("synthetic outage"));
  const chat = new ChatService(
    testAuth(db, "a"),
    repo,
    { clientAnswer },
    allowed,
    { guidance: faq.guidance.bind(faq), respond },
  );
  const data = input();
  const result = await chat.send(data);
  expect(result.reply.mode).toBe("fallback");
  expect(respond).toHaveBeenCalledExactlyOnceWith(
    { message: data.message },
    "fallback",
  );
  expect(await chat.send(data)).toEqual(result);
  expect(respond).toHaveBeenCalledTimes(1);
  expect(clientAnswer).toHaveBeenCalledTimes(1);
  expect((await chat.history(result.sessionId)).map((row) => row.role)).toEqual(
    ["user", "assistant"],
  );
});
it.each([401, 403])(
  "does not replace an authorization denial (%s) with FAQ success",
  async (status) => {
    const faq = new FaqResponder();
    const respond = vi.fn(faq.respond.bind(faq));
    const chat = new ChatService(
      testAuth(db, "a"),
      repo,
      {
        clientAnswer: async () => {
          throw new AppError("FORBIDDEN", "Synthetic access denial", status);
        },
      },
      allowed,
      { guidance: faq.guidance.bind(faq), respond },
    );
    await expect(chat.send(input())).rejects.toMatchObject({ status });
    expect(respond).not.toHaveBeenCalled();
  },
);
it("stores ordered own messages and replays completed turns without duplicate history", async () => {
  const chat = engine();
  const data = input();
  const result = await chat.send(data);
  expect(result.reply.mode).toBe("faq");
  expect(await chat.send(data)).toEqual(result);
  const rows = await chat.history(result.sessionId);
  expect(rows.map((row) => row.role)).toEqual(["user", "assistant"]);
  expect(rows[0].content).toBe(data.message);
  expect(rows[1].reply?.text).toContain("broker account");
  await expect(
    chat.send({ ...data, message: "Changed request" }),
  ).rejects.toMatchObject({ status: 409 });
  const follow = await chat.send({
    ...input(),
    sessionId: result.sessionId,
    message: "How do I contact support?",
  });
  expect(follow.sessionId).toBe(result.sessionId);
  expect(await chat.history(result.sessionId)).toHaveLength(4);
});
it("isolates session/history/clear/send even when another client's session ID is known", async () => {
  const a = engine("a");
  const b = engine("b");
  const result = await a.send(input());
  expect((await b.sessions()).some((s) => s.id === result.sessionId)).toBe(
    false,
  );
  await expect(b.history(result.sessionId)).rejects.toMatchObject({
    status: 404,
  });
  await expect(b.clear(result.sessionId)).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    b.send({ ...input(), sessionId: result.sessionId }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(a.send({ ...input(), clientId: ids.b })).rejects.toMatchObject({
    status: 422,
  });
  await expect(engine("admin").send(input())).rejects.toMatchObject({
    status: 403,
  });
});
it("clears messages and cached reply content, keeps only a tombstone and prevents completed-turn resurrection", async () => {
  const chat = engine();
  const data = input();
  const result = await chat.send(data);
  await chat.clear(result.sessionId);
  await chat.clear(result.sessionId);
  await expect(chat.history(result.sessionId)).rejects.toMatchObject({
    status: 404,
  });
  await expect(chat.send(data)).rejects.toMatchObject({ status: 409 });
  expect((await chat.sessions()).some((s) => s.id === result.sessionId)).toBe(
    false,
  );
  const ledger = await db.engine.query<{ status: string; result: null }>(
    "select status,result from private.chat_requests where client_id=$1 and request_id=$2",
    [ids.a, data.requestId],
  );
  expect(ledger.rows[0]).toEqual({ status: "cancelled", result: null });
  expect(
    (
      await db.engine.query(
        "select id from chat_messages where session_id=$1",
        [result.sessionId],
      )
    ).rows,
  ).toEqual([]);
});
it("does not restore a cleared conversation when an in-flight model response arrives", async () => {
  let started!: () => void;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    started = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const planner: SupportPlanner = {
    enabled: true,
    plan: async () => {
      calls++;
      started();
      await held;
      return { topics: ["funds"], currency: null };
    },
  };
  const chat = engine("a", planner);
  const data = input();
  const operation = chat.send(data);
  const rejected = expect(operation).rejects.toMatchObject({ status: 404 });
  await pending;
  const sessions = await chat.sessions();
  const active = sessions.find((s) => s.title === data.message)!;
  await chat.clear(active.id);
  release();
  await rejected;
  await expect(chat.send(data)).rejects.toMatchObject({ status: 409 });
  expect(calls).toBe(1);
  expect(
    (
      await db.engine.query("select * from chat_messages where session_id=$1", [
        active.id,
      ])
    ).rows,
  ).toEqual([]);
});
it("uses only server-derived prior topics and preserves safe fallback history during a planner outage", async () => {
  const previous: string[][] = [];
  const planner: SupportPlanner = {
    enabled: true,
    plan: async (_message, topics) => {
      previous.push(topics);
      if (previous.length === 2) throw new Error("Synthetic API outage");
      return { topics: ["funds"], currency: null };
    },
  };
  const chat = engine("a", planner);
  const first = await chat.send(input());
  const second = await chat.send({
    ...input(),
    sessionId: first.sessionId,
    message: "And what about my report?",
  });
  expect(previous).toEqual([[], ["funds"]]);
  expect(second.reply.mode).toBe("fallback");
  expect((await chat.history(first.sessionId)).at(-1)?.reply?.mode).toBe(
    "fallback",
  );
});
it("rejects revoked users and credentials before storing chat, and keeps the request ledger inaccessible", async () => {
  const chat = engine();
  await expect(
    chat.send({ ...input(), message: "otp: 123456" }),
  ).rejects.toMatchObject({ status: 422 });
  await db.engine.query("update profiles set status='suspended' where id=$1", [
    ids.b,
  ]);
  try {
    await expect(engine("b").sessions()).rejects.toMatchObject({ status: 403 });
  } finally {
    await db.engine.query("update profiles set status='active' where id=$1", [
      ids.b,
    ]);
  }
  await expect(
    db.withIdentity(null, (sql) =>
      sql.query("select * from private.chat_requests"),
    ),
  ).rejects.toMatchObject({ code: "42501" });
});
it("blocks duplicate active sends, marks stale requests failed and prevents late completion after failure", async () => {
  const context = await testAuth(db, "b").requireUser();
  const data = input();
  const claim = await repo.claim(context, data);
  expect(claim.claimed).toBe(true);
  expect((await repo.claim(context, data)).claimed).toBe(false);
  await expect(
    repo.claim(context, { ...input(), sessionId: claim.sessionId }),
  ).rejects.toMatchObject({ code: "CHAT_PENDING" });
  await db.engine.query(
    "update private.chat_requests set updated_at=now()-interval '3 minutes' where client_id=$1 and request_id=$2",
    [ids.b, data.requestId],
  );
  expect((await repo.claim(context, data)).status).toBe("failed");
  await expect(
    repo.finish(
      context,
      data.requestId,
      new FaqResponder().respond({ message: "Where are funds held?" }),
    ),
  ).rejects.toMatchObject({ status: 404 });
});
it("bounds conversation size and paginates own history without accepting identity parameters", async () => {
  const chat = engine();
  const first = await chat.send(input());
  await db.engine.query(
    "insert into chat_messages(session_id,client_id,role,content) select $1,$2,'user','SYNTHETIC size fixture' from generate_series(1,98)",
    [first.sessionId, ids.a],
  );
  await expect(
    chat.send({ ...input(), sessionId: first.sessionId }),
  ).rejects.toMatchObject({ code: "CHAT_FULL" });
  await db.engine.query(
    "insert into chat_sessions(client_id,title) select $1,'SYNTHETIC page '||n from generate_series(1,21) n",
    [ids.a],
  );
  const page = await chat.sessions();
  const next = await chat.sessions({ offset: 20 });
  expect(page).toHaveLength(20);
  expect(next.length).toBeGreaterThan(0);
  expect(
    next.some((row) => page.some((previous) => previous.id === row.id)),
  ).toBe(false);
  await expect(chat.sessions({ clientId: ids.b })).rejects.toMatchObject({
    status: 422,
  });
});
