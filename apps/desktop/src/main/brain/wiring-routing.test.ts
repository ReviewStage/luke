import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BRAIN_INPUT_MARKER,
  BRAIN_REQUEST_ORIGIN,
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_TURN_TRIGGER,
  BRAIN_WAKE_KIND,
  type BrainDelivery,
  type BrainStateStorage,
  brainStateRepositoryFromStorage,
  RESPONSES_ITEM_TYPE,
  type ResponsesInputItem,
  responsesModelAnswer,
} from "@sidecar/brain";
import { type BareResponsesModel, bareModelAdapter } from "@sidecar/brain/testing";
import { CREDENTIAL_REFERENCE_KIND } from "@sidecar/runtime";
import {
  CONVERSATION_KIND,
  conversationKindOf,
  observedSessionKey,
  observedSessionRefOf,
  type SessionKey,
} from "@sidecar/runtime-contracts";
import {
  normalizeSession,
  SESSION_STATUS,
  type Session,
  type SessionIdentity,
  type SessionProvider,
} from "@sidecar/session";
import { ACT_RESULT_STATUS, isRecord, isWireString, type WireRecord } from "@sidecar/wire";
import { type BrainWiring, wireBrain } from "./wiring";

/**
 * The wiring as the main process composes it, with the model, the disk, and
 * the providers synthetic: every observed session gets a conversation of its
 * own, main reads notices and never a transcript, and a session that leaves
 * the roster has its conversation stood down.
 */

const claude: SessionProvider = { id: "claude-code", displayName: "Claude Code" };
const ABC: SessionIdentity = { providerId: claude.id, providerSessionId: "abc" };
const DEF: SessionIdentity = { providerId: claude.id, providerSessionId: "def" };
const SECRET = (id: string) => `TRANSCRIPT_OF_${id}`;

function session(id: string): Session {
  return normalizeSession(claude, {
    providerSessionId: id,
    title: `Claude Code: ${id}`,
    status: SESSION_STATUS.WORKING,
    lastActivityAt: 1_800_000_000_000,
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

function answer(text: string) {
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

function itemTexts(input: readonly ResponsesInputItem[]): string[] {
  return input.flatMap((item) => {
    if (item.type !== RESPONSES_ITEM_TYPE.MESSAGE || !Array.isArray(item.content)) return [];
    return item.content.flatMap((part) =>
      isRecord(part) && isWireString(part.text) ? [part.text] : [],
    );
  });
}

/** Waits until the condition holds, polling on real time: the wiring's prompt preparation reads workspace files from disk. */
async function until(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition did not hold in time");
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

/** A real-time pause, for asserting that nothing more happens. */
function pause(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function settle(): Promise<void> {
  return new Promise((resolve) => {
    let ticks = 0;
    const tick = () => {
      ticks += 1;
      if (ticks > 60) resolve();
      else setImmediate(tick);
    };
    tick();
  });
}

interface Composed {
  wiring: BrainWiring;
  inputs: ResponsesInputItem[][];
  ensured: { sessionKey: SessionKey; name: string }[];
  deliveries: BrainDelivery[];
  reads: SessionIdentity[];
  roster: Session[];
  recorded: { sessionKey: SessionKey; kind: string }[];
}

interface Gate {
  /** Whether an inference over this input waits for the test to release it. */
  holds: (texts: string) => boolean;
  release: () => void;
}

function composed(gate?: Gate): Composed {
  const inputs: ResponsesInputItem[][] = [];
  const waiting: (() => void)[] = [];
  const client: BareResponsesModel = {
    respond: async (input) => {
      inputs.push([...input]);
      if (gate?.holds(itemTexts(input).join("\n"))) {
        await new Promise<void>((resolve) => {
          waiting.push(resolve);
        });
      }
      return answer("");
    },
    quietUntil: () => undefined,
  };
  if (gate) {
    gate.release = () => {
      for (const resolve of waiting.splice(0)) resolve();
    };
  }
  const model = bareModelAdapter(client);
  const storages = new Map<SessionKey, MemoryStorage>();
  const ensured: Composed["ensured"] = [];
  const deliveries: BrainDelivery[] = [];
  const reads: SessionIdentity[] = [];
  const recorded: Composed["recorded"] = [];
  const roster: Session[] = [session("abc"), session("def")];
  let ids = 0;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "luke-wiring-"));
  const wiring = wireBrain({
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
    parallelism: () => 8,
    createId: () => `id-${++ids}`,
    report: () => undefined,
    recordConversationEntry: (entry, _at, sessionKey) => {
      recorded.push({ sessionKey, kind: entry.kind });
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
      sessions: () => roster,
      refreshSessions: async () => undefined,
      workspaceProjects: () => [],
      workspaceDefaults: async () => ({}),
      trackedIssues: () => undefined,
      appGuide: () => ({ facts: [], settings: [] }),
      rememberedFacts: () => [],
      mutateRememberedFacts: async (mutate) => mutate([], async () => true),
      performAppAct: async (): Promise<WireRecord> => ({ status: ACT_RESULT_STATUS.REJECTED }),
      recordConversationEntry: () => undefined,
    },
    roster: () => ({
      text: roster.map((held) => `- ${held.title}`).join("\n"),
      identities: roster.map((held) => ({
        providerId: held.providerId,
        providerSessionId: held.providerSessionId,
      })),
      sessions: roster,
    }),
    standingContext: () => "",
    adapterFor: () => ({
      readTranscriptSince: async (providerSessionId, cursor) => {
        reads.push({ providerId: claude.id, providerSessionId });
        // The transcript grows once; every later read from the cursor finds nothing new.
        return {
          status: ACT_RESULT_STATUS.ACCEPTED,
          text: cursor === undefined ? SECRET(providerSessionId) : "",
          cursor: `${providerSessionId}-1`,
          truncated: false,
        };
      },
      readTranscript: async () => ({ status: ACT_RESULT_STATUS.ACCEPTED, transcript: "" }),
    }),
    session: (identity) =>
      roster.find((held) => held.providerSessionId === identity.providerSessionId),
    deliver: async (delivery) => {
      deliveries.push(delivery);
    },
    model: () => model,
    credential: () => ({ kind: CREDENTIAL_REFERENCE_KIND.PROVIDER_KEY, providerId: "openai" }),
    workspaceDirectory: () => workspace,
    skillRoots: () => [],
    runnable: () => true,
    dropBriefings: () => undefined,
  });
  return { wiring, inputs, ensured, deliveries, reads, roster, recorded };
}

test("a roster look opens one conversation per observed session, each reading only its own transcript, and main reads notices instead", async () => {
  const c = composed();
  await c.wiring.rebuild();
  c.wiring.rosterLook();
  await until(() => c.inputs.length >= 2 && c.wiring.pendingNotices().length === 2);
  const abcKey = observedSessionKey(ABC);
  const defKey = observedSessionKey(DEF);
  assert.deepEqual(c.ensured.map((entry) => entry.sessionKey).sort(), [abcKey, defKey].sort());
  assert.equal(conversationKindOf(abcKey), CONVERSATION_KIND.OBSERVED);
  assert.deepEqual(observedSessionRefOf(abcKey), ABC);
  assert.ok(c.wiring.current(abcKey));
  assert.ok(c.wiring.current(defKey));
  assert.equal(c.inputs.length, 2);
  for (const input of c.inputs) {
    const texts = itemTexts(input).join("\n");
    const readsAbc = texts.includes(SECRET("abc"));
    const readsDef = texts.includes(SECRET("def"));
    // Exactly one session's transcript per conversation: never both.
    assert.notEqual(readsAbc, readsDef);
  }
  assert.deepEqual(c.reads, [ABC, DEF]);
  // Main was handed nothing to read and opened no turn of its own.
  const notices = c.wiring.pendingNotices();
  assert.equal(notices.length, 2);
  // Each notice names its source session by the label the host resolved and
  // carries the trigger as the typed vocabulary, never a transcript's words.
  assert.deepEqual(notices.map((notice) => notice.label).sort(), [
    "Claude Code: abc",
    "Claude Code: def",
  ]);
  assert.ok(notices.every((notice) => notice.trigger === BRAIN_TURN_TRIGGER.ROSTER));
  assert.ok(
    notices.every(
      (notice) => !notice.briefings.some((briefing) => briefing.includes("TRANSCRIPT_OF")),
    ),
  );
  const main = c.wiring.current();
  assert.ok(main);
  const accepted = await main.submitAsk({
    submissionId: "s-1",
    question: "what happened?",
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
  });
  assert.equal(accepted.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  await until(() => c.inputs.length >= 3);
  await settle();
  const mainInput = c.inputs[2] ?? [];
  const mainTexts = itemTexts(mainInput).join("\n");
  assert.ok(mainTexts.includes(BRAIN_INPUT_MARKER.ACTIVITY_NOTICES));
  assert.ok(mainTexts.includes("Claude Code: abc"));
  assert.ok(!mainTexts.includes("TRANSCRIPT_OF"));
  assert.deepEqual(c.wiring.pendingNotices(), []);
  // A second look at unchanged sessions opens no inference in either conversation.
  await c.wiring.rosterLook();
  await pause(200);
  assert.equal(c.inputs.length, 3);
  // A session gone from the roster has its idle conversation stood down; the other stands.
  c.roster.splice(1, 1);
  c.wiring.rosterLook();
  await until(() => c.wiring.current(defKey) === undefined);
  assert.equal(c.wiring.current(defKey), undefined);
  assert.ok(c.wiring.current(abcKey));
  c.wiring.retire();
  await c.wiring.rebuild();
});

test("hooks route to the session's own conversation, main is never woken by one, and a held briefing returns to its source", async () => {
  const c = composed();
  await c.wiring.rebuild();
  const abcKey = observedSessionKey(ABC);
  c.wiring.wake([
    {
      kind: BRAIN_WAKE_KIND.HOOK,
      hookEvent: "Stop",
      identity: ABC,
      session: session("abc"),
      atMs: 1_800_000_000_000,
    },
  ]);
  await until(() => c.wiring.current(abcKey)?.pendingWakes() === 1);
  const observed = c.wiring.current(abcKey);
  assert.ok(observed);
  assert.equal(observed.pendingWakes(), 1);
  assert.equal(c.wiring.current()?.pendingWakes(), 0);
  assert.equal(c.wiring.current(observedSessionKey(DEF)), undefined);
  // A briefing decided by that conversation carries its source, and a held one is re-decided there.
  c.wiring.releaseHeld([
    { briefing: "abc finished", decidedAt: 1, sessionKey: abcKey },
    { briefing: "old news", decidedAt: 1 },
  ]);
  const releasesSoFar = () =>
    c.inputs
      .map((input) => itemTexts(input).join("\n"))
      .filter((text) => text.includes(BRAIN_INPUT_MARKER.HOLD_RELEASED));
  await until(() => releasesSoFar().length >= 2);
  await settle();
  const releases = releasesSoFar();
  assert.equal(releases.length, 2);
  assert.ok(releases.some((text) => text.includes("abc finished") && !text.includes("old news")));
  assert.ok(releases.some((text) => text.includes("old news") && !text.includes("abc finished")));
  // The wake rode into the source conversation's hold-release turn, and main's carried none.
  assert.equal(observed.pendingWakes(), 0);
  c.wiring.retire();
  await c.wiring.rebuild();
});

test("a held briefing whose source conversation has stood down is re-decided in main, never lost", async () => {
  const c = composed();
  await c.wiring.rebuild();
  const goneKey = observedSessionKey({ providerId: claude.id, providerSessionId: "gone" });
  c.wiring.releaseHeld([
    { briefing: "a session that has stood down", decidedAt: 1, sessionKey: goneKey },
  ]);
  const releases = () =>
    c.inputs
      .map((input) => itemTexts(input).join("\n"))
      .filter((text) => text.includes(BRAIN_INPUT_MARKER.HOLD_RELEASED));
  await until(() => releases().length >= 1);
  await settle();
  // No conversation was opened for the source: main re-decides it, and the
  // briefing is neither dropped nor sent to another session's conversation.
  assert.equal(c.wiring.current(goneKey), undefined);
  assert.equal(releases().length, 1);
  assert.ok(releases()[0]?.includes("a session that has stood down"));
  c.wiring.retire();
  await c.wiring.rebuild();
});

test("a heartbeat settles only when its turn has, so a scheduler's tick is over when its work is", async () => {
  const gate: Gate = {
    holds: (texts) => texts.includes(BRAIN_INPUT_MARKER.HEARTBEAT),
    release: () => undefined,
  };
  const c = composed(gate);
  await c.wiring.rebuild();
  let settled = false;
  const tick = c.wiring.heartbeat().then(() => {
    settled = true;
  });
  await until(() => c.inputs.length >= 1);
  await settle();
  // The review is under way and the tick still open.
  assert.equal(settled, false);
  gate.release();
  await tick;
  assert.equal(settled, true);
  c.wiring.retire();
  await c.wiring.rebuild();
});

test("one observed conversation waiting on its model neither blocks another nor main", async () => {
  const gate: Gate = { holds: (texts) => texts.includes(SECRET("def")), release: () => undefined };
  const c = composed(gate);
  await c.wiring.rebuild();
  c.wiring.rosterLook();
  await until(() => c.inputs.length >= 2 && c.wiring.pendingNotices().length === 1);
  // def's inference is held; abc's has finished and left its notice.
  assert.equal(c.inputs.length, 2);
  assert.equal(c.wiring.pendingNotices().length, 1);
  assert.equal(c.wiring.pendingNotices()[0]?.label, "Claude Code: abc");
  const main = c.wiring.current();
  assert.ok(main);
  const accepted = await main.submitAsk({
    submissionId: "s-2",
    question: "are you there?",
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
  });
  assert.equal(accepted.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  const runId = accepted.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED ? accepted.runId : "";
  // Main answered while def's analysis was still held.
  const record = await main.waitAsk(runId, 10_000);
  await until(() => c.inputs.length >= 3 && c.wiring.lanes.snapshot("agent").active === 1);
  assert.equal(record?.status, "succeeded");
  assert.equal(c.inputs.length, 3);
  assert.equal(c.wiring.lanes.snapshot("agent").active, 1);
  gate.release();
  await until(
    () => c.wiring.lanes.snapshot("agent").active === 0 && c.wiring.pendingNotices().length === 1,
  );
  assert.equal(c.wiring.lanes.snapshot("agent").active, 0);
  assert.equal(c.wiring.pendingNotices().length, 1);
  assert.equal(c.wiring.pendingNotices()[0]?.label, "Claude Code: def");
  c.wiring.retire();
  await c.wiring.rebuild();
});
