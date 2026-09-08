import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BRAIN_INPUT_MARKER,
  BRAIN_REQUEST_ORIGIN,
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_TOOL,
  type BrainStateStorage,
  brainStateRepositoryFromStorage,
  RESPONSES_ITEM_TYPE,
  type ResponsesInputItem,
  responsesModelAnswer,
} from "@sidecar/brain";
import { type BareResponsesModel, bareModelAdapter } from "@sidecar/brain/testing";
import type { ConversationEntry } from "@sidecar/realtime";
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
  type SessionKey,
} from "@sidecar/runtime-contracts";
import { ACT_RESULT_STATUS, isRecord, isWireString, type WireRecord } from "@sidecar/wire";
import { type BrainWiring, wireBrain } from "./wiring";

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
    if (item.type !== RESPONSES_ITEM_TYPE.MESSAGE || !Array.isArray(item.content)) return [];
    return item.content.flatMap((part) =>
      isRecord(part) && isWireString(part.text) ? [part.text] : [],
    );
  });
}

function offeredTools(options: { tools?: readonly { name: string }[] }): readonly string[] {
  return (options.tools ?? []).map((tool) => tool.name);
}

/** Polls until the condition holds, so a slow prompt read under a loaded run is waited for rather than raced. */
async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("the condition did not hold in time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function settle(rounds = 3): Promise<void> {
  return new Promise((resolve) => {
    let ticks = 0;
    const tick = () => {
      ticks += 1;
      if (ticks > 60 * rounds) resolve();
      else setImmediate(tick);
    };
    tick();
  });
}

class MemoryStorage implements BrainStateStorage {
  file: string | undefined;
  read() {
    return this.file;
  }
  write(contents: string) {
    this.file = contents;
    return true;
  }
}

function textAnswer(text: string) {
  const answered = responsesModelAnswer({
    output: [
      {
        type: RESPONSES_ITEM_TYPE.MESSAGE,
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
        type: RESPONSES_ITEM_TYPE.FUNCTION_CALL,
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
  /** The child service's timers, held rather than fired, so an archive delay never outlives the test. */
  timers: Map<ScheduledTimer, { callback: () => void; delayMs: number }>;
}

function composed(script: Script): Composed {
  const seen: Seen[] = [];
  let calls = 0;
  const client: BareResponsesModel = {
    respond: async (input, options) => {
      const outputs = input.flatMap((item) =>
        item.type === RESPONSES_ITEM_TYPE.FUNCTION_CALL_OUTPUT && isWireString(item.output)
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
        answeringTool: before?.type === RESPONSES_ITEM_TYPE.FUNCTION_CALL_OUTPUT,
        lastInput: before ? itemTexts([before]).join("\n") : "",
      };
      seen.push(current);
      calls += 1;
      return script(current, calls);
    },
    quietUntil: () => undefined,
  };
  const model = bareModelAdapter(client);
  const storages = new Map<SessionKey, MemoryStorage>();
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
  const timers = new Map<ScheduledTimer, { callback: () => void; delayMs: number }>();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "luke-children-"));
  const wiring = wireBrain({
    childTimers: {
      schedule: (callback, delayMs) => {
        const handle: ScheduledTimer = {};
        timers.set(handle, { callback, delayMs });
        return handle;
      },
      cancel: (timer) => {
        timers.delete(timer);
      },
    },
    repositoryFor: (sessionKey) => {
      let storage = storages.get(sessionKey);
      if (!storage) {
        storage = new MemoryStorage();
        storages.set(sessionKey, storage);
      }
      return brainStateRepositoryFromStorage(storage);
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
    historyLines: (sessionKey) => history.get(sessionKey) ?? [],
    childStore: () => childStore,
    parallelism: () => 8,
    createId: () => `id-${++ids}`,
    report: () => undefined,
    recordConversationEntry: (entry, recordedAt, sessionKey) => {
      const lines = history.get(sessionKey) ?? [];
      lines.push({ ...entry, recordedAt });
      history.set(sessionKey, lines);
      return true;
    },
    broadcastRequests: () => undefined,
    onGenerationReplaced: () => undefined,
    acts: {
      sessionActs: {
        perform: async () => ({ status: ACT_RESULT_STATUS.REJECTED, reason: "not in test" }),
        openSession: () => Promise.reject(new Error("not in test")),
        openSessionApplication: () => Promise.reject(new Error("not in test")),
        openSessionChange: () => Promise.reject(new Error("not in test")),
      },
      sessions: () => [],
      refreshSessions: async () => undefined,
      workspaceProjects: () => [],
      workspaceDefaults: async () => ({}),
      trackedIssues: () => undefined,
      appGuide: () => ({ facts: [], settings: [] }),
      rememberedFacts: () => [],
      notebook: { remember: async () => true, forget: async () => true },
      performAppAct: async (): Promise<WireRecord> => ({ status: ACT_RESULT_STATUS.REJECTED }),
      recordConversationEntry: () => undefined,
    },
    roster: () => ({ text: "", identities: [], sessions: [] }),
    standingContext: () => "",
    adapterFor: () => undefined,
    session: () => undefined,
    deliver: async () => undefined,
    model: () => model,
    credential: () => ({ kind: CREDENTIAL_REFERENCE_KIND.PROVIDER_KEY, providerId: "openai" }),
    workspaceDirectory: () => workspace,
    skillRoots: () => [],
    runnable: () => true,
    dropBriefings: () => undefined,
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
    timers,
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
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
  });
  assert.equal(accepted.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  return accepted.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED ? accepted.runId : "";
}

test("a spawn from main runs the child in its own conversation at depth one and hands the completion back to main as its own turn", async () => {
  const c = composed(delegatingScript());
  await c.wiring.rebuild();
  const runId = await ask(c, "look into the last commit");
  await waitFor(() =>
    [...c.completions.values()].some(
      (completion) => completion.delivery === COMPLETION_DELIVERY_STATUS.DELIVERED,
    ),
  );
  const main = c.wiring.current();
  assert.ok(main);
  const record = await main.waitAsk(runId, 1);
  assert.equal(record?.status, "succeeded");
  // The receipt reached the model as a tool output: accepted, not completed.
  const receipt = c.seen.find((seen) => seen.outputs.length > 0)?.outputs[0] ?? "{}";
  assert.match(receipt, /"accepted":true/);
  assert.match(receipt, /"completed":false/);
  assert.match(receipt, /"context":"isolated"/);
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
  const childTurn = c.seen.find((seen) => seen.texts.includes(BRAIN_INPUT_MARKER.SUBAGENT_TASK));
  assert.ok(childTurn);
  assert.ok(childTurn.texts.includes(SPAWN_ARGS.task));
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
  assert.ok(completionTurn.texts.includes("the change renamed one module"));
  assert.ok(completionTurn.tools.includes(BRAIN_TOOL.ANNOUNCE));
  // Only main was handed the completion; the child's conversation was not.
  const completionTurns = c.seen.filter((seen) =>
    seen.texts.includes(BRAIN_INPUT_MARKER.CHILD_COMPLETION),
  );
  assert.equal(completionTurns.length, 1);
  // The child's conversation stands for an hour after its end, then archives.
  const hour = 60 * 60 * 1000;
  const archive = [...c.timers.values()].find(
    (timer) => timer.delayMs > hour - 10_000 && timer.delayMs <= hour,
  );
  assert.ok(archive, "the archive is armed for an hour after the end");
  assert.deepEqual(c.archived, []);
  archive.callback();
  await settle();
  assert.deepEqual(c.archived, [child.childSessionKey]);
  assert.equal(c.wiring.current(child.childSessionKey), undefined);
  c.wiring.retire();
  await c.wiring.rebuild();
});

test("a child spawning a child counts one deeper, and at the depth cap the delegation tools are gone", async () => {
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
  const c = composed(script);
  await c.wiring.rebuild();
  await ask(c, "go deep");
  await waitFor(
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
  await c.wiring.rebuild();
});

test("a fork carries the requester's context into the child and an isolated child sees none of it", async () => {
  const script: Script = (seen) => {
    if (seen.answeringTool) return textAnswer("ok");
    if (seen.lastInput.includes(BRAIN_INPUT_MARKER.CHILD_COMPLETION)) return textAnswer("reviewed");
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
  const c = composed(script);
  await c.wiring.rebuild();
  // Main first says something memorable, so its context holds a secret to fork.
  const first = await ask(c, "remember this", "s-0");
  await settle();
  await c.wiring.current()?.waitAsk(first, 1);
  await ask(c, "now fork a child", "s-fork");
  await waitFor(() =>
    [...c.children.values()].some((record) => record.status === CHILD_RUN_STATUS.COMPLETED),
  );
  await ask(c, "now an isolated child", "s-iso");
  await waitFor(
    () =>
      c.children.size === 2 &&
      [...c.children.values()].every((record) => record.status === CHILD_RUN_STATUS.COMPLETED),
  );
  const records = [...c.children.values()];
  const forked = records.find((record) => record.context === CHILD_CONTEXT_MODE.FORK);
  const isolated = records.find((record) => record.context === CHILD_CONTEXT_MODE.ISOLATED);
  assert.ok(forked && isolated);
  assert.equal(forked.requestedContext, CHILD_CONTEXT_MODE.FORK);
  const childTurns = c.seen.filter((seen) => seen.texts.includes(BRAIN_INPUT_MARKER.SUBAGENT_TASK));
  assert.equal(childTurns.length, 2);
  const forkedTurn = childTurns.find((seen) => seen.texts.includes(MAIN_SECRET));
  const isolatedTurn = childTurns.find((seen) => !seen.texts.includes(MAIN_SECRET));
  assert.ok(forkedTurn, "the forked child read the requester's earlier words");
  assert.ok(isolatedTurn, "the isolated child read none of them");
  c.wiring.retire();
  await c.wiring.rebuild();
});

test("Start fresh cancels a conversation's descendants first, and their cancellation is a completion owed to it", async () => {
  let releaseChild: (() => void) | undefined;
  const script: Script = (seen) => {
    if (seen.texts.includes(BRAIN_INPUT_MARKER.DEVELOPER_ASK) && seen.outputs.length === 0) {
      return callAnswer("call-spawn", BRAIN_TOOL.SESSIONS_SPAWN, SPAWN_ARGS);
    }
    return textAnswer("ok");
  };
  const c = composed((seen, calls) => {
    if (seen.texts.includes(BRAIN_INPUT_MARKER.SUBAGENT_TASK)) {
      // The child's model call never answers until released: the child stays running.
      return new Promise<ScriptedAnswer>((_resolve, reject) => {
        releaseChild = () => reject(new Error("aborted"));
      });
    }
    return script(seen, calls);
  });
  await c.wiring.rebuild();
  await ask(c, "start something long");
  await waitFor(() =>
    [...c.children.values()].some((record) => record.status === CHILD_RUN_STATUS.RUNNING),
  );
  const child = [...c.children.values()][0];
  assert.ok(child);
  assert.equal(child.status, CHILD_RUN_STATUS.RUNNING);
  const reset = await c.wiring.resetConversation(MAIN_SESSION_KEY);
  assert.equal(reset, true);
  await waitFor(() => c.children.get(child.childId)?.status === CHILD_RUN_STATUS.CANCELLED);
  assert.equal(c.children.get(child.childId)?.status, CHILD_RUN_STATUS.CANCELLED);
  // The cancelled child's completion is still recorded and owed to main.
  const completion = c.completions.get(`completion:${child.childId}`);
  assert.ok(completion);
  assert.equal(completion.status, CHILD_RUN_STATUS.CANCELLED);
  releaseChild?.();
  c.wiring.retire();
  await c.wiring.rebuild();
});
