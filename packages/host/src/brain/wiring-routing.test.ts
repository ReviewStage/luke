import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  BRAIN_INPUT_MARKER,
  BRAIN_REQUEST_ORIGIN,
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_TURN_TRIGGER,
  BRAIN_WAKE_KIND,
  type BrainDelivery,
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
import { CREDENTIAL_REFERENCE_KIND, memoryChildStore } from "@sidecar/runtime";
import { drainMicrotasks, temporaryDirectory } from "@sidecar/runtime/testing";
import {
  CONVERSATION_KIND,
  conversationKindOf,
  MAIN_SESSION_KEY,
  observedSessionKey,
  observedSessionRefOf,
  type SessionKey,
  threadSessionKey,
} from "@sidecar/runtime/vocabulary";
import {
  normalizeSession,
  SESSION_LOCATION,
  SESSION_STATUS,
  type Session,
  type SessionIdentity,
  type SessionProvider,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS, isRecord, isWireString, type WireRecord } from "@sidecar/wire";
import { type BrainWiring, wireBrain } from "./wiring.js";

/**
 * The wiring as the main process composes it, with the model, the disk, and
 * the providers synthetic: every observed session gets a conversation of its
 * own, main reads notices and never a transcript, and a session that leaves
 * the roster has its conversation stood down.
 */

const claude: SessionProvider = { id: "claude-code", displayName: "Claude Code" };
const conductor: SessionProvider = { id: "conductor", displayName: "Conductor" };
const ABC: SessionIdentity = { providerId: claude.id, providerSessionId: "abc" };
const DEF: SessionIdentity = { providerId: claude.id, providerSessionId: "def" };
const CLOUD: SessionIdentity = { providerId: conductor.id, providerSessionId: "cloud-1" };
const SECRET = (id: string) => `TRANSCRIPT_OF_${id}`;

function session(id: string): Session {
  return normalizeSession(claude, {
    providerSessionId: id,
    title: `Claude Code: ${id}`,
    status: SESSION_STATUS.WORKING,
    lastActivityAt: 1_800_000_000_000,
  });
}

function cloudSession(): Session {
  return normalizeSession(conductor, {
    providerSessionId: CLOUD.providerSessionId,
    title: "Conductor: cloud",
    status: SESSION_STATUS.WORKING,
    lastActivityAt: 1_800_000_000_000,
    location: SESSION_LOCATION.CLOUD,
  });
}

function answer(text: string) {
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

function itemTexts(input: readonly ResponsesInputItem[]): string[] {
  return input.flatMap((item) => {
    if (item.type !== RESPONSES_INPUT_ITEM_TYPE.MESSAGE || !Array.isArray(item.content)) return [];
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

interface Composed {
  wiring: BrainWiring;
  inputs: ResponsesInputItem[][];
  ensured: { sessionKey: SessionKey; name: string }[];
  deliveries: BrainDelivery[];
  reads: SessionIdentity[];
  roster: Session[];
  recorded: { sessionKey: SessionKey; kind: string }[];
  /** How many stores were built per conversation. */
  repositories: Map<SessionKey, number>;
  /** How many writes each conversation's envelope took. */
  writes: Map<SessionKey, number>;
  /** How many times the credential was resolved: once at construction, then once per brain built. */
  builds: () => number;
}

interface Gate {
  /** Whether an inference over this input waits for the test to release it. */
  holds: (texts: string) => boolean;
  release: () => void;
}

function composed(t: TestContext, gate?: Gate): Composed {
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
  const held = new Map<SessionKey, BrainStateRepository>();
  const repositories = new Map<SessionKey, number>();
  const writes = new Map<SessionKey, number>();
  const ensured: Composed["ensured"] = [];
  const deliveries: BrainDelivery[] = [];
  const reads: SessionIdentity[] = [];
  const recorded: Composed["recorded"] = [];
  const roster: Session[] = [session("abc"), session("def")];
  let ids = 0;
  let builds = 0;
  const workspace = temporaryDirectory(t, "luke-wiring-");
  const wiring = wireBrain({
    repositoryFor: (sessionKey) => {
      repositories.set(sessionKey, (repositories.get(sessionKey) ?? 0) + 1);
      let repository = held.get(sessionKey);
      if (!repository) {
        repository = fakeBrainStateRepository();
        held.set(sessionKey, repository);
      }
      const durable = repository;
      return {
        load: () => durable.load(),
        save: (state, transcript) => {
          writes.set(sessionKey, (writes.get(sessionKey) ?? 0) + 1);
          return durable.save(state, transcript);
        },
      };
    },
    ensureObservedConversation: async (sessionKey, name) => {
      ensured.push({ sessionKey, name });
    },
    ensureChildConversation: async (sessionKey, name) => {
      ensured.push({ sessionKey, name });
    },
    archiveConversation: async () => true,
    conversationDirectory: () => [],
    conversationLines: () => [],
    childStore: () => memoryChildStore(),
    parallelism: () => 8,
    createId: () => `id-${++ids}`,
    report: () => undefined,
    recordConversationEntry: (entry, _at, sessionKey) => {
      recorded.push({ sessionKey, kind: entry.kind });
      return true;
    },
    broadcastRequests: () => undefined,
    onGenerationReplaced: () => undefined,
    actions: {
      sessionActions: {
        perform: async () => ({ status: ACTION_RESULT_STATUS.REJECTED, reason: "not in test" }),
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
      notebook: { remember: async () => true, forget: async () => true },
      performAppAction: async (): Promise<WireRecord> => ({
        status: ACTION_RESULT_STATUS.REJECTED,
      }),
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
    // The host decides what belongs in one conversation's standing context by
    // its key; this harness reports the key it was asked about.
    standingContext: (sessionKey) => `standing context for ${sessionKey}`,
    pluginFor: (providerId) => ({
      provider: providerId === conductor.id ? conductor : claude,
      observe: async () => [],
      latest: () => [],
      reads: {
        transcriptSince: async (providerSessionId: string, cursor?: string) => {
          reads.push({ providerId, providerSessionId });
          // A cloud provider answers no incremental read; the look still opens.
          if (providerId === conductor.id) {
            return {
              status: ACTION_RESULT_STATUS.UNSUPPORTED,
              reason: "This provider keeps no transcript this build can read.",
            };
          }
          // The transcript grows once; every later read from the cursor finds
          // nothing new.
          return {
            status: ACTION_RESULT_STATUS.ACCEPTED,
            text: cursor === undefined ? SECRET(providerSessionId) : "",
            cursor: `${providerSessionId}-1`,
            truncated: false,
          };
        },
        transcript: async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED, transcript: "" }),
      },
    }),
    session: (identity) =>
      roster.find((held) => held.providerSessionId === identity.providerSessionId),
    deliver: async (delivery) => {
      deliveries.push(delivery);
    },
    model: () => model,
    credential: () => {
      builds += 1;
      return { kind: CREDENTIAL_REFERENCE_KIND.PROVIDER_KEY, providerId: "openai" };
    },
    workspaceDirectory: () => workspace,
    skillRoots: () => [],
    runnable: () => true,
    dropBriefings: () => undefined,
  });
  return {
    wiring,
    inputs,
    ensured,
    deliveries,
    reads,
    roster,
    recorded,
    repositories,
    writes,
    builds: () => builds,
  };
}

test("each conversation's standing context is built for its own key", async (t) => {
  const c = composed(t);
  await c.wiring.rebuild();
  c.wiring.rosterLook();
  await until(() => c.inputs.length >= 2 && c.wiring.pendingNotices().length === 2);
  const abcKey = observedSessionKey(ABC);
  const defKey = observedSessionKey(DEF);
  const texts = c.inputs.map((input) => itemTexts(input).join("\n"));
  // An observed conversation's ephemeral item is built for that conversation
  // alone, so what the host omits for it — the app guide, the projects a
  // workspace could be created in — is omitted where it costs every call.
  assert.ok(texts.some((text) => text.includes(`standing context for ${abcKey}`)));
  assert.ok(texts.some((text) => text.includes(`standing context for ${defKey}`)));
  for (const text of texts) {
    assert.ok(!text.includes(`standing context for ${MAIN_SESSION_KEY}`));
  }
  c.wiring.retire();
  await c.wiring.rebuild();
});

test("a roster look opens one conversation per observed session, each reading only its own transcript, and main reads notices instead", async (t) => {
  const c = composed(t);
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
  await drainMicrotasks(60);
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

test("a roster look opens a cloud session's conversation like a local one, reads no message, and stands it down when the session leaves", async (t) => {
  const c = composed(t);
  c.roster.push(cloudSession());
  await c.wiring.rebuild();
  c.wiring.rosterLook();
  await until(() => c.inputs.length >= 3 && c.wiring.pendingNotices().length === 3);
  const cloudKey = observedSessionKey(CLOUD);
  assert.ok(c.ensured.some((entry) => entry.sessionKey === cloudKey));
  assert.ok(c.wiring.current(cloudKey));
  // The cloud session's read went through its own provider and answered no
  // transcript; its turn opened on the roster fields alone, and no other
  // session's transcript reached its conversation.
  assert.deepEqual(
    c.reads.filter((identity) => identity.providerId === conductor.id),
    [CLOUD],
  );
  const cloudInput = c.inputs.find((input) => itemTexts(input).join("\n").includes("cloud-1"));
  assert.ok(cloudInput);
  const cloudTexts = itemTexts(cloudInput).join("\n");
  assert.ok(!cloudTexts.includes("TRANSCRIPT_OF"));
  assert.ok(cloudTexts.includes(`standing context for ${cloudKey}`));
  const cloudNotice = c.wiring
    .pendingNotices()
    .find((notice) => notice.label === "Conductor: cloud");
  assert.ok(cloudNotice);
  assert.equal(cloudNotice.trigger, BRAIN_TURN_TRIGGER.ROSTER);
  // A second look at the unchanged cloud session opens no inference.
  await c.wiring.rosterLook();
  await pause(200);
  assert.equal(c.inputs.length, 3);
  // Gone from the roster, its idle conversation stands down like a local one's.
  c.roster.splice(
    c.roster.findIndex((held) => held.providerId === conductor.id),
    1,
  );
  c.wiring.rosterLook();
  await until(() => c.wiring.current(cloudKey) === undefined);
  assert.ok(c.wiring.current(observedSessionKey(ABC)));
  c.wiring.retire();
  await c.wiring.rebuild();
});

test("hooks route to the session's own conversation, main is never woken by one, and a held briefing returns to its source", async (t) => {
  const c = composed(t);
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
  await drainMicrotasks(60);
  const releases = releasesSoFar();
  assert.equal(releases.length, 2);
  assert.ok(releases.some((text) => text.includes("abc finished") && !text.includes("old news")));
  assert.ok(releases.some((text) => text.includes("old news") && !text.includes("abc finished")));
  // The wake rode into the source conversation's hold-release turn, and main's carried none.
  assert.equal(observed.pendingWakes(), 0);
  c.wiring.retire();
  await c.wiring.rebuild();
});

test("a held briefing whose source conversation has stood down goes back to that conversation, reopened for it, never to main", async (t) => {
  const c = composed(t);
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
  // The release's turn ends and leaves its notice before anything is judged.
  await until(() => !(c.wiring.current(goneKey)?.busy() ?? true));
  await until(() => c.wiring.pendingNotices().length >= 1);
  await drainMicrotasks(60);
  // The source conversation is opened again for the briefing it decided:
  // it, not main, re-decides it, and the briefing is neither dropped nor
  // sent to another session's conversation.
  assert.ok(c.wiring.current(goneKey));
  assert.ok(c.ensured.some((entry) => entry.sessionKey === goneKey));
  assert.equal(releases().length, 1);
  assert.ok(releases()[0]?.includes("a session that has stood down"));
  // Main read nothing of it: the one notice is the source's own turn.
  assert.equal(c.wiring.pendingNotices().length, 1);
  c.wiring.retire();
  await c.wiring.rebuild();
});

test("a session that leaves the roster while its analysis is held keeps its conversation until the analysis ends", async (t) => {
  const gate: Gate = { holds: (texts) => texts.includes(SECRET("abc")), release: () => undefined };
  const c = composed(t, gate);
  await c.wiring.rebuild();
  const abcKey = observedSessionKey(ABC);
  c.wiring.rosterLook();
  await until(() => c.inputs.some((input) => itemTexts(input).join("\n").includes(SECRET("abc"))));
  // The analysis is out at the model, an unrecorded observation turn.
  assert.ok(c.wiring.current(abcKey)?.busy());
  // The session disappears from the roster and the look runs again.
  c.roster.splice(
    c.roster.findIndex((held) => held.providerSessionId === "abc"),
    1,
  );
  c.wiring.rosterLook();
  await drainMicrotasks(60);
  await pause(20);
  // Still standing: an analysis in flight is never cut mid-thought.
  assert.ok(c.wiring.current(abcKey));
  gate.release();
  await until(() => !(c.wiring.current(abcKey)?.busy() ?? false));
  await until(() => c.wiring.pendingNotices().some((notice) => notice.label.includes("abc")));
  // The next look, with the analysis over and nothing owed, stands it down.
  c.wiring.rosterLook();
  await until(() => c.wiring.current(abcKey) === undefined);
  c.wiring.retire();
  await c.wiring.rebuild();
});

test("a hook for a session whose conversation is standing down waits for the close and builds one store, never a second on the same envelope", async (t) => {
  const c = composed(t);
  await c.wiring.rebuild();
  const abcKey = observedSessionKey(ABC);
  c.wiring.rosterLook();
  await until(() => c.wiring.pendingNotices().length === 2);
  await until(() => !(c.wiring.current(abcKey)?.busy() ?? true));
  assert.equal(c.repositories.get(abcKey), 1);
  // abc leaves the roster: the look stands its conversation down, and a hook
  // for it lands in the same tick, while the close is still draining.
  c.roster.splice(
    c.roster.findIndex((held) => held.providerSessionId === "abc"),
    1,
  );
  c.wiring.rosterLook();
  c.wiring.wake([
    {
      kind: BRAIN_WAKE_KIND.HOOK,
      hookEvent: "Stop",
      identity: ABC,
      session: session("abc"),
      atMs: 2,
    },
  ]);
  await until(() => c.wiring.pendingNotices().length === 3);
  await drainMicrotasks(60);
  // One conversation stands for abc, on the second store built for it; the
  // first was let go of before the second was opened.
  assert.ok(c.wiring.current(abcKey));
  assert.equal(c.repositories.get(abcKey), 2);
  c.wiring.retire();
  await c.wiring.rebuild();
});

test("a rebuild landing while a conversation stands down leaves the closing host to its close, and the reopen owns the sole store", async (t) => {
  const c = composed(t);
  await c.wiring.rebuild();
  const abcKey = observedSessionKey(ABC);
  c.wiring.rosterLook();
  await until(() => c.wiring.pendingNotices().length === 2);
  await until(() => !(c.wiring.current(abcKey)?.busy() ?? true));
  assert.equal(c.repositories.get(abcKey), 1);
  const writesBefore = c.writes.get(abcKey) ?? 0;
  const buildsBefore = c.builds();
  // The close has begun and is awaiting its drain when the rebuild lands in
  // the same tick: the interleave is fixed by construction, not by timing.
  const closing = c.wiring.closeConversation(abcKey);
  await c.wiring.rebuild();
  await closing;
  assert.equal(c.wiring.current(abcKey), undefined);
  // The rebuild built main's brain and def's, and nothing onto the host the
  // close was about to discard, where no retire could ever reach it; the
  // first envelope took no write after its conversation stood down.
  await drainMicrotasks(60);
  assert.equal(c.builds() - buildsBefore, 2);
  assert.equal(c.writes.get(abcKey) ?? 0, writesBefore);
  // Reopened for a hook, the session's conversation stands on a second store
  // built after the first was let go, and it is the only one.
  c.wiring.wake([
    {
      kind: BRAIN_WAKE_KIND.HOOK,
      hookEvent: "Stop",
      identity: ABC,
      session: session("abc"),
      atMs: 2,
    },
  ]);
  await until(() => c.wiring.pendingNotices().length === 3);
  assert.ok(c.wiring.current(abcKey));
  assert.equal(c.repositories.get(abcKey), 2);
  c.wiring.retire();
  await c.wiring.rebuild();
});

test("a conversation reopened while it stands down waits for the close and stands on its own new store", async (t) => {
  const c = composed(t);
  await c.wiring.rebuild();
  const threadKey = threadSessionKey("t-1");
  await c.wiring.openConversation(threadKey);
  assert.ok(c.wiring.current(threadKey));
  assert.equal(c.repositories.get(threadKey), 1);
  // Archive then unarchive before the close has drained.
  const closing = c.wiring.closeConversation(threadKey);
  const reopening = c.wiring.openConversation(threadKey);
  await Promise.all([closing, reopening]);
  // The reopen built on nothing the close discards: its brain stands in the
  // directory, on the second store, and the first is gone.
  assert.ok(c.wiring.current(threadKey));
  assert.equal(c.repositories.get(threadKey), 2);
  c.wiring.retire();
  await c.wiring.rebuild();
});

test("two opens of one key landing in the same tick, a hook and a held briefing, build one store and list the conversation once", async (t) => {
  const c = composed(t);
  await c.wiring.rebuild();
  const abcKey = observedSessionKey(ABC);
  assert.equal(c.repositories.get(abcKey), undefined);
  // Nothing stands for abc yet; both paths reach the same opening.
  c.wiring.wake([
    {
      kind: BRAIN_WAKE_KIND.HOOK,
      hookEvent: "Stop",
      identity: ABC,
      session: session("abc"),
      atMs: 1,
    },
  ]);
  c.wiring.releaseHeld([{ briefing: "decided earlier", decidedAt: 1, sessionKey: abcKey }]);
  await until(() => c.wiring.pendingNotices().length === 2);
  await until(() => !(c.wiring.current(abcKey)?.busy() ?? true));
  assert.ok(c.wiring.current(abcKey));
  assert.equal(c.repositories.get(abcKey), 1);
  assert.equal(c.ensured.filter((entry) => entry.sessionKey === abcKey).length, 1);
  // Both turns ran, one after the other, in that one conversation: the
  // later call's context carries the hook's wake and the release together.
  assert.equal(c.inputs.length, 2);
  const last = itemTexts(c.inputs[1] ?? []).join("\n");
  assert.ok(last.includes(BRAIN_INPUT_MARKER.OBSERVED_EVENTS));
  assert.ok(last.includes(BRAIN_INPUT_MARKER.HOLD_RELEASED));
  c.wiring.retire();
  await c.wiring.rebuild();
});

test("one observed conversation waiting on its model neither blocks another nor main", async (t) => {
  const gate: Gate = { holds: (texts) => texts.includes(SECRET("def")), release: () => undefined };
  const c = composed(t, gate);
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
