import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_TOOL } from "@sidecar/actions";
import { NOTEBOOK_MEMORY_TOOL } from "@sidecar/memory";
import { CHILD_SPAWN_REFUSAL, TOOL_EFFECT, TOOL_POLICY_LAYER } from "@sidecar/runtime";
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
  MEMORY_SCOPE_KIND,
  type MemoryDefinition,
  type MemoryToolContext,
  RUN_ORIGIN,
  type ToolInvocation,
} from "@sidecar/runtime/vocabulary";
import { ACTION_RESULT_STATUS, isRecord, type UnparsedWireValue } from "@sidecar/wire";
import { BrainJournal } from "./journal.js";
import { fakeActionPerformer } from "./testing.js";
import {
  type BrainChildAccess,
  createTurnToolExecutor,
  journaledEffect,
  refusalForPolicy,
  type ToolExecutorDependencies,
  type ToolExecutorTurn,
} from "./tool-executor.js";
import { BRAIN_TOOL, brainToolCatalog, resolveTurnToolPolicy } from "./tools.js";
import {
  BRAIN_TURN_TRIGGER,
  type BrainTurnTrigger,
  REFUSAL_REASON,
  type TurnContext,
} from "./turn.js";

/**
 * The executor alone, over a policy and a journal and nothing else: the
 * agent's own tests drive it through a whole turn, and these pin the gate
 * it keeps at the door of every dispatch.
 */

const CATALOG = brainToolCatalog();

/** The arguments a test's model emits, well formed or not: the executor's parsing is what is under test. */
type EmittedArguments = Readonly<Record<string, string | number | null>>;

function call(name: string, args: EmittedArguments, callId = `call-${name}`): ToolInvocation {
  return { callId, name, argumentsJson: JSON.stringify(args) };
}

function parsed(outputJson: string) {
  // SAFETY: the executor answers JSON.stringify output; the record check is the validation.
  const value = JSON.parse(outputJson) as UnparsedWireValue;
  assert.ok(isRecord(value));
  return value;
}

function executor(
  trigger: BrainTurnTrigger = BRAIN_TURN_TRIGGER.WAKE,
  children: BrainChildAccess | undefined = undefined,
  memory: MemoryDefinition | undefined = undefined,
) {
  const policy = resolveTurnToolPolicy(CATALOG, {}, trigger);
  const journal = new BrainJournal();
  const written: [string, string][] = [];
  const checkpoints: number[] = [];
  const run = {
    runId: "run-1",
    generation: { journal, abort: new AbortController() },
    recorded: true,
    abort: new AbortController(),
    cancelled: false,
    timedOut: false,
    checkpointFailed: false,
    performedActions: 0,
    unknownActions: 0,
  };
  // SAFETY: the executor reads the generation's journal and the run's controls; nothing else of the turn context.
  const context = {
    generation: run.generation,
    run,
    signal: run.abort.signal,
  } as unknown as TurnContext;
  const dependencies: ToolExecutorDependencies = {
    roster: () => ({ text: "roster", identities: [] }),
    actions: fakeActionPerformer().actions,
    children,
    memory,
    workspace: {
      read: async (name) => ({ ok: true, content: `content of ${name}` }),
      write: async (name, content) => {
        written.push([name, content]);
        return { ok: true, chars: content.length };
      },
      loadSkill: async () => ({ ok: true, instructions: "do it", truncated: false }),
    },
    readWhole: async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED, transcript: "whole" }),
    checkpoint: async () => {
      checkpoints.push(journal.entries().length);
      return true;
    },
    runRevoked: () => false,
    now: () => 1_800_000_000_000,
  };
  const turn: ToolExecutorTurn = {
    policy,
    context,
    execution: {
      conversationId: MAIN_SESSION_KEY,
      turnId: run.runId,
      runId: run.runId,
      origin: RUN_ORIGIN.OBSERVATION,
      isRevoked: () => false,
      signal: run.abort.signal,
    },
    onBriefing: () => undefined,
  };
  const tools = createTurnToolExecutor(dependencies, turn);
  return {
    policy,
    journal,
    written,
    checkpoints,
    execute: async (invocation: ToolInvocation) =>
      parsed(
        (
          await tools.execute(invocation, {
            runId: run.runId,
            signal: run.abort.signal,
            isRevoked: () => false,
          })
        ).outputJson,
      ),
  };
}

test("a workspace write with a missing or non-string argument is refused before anything is journaled, and the file is untouched", async () => {
  const h = executor();
  const malformed: readonly EmittedArguments[] = [
    { name: "MEMORY.md" },
    { content: "words" },
    { name: 7, content: "words" },
    { name: "MEMORY.md", content: null },
  ];
  for (const args of malformed) {
    const output = await h.execute(call(BRAIN_TOOL.WRITE_WORKSPACE_FILE, args));
    assert.equal(output.status, ACTION_RESULT_STATUS.REJECTED);
    assert.equal(output.reason, REFUSAL_REASON.MALFORMED_ARGUMENTS);
  }
  assert.deepEqual(h.written, []);
  assert.deepEqual(h.journal.entries(), []);
  assert.deepEqual(h.checkpoints, []);
  for (const [name, args] of [
    [BRAIN_TOOL.READ_WORKSPACE_FILE, {}],
    [BRAIN_TOOL.LOAD_SKILL, { location: 3 }],
  ] as const) {
    const output = await h.execute(call(name, args));
    assert.equal(output.reason, REFUSAL_REASON.MALFORMED_ARGUMENTS);
  }

  const written = await h.execute(
    call(BRAIN_TOOL.WRITE_WORKSPACE_FILE, { name: "MEMORY.md", content: "# MEMORY.md\n" }),
  );
  assert.equal(written.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.deepEqual(h.written, [["MEMORY.md", "# MEMORY.md\n"]]);
  // The write went through the journal: started and checkpointed before the effect, settled after.
  assert.deepEqual(h.checkpoints, [1]);
  assert.equal(h.journal.entries().length, 1);
});

test("the refusal names the policy's own answer: the turn layer for announce in an ask, no such tool for a name outside the catalog, and not allowed otherwise", async () => {
  const ask = resolveTurnToolPolicy(CATALOG, {}, BRAIN_TURN_TRIGGER.ASK);
  assert.equal(ask.deniedBy(BRAIN_TOOL.ANNOUNCE), TOOL_POLICY_LAYER.TURN);
  assert.equal(refusalForPolicy(ask, BRAIN_TOOL.ANNOUNCE)?.reason, REFUSAL_REASON.ANNOUNCE_IN_ASK);
  assert.equal(refusalForPolicy(ask, "delete_everything")?.reason, REFUSAL_REASON.NOT_OFFERED);
  assert.equal(refusalForPolicy(ask, BRAIN_TOOL.LIST_SESSIONS), undefined);

  const configured = resolveTurnToolPolicy(
    CATALOG,
    { agent: { deny: [BRAIN_TOOL.ANNOUNCE, REALTIME_TOOL.SEND_SESSION_MESSAGE] } },
    BRAIN_TURN_TRIGGER.ASK,
  );
  // A configured deny is not the turn's: the model is told the policy, not to reply in text.
  assert.equal(
    refusalForPolicy(configured, BRAIN_TOOL.ANNOUNCE)?.reason,
    REFUSAL_REASON.NOT_ALLOWED,
  );
  assert.equal(
    refusalForPolicy(configured, REALTIME_TOOL.SEND_SESSION_MESSAGE)?.reason,
    REFUSAL_REASON.NOT_ALLOWED,
  );

  const h = executor(BRAIN_TURN_TRIGGER.ASK);
  const refused = await h.execute(call(BRAIN_TOOL.ANNOUNCE, { briefing: "words" }));
  assert.equal(refused.reason, REFUSAL_REASON.ANNOUNCE_IN_ASK);
  assert.deepEqual(h.journal.entries(), []);
});

test("an effect is journaled by what the catalog says the tool is: every action and the workspace write, never a read or the briefing", () => {
  const wake = resolveTurnToolPolicy(CATALOG, {}, BRAIN_TURN_TRIGGER.WAKE);
  assert.ok(journaledEffect(wake, REALTIME_TOOL.SEND_SESSION_MESSAGE));
  assert.ok(journaledEffect(wake, BRAIN_TOOL.WRITE_WORKSPACE_FILE));
  assert.ok(!journaledEffect(wake, BRAIN_TOOL.READ_WORKSPACE_FILE));
  assert.ok(!journaledEffect(wake, BRAIN_TOOL.READ_TRANSCRIPT));
  assert.ok(!journaledEffect(wake, BRAIN_TOOL.ANNOUNCE));
  assert.ok(!journaledEffect(wake, "not_a_tool"));
  // A tool the policy removed is refused, not journaled.
  const noActions = resolveTurnToolPolicy(CATALOG, { agent: { deny: ["group:actions"] } });
  assert.ok(!journaledEffect(noActions, REALTIME_TOOL.SEND_SESSION_MESSAGE));
});

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

test("the session tools render the host's typed answers in the records the model reads, and a child that is not this conversation's is refused", async () => {
  const record = childRecord("child-1", "summary");
  const completion: ChildCompletionRecord = {
    completionId: "completion:child-1",
    childId: "child-1",
    destination: MAIN_SESSION_KEY,
    status: CHILD_RUN_STATUS.COMPLETED,
    createdAt: NOW + 1_000,
    delivery: COMPLETION_DELIVERY_STATUS.DELIVERED,
    attempts: 1,
  };
  const cancelled: string[] = [];
  const children: BrainChildAccess = {
    sessionKey: MAIN_SESSION_KEY,
    spawn: async (ask) =>
      ask.label === "refused"
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
          },
    list: async () => [{ record, completion }],
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
  const h = executor(BRAIN_TURN_TRIGGER.ASK, children);

  const receipt = await h.execute(call(BRAIN_TOOL.SESSIONS_SPAWN, { task: "look" }));
  assert.deepEqual(receipt, {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    accepted: true,
    completed: false,
    child_id: "child-2",
    child_session_key: childSessionKey("child-2"),
    child_run_id: "child-2-run",
    context: CHILD_CONTEXT_MODE.ISOLATED,
    context_note: "started isolated",
    depth: 1,
    completion:
      "arrives in this conversation as its own item when the child ends; do not poll for it",
  });
  const refused = await h.execute(
    call(BRAIN_TOOL.SESSIONS_SPAWN, { task: "look", label: "refused" }, "call-refused"),
  );
  assert.deepEqual(refused, {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: "not run: this conversation already has its limit of active children: 5 active",
  });

  const listed = await h.execute(call(BRAIN_TOOL.SUBAGENTS, { action: "list" }));
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

  const conversations = await h.execute(call(BRAIN_TOOL.SESSIONS_LIST, {}));
  assert.deepEqual(conversations, {
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

  const read = await h.execute(call(BRAIN_TOOL.SESSIONS_HISTORY, { child_id: "child-1" }));
  assert.deepEqual(read, {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    lines: ["ask: hi", "reply: done"],
  });
  const notOwn = await h.execute(
    call(BRAIN_TOOL.SESSIONS_HISTORY, { child_id: "someone-elses" }, "call-other-history"),
  );
  assert.deepEqual(notOwn, {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: REFUSAL_REASON.UNKNOWN_CHILD,
  });

  const cancel = await h.execute(
    call(BRAIN_TOOL.SUBAGENTS, { action: "cancel", child_id: "child-1" }, "call-cancel"),
  );
  assert.deepEqual(cancel, { status: ACTION_RESULT_STATUS.ACCEPTED, cancelled: ["child-1"] });
  const cancelOther = await h.execute(
    call(BRAIN_TOOL.SUBAGENTS, { action: "cancel", child_id: "someone-elses" }, "call-cancel-2"),
  );
  assert.deepEqual(cancelOther, {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: REFUSAL_REASON.UNKNOWN_CHILD,
  });
  assert.deepEqual(cancelled, ["child-1"]);
});

/** A memory provider whose four tools record the standing they were handed and answer accepted. */
function memoryDefinition() {
  const contexts: MemoryToolContext[] = [];
  const definition: MemoryDefinition = {
    scope: { kind: MEMORY_SCOPE_KIND.ACCOUNT, key: "main" },
    provider: {
      recall: async () => ({ messages: [] }),
      tools: Object.values(NOTEBOOK_MEMORY_TOOL).map((name) => ({
        schema: { name, description: name, parameters: {} },
        effect:
          name === NOTEBOOK_MEMORY_TOOL.SEARCH || name === NOTEBOOK_MEMORY_TOOL.GET
            ? TOOL_EFFECT.READ
            : TOOL_EFFECT.WRITE,
        execute: async (_invocation, context) => {
          contexts.push(context);
          return { status: ACTION_RESULT_STATUS.ACCEPTED };
        },
      })),
    },
  };
  return { definition, contexts };
}

test("a memory tool is dispatched to the provider under the turn's standing and scope: a write through the journal, a read directly, and none without a provider", async () => {
  const memory = memoryDefinition();
  const h = executor(BRAIN_TURN_TRIGGER.WAKE, undefined, memory.definition);
  const read = await h.execute(call(NOTEBOOK_MEMORY_TOOL.SEARCH, { query: "deploys" }));
  assert.equal(read.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.deepEqual(h.journal.entries(), [], "a read is not an effect");
  const written = await h.execute(call(NOTEBOOK_MEMORY_TOOL.REMEMBER, { words: "likes tea" }));
  assert.equal(written.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.deepEqual(
    h.journal.entries().map((entry) => entry.name),
    [NOTEBOOK_MEMORY_TOOL.REMEMBER],
    "the write went through the journal",
  );
  assert.deepEqual(h.checkpoints, [1], "checkpointed before the effect ran");
  assert.deepEqual(
    memory.contexts.map((context) => [context.runId, context.origin, context.scope]),
    [
      ["run-1", RUN_ORIGIN.OBSERVATION, memory.definition.scope],
      ["run-1", RUN_ORIGIN.OBSERVATION, memory.definition.scope],
    ],
  );
  // The same call id again is answered from the journal, not performed twice.
  const again = await h.execute(call(NOTEBOOK_MEMORY_TOOL.REMEMBER, { words: "likes tea" }));
  assert.equal(again.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.equal(memory.contexts.length, 2);

  const without = executor();
  for (const name of Object.values(NOTEBOOK_MEMORY_TOOL)) {
    const refused = await without.execute(call(name, { query: "q" }));
    assert.equal(refused.status, ACTION_RESULT_STATUS.REJECTED);
    assert.equal(refused.reason, REFUSAL_REASON.NO_MEMORY);
  }
  assert.deepEqual(without.journal.entries(), []);
});
