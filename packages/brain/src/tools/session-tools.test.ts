import assert from "node:assert/strict";
import { CHILD_SPAWN_REFUSAL } from "@sidecar/runtime";
import {
  CHILD_CLEANUP,
  CHILD_CONTEXT_MODE,
  CHILD_RUN_STATUS,
  type ChildCompletionRecord,
  type ChildRunRecord,
  COMPLETION_DELIVERY_STATUS,
  CONVERSATION_KIND,
  childSessionKey,
  DEFAULT_AGENT_ID,
  MAIN_SESSION_KEY,
  RUN_ORIGIN,
} from "@sidecar/runtime/vocabulary";
import { ACTION_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { emitJsonSchema } from "@sidecar/wire/effect";
import { Effect } from "effect";
import { test } from "vitest";
import { BRAIN_TOOL, maximumChildTaskLength, maximumSessionsConversationLines } from "./names.js";
import { REFUSAL_REASON } from "./refusals.js";
import {
  type BrainChildAccess,
  SESSION_TOOLS,
  type SessionToolContext,
  sessionToolNamed,
} from "./session-tools.js";

const NOW = 1_800_000_000_000;

function childRecord(childId: string, label?: string): ChildRunRecord {
  return {
    childId,
    agentId: DEFAULT_AGENT_ID,
    requesterSessionKey: MAIN_SESSION_KEY,
    childSessionKey: childSessionKey(childId),
    childRunId: `${childId}-run`,
    task: "look",
    ...(label !== undefined ? { label } : undefined),
    depth: 1,
    requestedContext: CHILD_CONTEXT_MODE.ISOLATED,
    context: CHILD_CONTEXT_MODE.ISOLATED,
    policy: { allowed: [], denied: [] },
    timeoutMs: 0,
    cleanup: CHILD_CLEANUP.KEEP,
    completionDestination: MAIN_SESSION_KEY,
    expectsCompletion: true,
    status: CHILD_RUN_STATUS.COMPLETED,
    acceptedAt: NOW,
    settledAt: NOW + 1_000,
    resultText: "done",
  };
}

const COMPLETION: ChildCompletionRecord = {
  completionId: "completion:child-1",
  childId: "child-1",
  destination: MAIN_SESSION_KEY,
  status: CHILD_RUN_STATUS.COMPLETED,
  createdAt: NOW + 1_000,
  delivery: COMPLETION_DELIVERY_STATUS.DELIVERED,
  attempts: 1,
};

/** The host's delegation, recording every spawn and cancel it was asked. */
function delegation() {
  const spawns: Parameters<BrainChildAccess["spawn"]>[0][] = [];
  const cancelled: string[] = [];
  const children: BrainChildAccess = {
    sessionKey: MAIN_SESSION_KEY,
    spawn: async (ask) => {
      spawns.push(ask);
      return ask.label === "refused"
        ? { accepted: false, reason: CHILD_SPAWN_REFUSAL.REQUESTER_LIMIT, detail: "5 active" }
        : {
            accepted: true,
            receipt: {
              childId: "child-2",
              childSessionKey: childSessionKey("child-2"),
              childRunId: "child-2-run",
              context: CHILD_CONTEXT_MODE.ISOLATED,
              contextNote: "started isolated",
              depth: 1,
            },
          };
    },
    list: async () => [{ record: childRecord("child-1", "summary"), completion: COMPLETION }],
    cancel: async (childId) => {
      if (childId !== "child-1") return undefined;
      cancelled.push(childId);
      return { ok: true, remaining: [] };
    },
    conversations: async () => [
      {
        sessionKey: MAIN_SESSION_KEY,
        kind: CONVERSATION_KIND.MAIN,
        name: "main",
        createdAt: NOW,
        lastActivityAt: NOW,
      },
      {
        sessionKey: childSessionKey("child-0"),
        kind: CONVERSATION_KIND.CHILD,
        name: "archived",
        createdAt: NOW,
        lastActivityAt: NOW,
        archivedAt: NOW,
      },
    ],
    lines: async (childId) => (childId === "child-1" ? ["ask: hi", "reply: done"] : undefined),
  };
  return { children, spawns, cancelled };
}

function context(children: BrainChildAccess | undefined) {
  let journaled = 0;
  const ctx: SessionToolContext = {
    conversationId: MAIN_SESSION_KEY,
    turnId: "run-1",
    runId: "run-1",
    origin: RUN_ORIGIN.USER,
    isRevoked: () => false,
    signal: new AbortController().signal,
    children,
    policy: { allowed: ["sessions_spawn"], denied: ["announce"] },
    fork: () => ({ items: [{ type: "message" }], estimatedTokens: 3 }),
    journal: (effect) =>
      Effect.flatMap(
        Effect.sync(() => {
          journaled += 1;
        }),
        () => effect,
      ),
  };
  return { ctx, journaled: () => journaled };
}

function toolNamed(name: string) {
  const tool = sessionToolNamed(name);
  assert.ok(tool, name);
  return tool;
}

test("the four session tools are modules in catalog order", () => {
  assert.deepEqual(
    SESSION_TOOLS.map((tool) => tool.name),
    [
      BRAIN_TOOL.SESSIONS_SPAWN,
      BRAIN_TOOL.SUBAGENTS,
      BRAIN_TOOL.SESSIONS_LIST,
      BRAIN_TOOL.SESSIONS_HISTORY,
    ],
  );
  const required = SESSION_TOOLS.map((tool) => {
    const node = emitJsonSchema(tool.inputSchema);
    return "required" in node ? [...node.required] : [];
  });
  assert.deepEqual(required, [["task"], [], [], ["child_id"]]);
});

test("a spawn is bounded here, carries the turn's run, policy, and fork, runs through the journal, and answers a receipt that says accepted and never done", async () => {
  const { children, spawns } = delegation();
  const { ctx, journaled } = context(children);
  const spawn = toolNamed(BRAIN_TOOL.SESSIONS_SPAWN);
  const receipt = await Effect.runPromise(
    spawn.execute(
      {
        task: ` ${"t".repeat(maximumChildTaskLength + 10)} `,
        label: " summary ",
        context: CHILD_CONTEXT_MODE.FORK,
        cleanup: CHILD_CLEANUP.DELETE,
        run_timeout_seconds: 30,
        expects_completion: false,
      },
      ctx,
    ),
  );
  assert.equal(journaled(), 1);
  assert.equal(receipt.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.completed, false);
  assert.equal(receipt.child_id, "child-2");
  const [ask] = spawns;
  assert.ok(ask);
  assert.equal(ask.task.length, maximumChildTaskLength);
  assert.equal(ask.label, "summary");
  assert.equal(ask.context, CHILD_CONTEXT_MODE.FORK);
  assert.equal(ask.cleanup, CHILD_CLEANUP.DELETE);
  assert.equal(ask.timeoutMs, 30_000);
  assert.equal(ask.expectsCompletion, false);
  assert.equal(ask.requesterRunId, "run-1");
  assert.deepEqual(ask.policy, ctx.policy);
  assert.deepEqual(ask.fork(), ctx.fork());
  // Unreadable optional fields are left out rather than guessed at; an empty task never reaches the host.
  await Effect.runPromise(
    spawn.execute({ task: "look", context: "sideways", run_timeout_seconds: -1 }, ctx),
  );
  const second = spawns[1];
  assert.ok(second);
  assert.equal(second.context, undefined);
  assert.equal(second.timeoutMs, undefined);
  const empty = await Effect.runPromise(spawn.execute({ task: "  " }, ctx));
  assert.equal(empty.reason, REFUSAL_REASON.EMPTY_TASK);
  assert.equal(spawns.length, 2);
  const refused = await Effect.runPromise(spawn.execute({ task: "look", label: "refused" }, ctx));
  assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);
  assert.equal(journaled(), 3);
});

test("subagents lists as a read and cancels through the journal; a child not this conversation's is refused; the listing and the history render the host's typed answers", async () => {
  const { children, cancelled } = delegation();
  const { ctx, journaled } = context(children);
  const subagents = toolNamed(BRAIN_TOOL.SUBAGENTS);
  const listed = await Effect.runPromise(subagents.execute({}, ctx));
  assert.equal(journaled(), 0);
  assert.deepEqual(listed, {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    children: [
      {
        child_id: "child-1",
        label: "summary",
        status: CHILD_RUN_STATUS.COMPLETED,
        depth: 1,
        context: CHILD_CONTEXT_MODE.ISOLATED,
        accepted_at: new Date(NOW).toISOString(),
        settled_at: new Date(NOW + 1_000).toISOString(),
        has_result: true,
        delivery: COMPLETION_DELIVERY_STATUS.DELIVERED,
        attempts: 1,
      },
    ],
  });
  const cancel = await Effect.runPromise(
    subagents.execute({ action: "cancel", child_id: "child-1" }, ctx),
  );
  assert.deepEqual(cancel, { status: ACTION_RESULT_STATUS.ACCEPTED, cancelled: ["child-1"] });
  assert.equal(journaled(), 1);
  const other = await Effect.runPromise(
    subagents.execute({ action: "cancel", child_id: "someone-elses" }, ctx),
  );
  assert.equal(other.reason, REFUSAL_REASON.UNKNOWN_CHILD);
  const unnamed = await Effect.runPromise(subagents.execute({ action: "cancel" }, ctx));
  assert.equal(unnamed.reason, REFUSAL_REASON.NOT_OWN_CHILD);
  assert.deepEqual(cancelled, ["child-1"]);

  const listing = await Effect.runPromise(toolNamed(BRAIN_TOOL.SESSIONS_LIST).execute({}, ctx));
  assert.deepEqual(listing, {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    conversations: [
      {
        session_key: MAIN_SESSION_KEY,
        kind: CONVERSATION_KIND.MAIN,
        name: "main",
        last_activity_at: new Date(NOW).toISOString(),
        current: true,
      },
    ],
  });
  const history = toolNamed(BRAIN_TOOL.SESSIONS_HISTORY);
  assert.deepEqual(
    await Effect.runPromise(history.execute({ child_id: "child-1", limit: 999 }, ctx)),
    {
      status: ACTION_RESULT_STATUS.ACCEPTED,
      lines: ["ask: hi", "reply: done"],
    },
  );
  assert.equal(
    (await Effect.runPromise(history.execute({ child_id: "someone-elses" }, ctx))).reason,
    REFUSAL_REASON.UNKNOWN_CHILD,
  );
  assert.equal(
    (await Effect.runPromise(history.execute({}, ctx))).reason,
    REFUSAL_REASON.NOT_OWN_CHILD,
  );
  assert.ok(maximumSessionsConversationLines > 0);
});

test("with no delegation wired every session tool refuses, and none reaches the journal", async () => {
  const { ctx, journaled } = context(undefined);
  const inputs: WireRecord[] = [
    { task: "look" },
    { action: "cancel", child_id: "c" },
    {},
    { child_id: "c" },
  ];
  for (const [index, tool] of SESSION_TOOLS.entries()) {
    const refused = await Effect.runPromise(tool.execute(inputs[index] ?? {}, ctx));
    assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);
    assert.equal(refused.reason, REFUSAL_REASON.NO_CHILDREN);
  }
  assert.equal(journaled(), 0);
});
