import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  BRAIN_INPUT_MARKER,
  BRAIN_REQUEST_ORIGIN,
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_TOOL,
  type BrainStateRepository,
  type ResponsesInputItem,
  responsesModelAnswer,
} from "@sidecar/brain";
import {
  type BareResponsesModel,
  bareModelAdapter,
  fakeBrainStateRepository,
} from "@sidecar/brain/testing";
import { RESPONSES_INPUT_ITEM_TYPE } from "@sidecar/hosted";
import { MEMORY_HOUSEKEEPING_OUTCOME } from "@sidecar/memory";
import { type ChildStore, CREDENTIAL_REFERENCE_KIND, type ScheduledTimer } from "@sidecar/runtime";
import {
  CHILD_CONTEXT_MODE,
  CHILD_RUN_STATUS,
  type ChildCompletionRecord,
  type ChildRunRecord,
  COMPLETION_DELIVERY_STATUS,
  CONVERSATION_KIND,
  childIdOf,
  conversationKindOf,
  MAIN_SESSION_KEY,
  MEMORY_CAPTURE_PHASE,
  MEMORY_SCOPE_KIND,
  type SessionKey,
} from "@sidecar/runtime/vocabulary";
import type { ConversationEntry } from "@sidecar/session";
import { ACTION_RESULT_STATUS, isRecord, isWireString, type WireRecord } from "@sidecar/wire";
import { temporaryDirectory } from "@sidecar/wire/testing";
import type { Fiber } from "effect";
import { Chunk, Duration, Effect, FiberId, Runtime, TestClock } from "effect";
import type { TestContext } from "vitest";
import { type BrainWiring, wireBrain } from "./wiring.js";

/**
 * Delegation through the wiring as the main process composes it, with the
 * model, the disk, and the providers synthetic: a spawn from main opens a
 * child conversation at depth one under the child restriction, the child's
 * final text becomes a completion persisted before delivery, the completion
 * reaches main as its own turn, a nested spawn counts one deeper, a fork
 * carries the requester's context and an isolated child none, and Start
 * fresh cancels the conversation's descendants before its lifetime is replaced.
 */

const NOW = 1_800_000_000_000;
const MAIN_SECRET = "MAIN_CONTEXT_SECRET";

function itemTexts(input: readonly ResponsesInputItem[]): string[] {
  return input.flatMap((item) => {
    if (item.type !== RESPONSES_INPUT_ITEM_TYPE.MESSAGE || !Array.isArray(item.content)) return [];
    return item.content.flatMap((part) =>
      isRecord(part) && isWireString(part.text) ? [part.text] : [],
    );
  });
}

function offeredTools(options: { tools?: readonly { name: string }[] }): readonly string[] {
  return (options.tools ?? []).map((tool) => tool.name);
}

/**
 * Polls until the condition holds, letting queued microtasks and immediates
 * run between checks, so a slow prompt read under a loaded run is waited for
 * rather than raced. Rounds bound the wait rather than a real deadline,
 * since nothing here runs on a wall clock any more.
 */
function waitFor(condition: () => boolean, rounds = 300): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (let round = 0; round < rounds; round += 1) {
      if (condition()) return;
      for (let tick = 0; tick < 100; tick += 1) yield* Effect.yieldNow();
    }
    assert.ok(condition(), "the condition did not hold in time");
  });
}

function textAnswer(text: string) {
  const answered = responsesModelAnswer({
    output: [
      {
        type: RESPONSES_INPUT_ITEM_TYPE.MESSAGE,
        role: "assistant",
        content: [{ type: "output_text", text }],
      },
    ],
    usage: { input_tokens: 1 },
  });
  assert.ok(answered);
  return answered;
}

function callAnswer(callId: string, name: string, args: WireRecord) {
  const answered = responsesModelAnswer({
    output: [
      {
        type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL,
        call_id: callId,
        name,
        arguments: JSON.stringify(args),
      },
    ],
    usage: { input_tokens: 1 },
  });
  assert.ok(answered);
  return answered;
}

/** One model call as the scripted responder sees it: the input texts joined, the tools offered, and any tool outputs. */
interface Seen {
  texts: string;
  /** The words after the latest developer-ask marker, or everything when there is none. */
  lastAsk: string;
  tools: readonly string[];
  outputs: readonly string[];
  /** Whether the input ends on a tool's answer, so the model's next words close the call. */
  answeringTool: boolean;
  /** The words of the item the model is answering: the one before the standing context. */
  lastInput: string;
}

type ScriptedAnswer = ReturnType<typeof textAnswer>;
type Script = (seen: Seen, calls: number) => ScriptedAnswer | Promise<ScriptedAnswer>;

interface Composed {
  wiring: BrainWiring;
  seen: Seen[];
  childStore: ChildStore;
  children: Map<string, ChildRunRecord>;
  completions: Map<string, ChildCompletionRecord>;
  ensured: { sessionKey: SessionKey; name: string }[];
  archived: SessionKey[];
  history: Map<SessionKey, ConversationEntry[]>;
}

/**
 * The child service's timer seam, over whichever runtime a test is running
 * on — the ambient `TestClock` under `it.effect` — so an archive delay
 * advances on the same clock a test drives rather than firing on its own.
 */
function childTimersOn(runtime: Runtime.Runtime<never>) {
  const fork = Runtime.runFork(runtime);
  const armed = new Map<ScheduledTimer, Fiber.RuntimeFiber<void>>();
  return {
    schedule: (callback: () => void, delayMs: number): ScheduledTimer => {
      const handle: ScheduledTimer = {};
      const fiber = fork(
        Effect.delay(Effect.sync(callback), Duration.millis(delayMs)).pipe(
          Effect.ensuring(Effect.sync(() => armed.delete(handle))),
        ),
      );
      armed.set(handle, fiber);
      return handle;
    },
    cancel: (timer: ScheduledTimer) => {
      const fiber = armed.get(timer);
      if (fiber === undefined) return;
      armed.delete(timer);
      fiber.unsafeInterruptAsFork(FiberId.none);
    },
  };
}

async function composed(
  t: TestContext,
  script: Script,
  overrides: Partial<Parameters<typeof wireBrain>[0]> = {},
): Promise<Composed> {
  const seen: Seen[] = [];
  let calls = 0;
  const client: BareResponsesModel = {
    respond: async (input, options) => {
      const outputs = input.flatMap((item) =>
        item.type === RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL_OUTPUT && isWireString(item.output)
          ? [item.output]
          : [],
      );
      const texts = itemTexts(input).join("\n");
      const askAt = texts.lastIndexOf(BRAIN_INPUT_MARKER.DEVELOPER_ASK);
      // The standing context rides last; the item before it is what the model answers.
      const before = input.at(-2);
      const current: Seen = {
        texts,
        lastAsk: askAt >= 0 ? texts.slice(askAt) : texts,
        tools: offeredTools(options),
        outputs,
        answeringTool: before?.type === RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL_OUTPUT,
        lastInput: before ? itemTexts([before]).join("\n") : "",
      };
      seen.push(current);
      calls += 1;
      return script(current, calls);
    },
    quietUntil: () => undefined,
  };
  const model = bareModelAdapter(client);
  const repositories = new Map<SessionKey, BrainStateRepository>();
  const children = new Map<string, ChildRunRecord>();
  const completions = new Map<string, ChildCompletionRecord>();
  const childStore: ChildStore = {
    listChildren: async () => [...children.values()],
    putChild: async (record) => {
      children.set(record.childId, record);
      return true;
    },
    deleteChild: async (childId) => children.delete(childId),
    listCompletions: async () => [...completions.values()],
    putCompletion: async (completion) => {
      completions.set(completion.completionId, completion);
      return true;
    },
    deleteCompletion: async (completionId) => completions.delete(completionId),
  };
  const ensured: Composed["ensured"] = [];
  const archived: SessionKey[] = [];
  const history = new Map<SessionKey, ConversationEntry[]>();
  let ids = 0;
  const workspace = await temporaryDirectory(t, "luke-children-");
  const wiring = wireBrain({
    execution: Runtime.defaultRuntime,
    repositoryFor: (sessionKey) => {
      let repository = repositories.get(sessionKey);
      if (!repository) {
        repository = fakeBrainStateRepository();
        repositories.set(sessionKey, repository);
      }
      return repository;
    },
    ensureObservedConversation: async (sessionKey, name) => {
      ensured.push({ sessionKey, name });
    },
    ensureChildConversation: async (sessionKey, name) => {
      ensured.push({ sessionKey, name });
    },
    archiveConversation: async (sessionKey) => {
      archived.push(sessionKey);
      return true;
    },
    conversationDirectory: () => [
      {
        sessionKey: MAIN_SESSION_KEY,
        kind: CONVERSATION_KIND.MAIN,
        name: "main",
        createdAt: NOW,
        lastActivityAt: NOW,
      },
    ],
    conversationLines: (sessionKey) => history.get(sessionKey) ?? [],
    childStore: () => childStore,
    parallelism: () => 8,
    createId: () => `id-${++ids}`,
    report: () => undefined,
    broadcastRequests: () => undefined,
    onGenerationReplaced: () => undefined,
    actions: {
      sessionActions: {
        perform: async () => ({ status: ACTION_RESULT_STATUS.REJECTED, reason: "not in test" }),
        openSession: () => Promise.reject(new Error("not in test")),
        openSessionApplication: () => Promise.reject(new Error("not in test")),
        openSessionChange: () => Promise.reject(new Error("not in test")),
      },
      sessions: () => [],
      refreshSessions: async () => undefined,
      workspaceProjects: () => [],
      workspaceDefaults: async () => ({}),
      appGuide: () => ({ facts: [], settings: [] }),
      rememberedFacts: () => [],
      notebook: { remember: async () => true, forget: async () => true },
      performAppAction: async (): Promise<WireRecord> => ({
        status: ACTION_RESULT_STATUS.REJECTED,
      }),
      recordConversationEntry: () => undefined,
    },
    roster: () => ({ text: "", identities: [], sessions: [] }),
    standingContext: () => "",
    transcripts: {
      readTranscript: async () => ({
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: "not in test",
      }),
      readTranscriptSince: async () => ({
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: "not in test",
      }),
    },
    session: () => undefined,
    deliver: async () => undefined,
    model: () => model,
    credential: () => ({ kind: CREDENTIAL_REFERENCE_KIND.PROVIDER_KEY, providerId: "openai" }),
    workspaceDirectory: () => workspace,
    skillRoots: () => [],
    runnable: () => true,
    dropBriefings: () => undefined,
    ...overrides,
  });
  return {
    wiring,
    seen,
    childStore,
    children,
    completions,
    ensured,
    archived,
    history,
  };
}

const SPAWN_ARGS = { task: "summarize what changed", label: "summary" };

/** Main spawns on its ask; the child answers its task in words; every other turn answers plainly. */
function delegatingScript(childReply = "the change renamed one module"): Script {
  return (seen) => {
    if (seen.texts.includes(BRAIN_INPUT_MARKER.DEVELOPER_ASK) && seen.outputs.length === 0) {
      return callAnswer("call-spawn", BRAIN_TOOL.SESSIONS_SPAWN, SPAWN_ARGS);
    }
    if (seen.texts.includes(BRAIN_INPUT_MARKER.SUBAGENT_TASK)) return textAnswer(childReply);
    if (seen.texts.includes(BRAIN_INPUT_MARKER.CHILD_COMPLETION)) {
      return textAnswer("reviewed");
    }
    return textAnswer("delegated");
  };
}

async function ask(c: Composed, question: string, submissionId = "s-1"): Promise<string> {
  const main = c.wiring.current();
  assert.ok(main);
  const accepted = await main.submitAsk({
    submissionId,
    question,
    origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
  });
  assert.equal(accepted.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  return accepted.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED ? accepted.runId : "";
}

it.effect(
  "a spawn from main runs the child in its own conversation at depth one and hands the completion back to main as its own turn",
  (t) =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const c = yield* Effect.promise(() =>
        composed(t, delegatingScript(), { childTimers: childTimersOn(runtime) }),
      );
      yield* Effect.promise(() => c.wiring.rebuild());
      const runId = yield* Effect.promise(() => ask(c, "look into the last commit"));
      yield* waitFor(() =>
        [...c.completions.values()].some(
          (completion) => completion.delivery === COMPLETION_DELIVERY_STATUS.DELIVERED,
        ),
      );
      const main = c.wiring.current();
      assert.ok(main);
      const record = yield* Effect.promise(() => main.waitAsk(runId, 1));
      assert.equal(record?.status, "succeeded");
      const child = [...c.children.values()][0];
      assert.ok(child);
      assert.equal(child.requesterSessionKey, MAIN_SESSION_KEY);
      assert.equal(child.depth, 1);
      assert.equal(child.status, CHILD_RUN_STATUS.COMPLETED);
      assert.equal(child.resultText, "the change renamed one module");
      assert.equal(conversationKindOf(child.childSessionKey), CONVERSATION_KIND.CHILD);
      assert.equal(childIdOf(child.childSessionKey), child.childId);
      assert.ok(c.ensured.some((entry) => entry.sessionKey === child.childSessionKey));
      // The child's own turn: the task behind its marker, no announce, no delegation
      // tools beyond what its depth allows, and the minimal profile's prompt.
      const childTurn = c.seen.find((seen) =>
        seen.texts.includes(BRAIN_INPUT_MARKER.SUBAGENT_TASK),
      );
      assert.ok(childTurn);
      assert.ok(!childTurn.tools.includes(BRAIN_TOOL.ANNOUNCE));
      assert.ok(childTurn.tools.includes(BRAIN_TOOL.SESSIONS_SPAWN));
      // The completion was persisted, then delivered to main as a turn of its own.
      const completion = c.completions.get(`completion:${child.childId}`);
      assert.ok(completion);
      assert.equal(completion.destination, MAIN_SESSION_KEY);
      assert.equal(completion.delivery, COMPLETION_DELIVERY_STATUS.DELIVERED);
      const completionTurn = c.seen.find((seen) =>
        seen.texts.includes(BRAIN_INPUT_MARKER.CHILD_COMPLETION),
      );
      assert.ok(completionTurn);
      assert.ok(completionTurn.tools.includes(BRAIN_TOOL.ANNOUNCE));
      // Only main was handed the completion; the child's conversation was not.
      const completionTurns = c.seen.filter((seen) =>
        seen.texts.includes(BRAIN_INPUT_MARKER.CHILD_COMPLETION),
      );
      assert.equal(completionTurns.length, 1);
      // The child's conversation stands for an hour after its end, then archives.
      const hour = 60 * 60 * 1000;
      const sleeps = Chunk.toReadonlyArray(yield* TestClock.sleeps());
      assert.ok(
        sleeps.some((instant) => instant > hour - 10_000 && instant <= hour),
        "the archive is armed for an hour after the end",
      );
      assert.deepEqual(c.archived, []);
      yield* TestClock.adjust(Duration.millis(hour));
      yield* waitFor(() => c.archived.length > 0);
      assert.deepEqual(c.archived, [child.childSessionKey]);
      assert.equal(c.wiring.current(child.childSessionKey), undefined);
      c.wiring.retire();
      yield* Effect.promise(() => c.wiring.rebuild());
    }),
);

it.effect(
  "a child spawning a child counts one deeper, and at the depth cap the delegation tools are gone",
  (t) =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      // Every child spawns another until refused; the last child answers text.
      const script: Script = (seen) => {
        if (seen.texts.includes(BRAIN_INPUT_MARKER.DEVELOPER_ASK) && seen.outputs.length === 0) {
          return callAnswer("call-spawn", BRAIN_TOOL.SESSIONS_SPAWN, SPAWN_ARGS);
        }
        if (seen.texts.includes(BRAIN_INPUT_MARKER.SUBAGENT_TASK)) {
          if (seen.outputs.length === 0 && seen.tools.includes(BRAIN_TOOL.SESSIONS_SPAWN)) {
            return callAnswer("call-nested", BRAIN_TOOL.SESSIONS_SPAWN, SPAWN_ARGS);
          }
          return textAnswer("leaf");
        }
        return textAnswer("ok");
      };
      const c = yield* Effect.promise(() =>
        composed(t, script, { childTimers: childTimersOn(runtime) }),
      );
      yield* Effect.promise(() => c.wiring.rebuild());
      yield* Effect.promise(() => ask(c, "go deep"));
      yield* waitFor(
        () =>
          c.children.size === 5 &&
          [...c.children.values()].every((record) => record.status === CHILD_RUN_STATUS.COMPLETED),
      );
      const depths = [...c.children.values()].map((record) => record.depth).sort();
      assert.deepEqual(depths, [1, 2, 3, 4, 5]);
      const deepest = [...c.children.values()].find((record) => record.depth === 5);
      assert.ok(deepest);
      const deepestTurn = c.seen.find(
        (seen) =>
          seen.texts.includes(BRAIN_INPUT_MARKER.SUBAGENT_TASK) &&
          !seen.tools.includes(BRAIN_TOOL.SESSIONS_SPAWN),
      );
      assert.ok(deepestTurn, "the child at the cap is offered no delegation tool");
      assert.ok(!deepestTurn.tools.includes(BRAIN_TOOL.SUBAGENTS));
      assert.ok(!deepestTurn.tools.includes(BRAIN_TOOL.SESSIONS_HISTORY));
      for (const record of c.children.values()) {
        assert.equal(record.status, CHILD_RUN_STATUS.COMPLETED);
      }
      c.wiring.retire();
      yield* Effect.promise(() => c.wiring.rebuild());
    }),
);

it.effect(
  "a fork carries the requester's context into the child and an isolated child sees none of it",
  (t) =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const script: Script = (seen) => {
        if (seen.answeringTool) return textAnswer("ok");
        if (seen.lastInput.includes(BRAIN_INPUT_MARKER.CHILD_COMPLETION)) {
          return textAnswer("reviewed");
        }
        if (seen.texts.includes(BRAIN_INPUT_MARKER.SUBAGENT_TASK)) return textAnswer("child done");
        if (seen.lastAsk.includes("fork a child")) {
          return callAnswer("call-fork", BRAIN_TOOL.SESSIONS_SPAWN, {
            ...SPAWN_ARGS,
            context: CHILD_CONTEXT_MODE.FORK,
          });
        }
        if (seen.lastAsk.includes("isolated child")) {
          return callAnswer("call-iso", BRAIN_TOOL.SESSIONS_SPAWN, SPAWN_ARGS);
        }
        return textAnswer(MAIN_SECRET);
      };
      const c = yield* Effect.promise(() =>
        composed(t, script, { childTimers: childTimersOn(runtime) }),
      );
      yield* Effect.promise(() => c.wiring.rebuild());
      // Main first says something memorable, so its context holds a secret to fork.
      const first = yield* Effect.promise(() => ask(c, "remember this", "s-0"));
      yield* waitFor(() => c.wiring.current() !== undefined);
      yield* Effect.promise(
        () => c.wiring.current()?.waitAsk(first, 1) ?? Promise.resolve(undefined),
      );
      yield* Effect.promise(() => ask(c, "now fork a child", "s-fork"));
      yield* waitFor(() =>
        [...c.children.values()].some((record) => record.status === CHILD_RUN_STATUS.COMPLETED),
      );
      yield* Effect.promise(() => ask(c, "now an isolated child", "s-iso"));
      yield* waitFor(
        () =>
          c.children.size === 2 &&
          [...c.children.values()].every((record) => record.status === CHILD_RUN_STATUS.COMPLETED),
      );
      const records = [...c.children.values()];
      const forked = records.find((record) => record.context === CHILD_CONTEXT_MODE.FORK);
      const isolated = records.find((record) => record.context === CHILD_CONTEXT_MODE.ISOLATED);
      assert.ok(forked && isolated);
      assert.equal(forked.requestedContext, CHILD_CONTEXT_MODE.FORK);
      const childTurns = c.seen.filter((seen) =>
        seen.texts.includes(BRAIN_INPUT_MARKER.SUBAGENT_TASK),
      );
      assert.equal(childTurns.length, 2);
      const forkedTurn = childTurns.find((seen) => seen.texts.includes(MAIN_SECRET));
      const isolatedTurn = childTurns.find((seen) => !seen.texts.includes(MAIN_SECRET));
      assert.ok(forkedTurn, "the forked child read the requester's earlier words");
      assert.ok(isolatedTurn, "the isolated child read none of them");
      c.wiring.retire();
      yield* Effect.promise(() => c.wiring.rebuild());
    }),
);

it.effect(
  "Start fresh cancels a conversation's descendants first, and their cancellation is a completion owed to it",
  (t) =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      let releaseChild: (() => void) | undefined;
      const script: Script = (seen) => {
        if (seen.texts.includes(BRAIN_INPUT_MARKER.DEVELOPER_ASK) && seen.outputs.length === 0) {
          return callAnswer("call-spawn", BRAIN_TOOL.SESSIONS_SPAWN, SPAWN_ARGS);
        }
        return textAnswer("ok");
      };
      const c = yield* Effect.promise(() =>
        composed(
          t,
          (seen, calls) => {
            if (seen.texts.includes(BRAIN_INPUT_MARKER.SUBAGENT_TASK)) {
              // The child's model call never answers until released: the child stays running.
              return new Promise<ScriptedAnswer>((_resolve, reject) => {
                releaseChild = () => reject(new Error("aborted"));
              });
            }
            return script(seen, calls);
          },
          { childTimers: childTimersOn(runtime) },
        ),
      );
      yield* Effect.promise(() => c.wiring.rebuild());
      yield* Effect.promise(() => ask(c, "start something long"));
      yield* waitFor(() =>
        [...c.children.values()].some((record) => record.status === CHILD_RUN_STATUS.RUNNING),
      );
      const child = [...c.children.values()][0];
      assert.ok(child);
      assert.equal(child.status, CHILD_RUN_STATUS.RUNNING);
      const reset = yield* Effect.promise(() => c.wiring.resetConversation(MAIN_SESSION_KEY));
      assert.equal(reset, true);
      yield* waitFor(() => c.children.get(child.childId)?.status === CHILD_RUN_STATUS.CANCELLED);
      assert.equal(c.children.get(child.childId)?.status, CHILD_RUN_STATUS.CANCELLED);
      // The cancelled child's completion is still recorded and owed to main.
      const completion = c.completions.get(`completion:${child.childId}`);
      assert.ok(completion);
      assert.equal(completion.status, CHILD_RUN_STATUS.CANCELLED);
      releaseChild?.();
      c.wiring.retire();
      yield* Effect.promise(() => c.wiring.rebuild());
    }),
);

it("a reset capture that was skipped reports nothing, while one that failed is said so; the reset proceeds either way", async (t) => {
  for (const [outcome] of [
    [MEMORY_HOUSEKEEPING_OUTCOME.SKIPPED, false],
    [MEMORY_HOUSEKEEPING_OUTCOME.FAILED, true],
  ] as const) {
    const reports: string[] = [];
    let captures = 0;
    const c = await composed(t, () => textAnswer("ok"), {
      report: (message) => {
        reports.push(message);
      },
      memory: () => ({
        scope: { kind: MEMORY_SCOPE_KIND.ACCOUNT, key: "main" },
        provider: {
          recall: async () => ({ messages: [] }),
          capture: async (turn) => {
            captures += 1;
            assert.equal(turn.phase, MEMORY_CAPTURE_PHASE.RESET_REQUESTED);
            return { outcome, writes: 0, reason: "not an eligible private conversation" };
          },
          tools: [],
        },
      }),
    });
    await c.wiring.rebuild();
    const main = c.wiring.current();
    assert.ok(main);
    const runId = await ask(c, "remember this");
    await main.waitAsk(runId, 60_000);
    assert.equal(await c.wiring.resetConversation(MAIN_SESSION_KEY), true);
    assert.equal(captures, 1, "the capture ran over the context the reset let go of");
    c.wiring.retire();
  }
});
