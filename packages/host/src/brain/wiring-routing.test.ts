import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  BRAIN_INPUT_MARKER,
  BRAIN_REQUEST_ORIGIN,
  BRAIN_SUBMISSION_OUTCOME,
  type BrainStateRepository,
  type BrainUtterance,
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
  MAIN_SESSION_KEY,
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
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
  type SessionStatus,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS, isRecord, isWireString, type WireRecord } from "@sidecar/wire";
import { type BrainWiring, wireBrain } from "./wiring.js";

/**
 * The wiring as the main process composes it, with the model, the disk, and
 * the providers synthetic: the host's clock ticks main over the roster's
 * difference since the last tick, one turn at a time, carrying no transcript
 * text; nothing opens a conversation per observed session any more.
 */

const claude: SessionProvider = { id: "claude-code", displayName: "Claude Code" };
const conductor: SessionProvider = { id: "conductor", displayName: "Conductor" };
const ABC: SessionIdentity = { providerId: claude.id, providerSessionId: "abc" };
const DEF: SessionIdentity = { providerId: claude.id, providerSessionId: "def" };
const CLOUD: SessionIdentity = { providerId: conductor.id, providerSessionId: "cloud-1" };
const SECRET = (id: string) => `TRANSCRIPT_OF_${id}`;

function session(id: string, status: SessionStatus = SESSION_STATUS.WORKING): Session {
  return normalizeSession(claude, {
    providerSessionId: id,
    title: `Claude Code: ${id}`,
    status,
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

interface Composed {
  wiring: BrainWiring;
  inputs: ResponsesInputItem[][];
  deliveries: BrainUtterance[];
  reads: SessionIdentity[];
  roster: Session[];
  recorded: { sessionKey: SessionKey; kind: string }[];
  /** How many stores were built per conversation. */
  repositories: Map<SessionKey, number>;
  /** How many writes each conversation's envelope took. */
  writes: Map<SessionKey, number>;
  /** How many times the credential was resolved: once at construction, then once per brain built. */
  builds: () => number;
  /** What the host's own quiet answers a tick; the switch and the meeting hold are this one seam. */
  quiet: { value: boolean };
  /** While set, every inference fails upstream. */
  failing: { value: boolean };
  /** The newest tick item of every request the model was shown, in order: the history behind it carries the earlier ones. */
  ticks: () => string[];
}

interface Gate {
  /** Whether an inference over this input waits for the test to release it. */
  holds: (texts: string) => boolean;
  release: () => void;
}

function composed(t: TestContext, gate?: Gate): Composed {
  const inputs: ResponsesInputItem[][] = [];
  const waiting: (() => void)[] = [];
  const failing = { value: false };
  const client: BareResponsesModel = {
    respond: async (input) => {
      inputs.push([...input]);
      if (gate?.holds(itemTexts(input).join("\n"))) {
        await new Promise<void>((resolve) => {
          waiting.push(resolve);
        });
      }
      if (failing.value) {
        return {
          outcome: MODEL_RESPONSE_OUTCOME.FAILED,
          failure: MODEL_FAILURE.UPSTREAM,
          reason: "the model is down",
        };
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
  const deliveries: BrainUtterance[] = [];
  const reads: SessionIdentity[] = [];
  const recorded: Composed["recorded"] = [];
  const roster: Session[] = [session("abc"), session("def")];
  const quiet = { value: false };
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
    ensureChildConversation: async () => undefined,
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
          // A cloud provider answers no incremental read; the tick still counts it.
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
    deliver: async (utterance) => {
      deliveries.push(utterance);
    },
    announcementsQuiet: async () => quiet.value,
    model: () => model,
    credential: () => {
      builds += 1;
      return { kind: CREDENTIAL_REFERENCE_KIND.PROVIDER_KEY, providerId: "openai" };
    },
    workspaceDirectory: () => workspace,
    skillRoots: () => [],
    runnable: () => true,
    withdrawUtterances: () => undefined,
  });
  return {
    wiring,
    inputs,
    deliveries,
    reads,
    roster,
    recorded,
    repositories,
    writes,
    builds: () => builds,
    quiet,
    failing,
    ticks: () =>
      inputs.flatMap((input) => {
        const newest = itemTexts(input)
          .filter((text) => text.startsWith(BRAIN_INPUT_MARKER.TICK))
          .at(-1);
        return newest === undefined ? [] : [newest];
      }),
  };
}

/** One tick, awaited past the turn it opened: main is busy until its end is published. */
async function ticked(c: Composed): Promise<void> {
  await c.wiring.tick();
  await until(() => !(c.wiring.current()?.busy() ?? false));
}

function replaceSession(roster: Session[], next: Session): void {
  const index = roster.findIndex((held) => held.providerSessionId === next.providerSessionId);
  roster.splice(index, 1, next);
}

test("the first tick reports every live session as appeared, in main alone, with no transcript text; an identical roster opens no turn", async (t) => {
  const c = composed(t);
  c.roster.push(cloudSession());
  await c.wiring.rebuild();
  await ticked(c);
  assert.equal(c.inputs.length, 1);
  const [text] = c.ticks();
  assert.ok(text);
  assert.ok(
    itemTexts(c.inputs[0] ?? [])
      .join("\n")
      .includes(`standing context for ${MAIN_SESSION_KEY}`),
  );
  assert.ok(text.includes('"kind":"appeared"'));
  assert.ok(text.includes('"provider_session_id":"abc"'));
  assert.ok(text.includes('"provider_session_id":"def"'));
  assert.ok(text.includes('"provider_session_id":"cloud-1"'));
  // What a transcript gained travels as a count; the words never do,
  // and a cloud session that answers no incremental read carries no count.
  assert.ok(text.includes('"transcript_chars_gained":'));
  assert.ok(!text.includes("TRANSCRIPT_OF"));
  assert.deepEqual(c.reads, [ABC, DEF, CLOUD]);
  // No conversation stands for any session: only main.
  assert.deepEqual([...c.repositories.keys()], [MAIN_SESSION_KEY]);
  // Unchanged, the next tick opens nothing.
  await ticked(c);
  await ticked(c);
  assert.equal(c.inputs.length, 1);
  c.wiring.retire();
  await c.wiring.rebuild();
});

test("a status change opens one tick turn naming the moved field, and nothing else", async (t) => {
  const c = composed(t);
  await c.wiring.rebuild();
  await ticked(c);
  assert.equal(c.inputs.length, 1);
  replaceSession(c.roster, session("abc", SESSION_STATUS.COMPLETE));
  await ticked(c);
  assert.equal(c.inputs.length, 2);
  const text = c.ticks()[1];
  assert.ok(text);
  assert.ok(text.includes('"kind":"changed"'));
  assert.ok(text.includes('"provider_session_id":"abc"'));
  assert.ok(text.includes(`"status":"${SESSION_STATUS.COMPLETE}"`));
  assert.ok(!text.includes('"provider_session_id":"def"'));
  assert.ok(!text.includes("TRANSCRIPT_OF"));
  assert.deepEqual(c.deliveries, []);
  c.wiring.retire();
  await c.wiring.rebuild();
});

test("a vanished session is reported once, and the picture it left is forgotten", async (t) => {
  const c = composed(t);
  await c.wiring.rebuild();
  await ticked(c);
  c.roster.splice(
    c.roster.findIndex((held) => held.providerSessionId === "def"),
    1,
  );
  await ticked(c);
  assert.equal(c.inputs.length, 2);
  const text = c.ticks()[1];
  assert.ok(text);
  assert.ok(text.includes('"kind":"vanished"'));
  assert.ok(text.includes('"provider_session_id":"def"'));
  assert.ok(!text.includes('"provider_session_id":"abc"'));
  await ticked(c);
  assert.equal(c.inputs.length, 2);
  c.wiring.retire();
  await c.wiring.rebuild();
});

test("no tick is taken while main is busy; the change stands for the tick after", async (t) => {
  const gate: Gate = {
    holds: (texts) => texts.includes("are you there?"),
    release: () => undefined,
  };
  const c = composed(t, gate);
  await c.wiring.rebuild();
  await ticked(c);
  assert.equal(c.inputs.length, 1);
  const main = c.wiring.current();
  assert.ok(main);
  const accepted = await main.submitAsk({
    submissionId: "s-1",
    question: "are you there?",
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
  });
  assert.equal(accepted.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  await until(() => c.inputs.length === 2);
  replaceSession(c.roster, session("abc", SESSION_STATUS.COMPLETE));
  await c.wiring.tick();
  assert.equal(c.inputs.length, 2, "nothing piles onto a turn still thinking");
  gate.holds = () => false;
  gate.release();
  const runId = accepted.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED ? accepted.runId : "";
  await main.waitAsk(runId, 10_000);
  await until(() => !main.busy());
  await ticked(c);
  assert.equal(c.inputs.length, 3);
  assert.ok(c.ticks().at(-1)?.includes(`"status":"${SESSION_STATUS.COMPLETE}"`));
  c.wiring.retire();
  await c.wiring.rebuild();
});

test("no tick is taken while announcements are quiet; the first tick after surfaces everything that moved", async (t) => {
  const c = composed(t);
  await c.wiring.rebuild();
  await ticked(c);
  assert.equal(c.inputs.length, 1);
  c.quiet.value = true;
  replaceSession(c.roster, session("abc", SESSION_STATUS.COMPLETE));
  await ticked(c);
  replaceSession(c.roster, session("def", SESSION_STATUS.ERROR));
  await ticked(c);
  assert.equal(c.inputs.length, 1);
  assert.equal(c.reads.length, 2, "a quiet tick reads no transcript");
  c.quiet.value = false;
  await ticked(c);
  assert.equal(c.inputs.length, 2);
  const text = c.ticks()[1];
  assert.ok(text);
  assert.ok(text.includes('"provider_session_id":"abc"'));
  assert.ok(text.includes(`"status":"${SESSION_STATUS.COMPLETE}"`));
  assert.ok(text.includes('"provider_session_id":"def"'));
  assert.ok(text.includes(`"status":"${SESSION_STATUS.ERROR}"`));
  c.wiring.retire();
  await c.wiring.rebuild();
});

test("a tick whose turn failed leaves the change to surface again on the next", async (t) => {
  const c = composed(t);
  await c.wiring.rebuild();
  await ticked(c);
  assert.equal(c.inputs.length, 1);
  c.failing.value = true;
  replaceSession(c.roster, session("abc", SESSION_STATUS.COMPLETE));
  await ticked(c);
  assert.equal(c.inputs.length, 2);
  c.failing.value = false;
  await ticked(c);
  assert.equal(c.inputs.length, 3);
  const text = c.ticks()[2];
  assert.ok(text);
  assert.ok(text.includes('"provider_session_id":"abc"'));
  assert.ok(text.includes(`"status":"${SESSION_STATUS.COMPLETE}"`));
  // Seen to the end now, it is not shown a third time.
  await ticked(c);
  assert.equal(c.inputs.length, 3);
  c.wiring.retire();
  await c.wiring.rebuild();
});

test("a rebuild landing while a conversation stands down leaves the closing host to its close, and the reopen owns the sole store", async (t) => {
  const c = composed(t);
  await c.wiring.rebuild();
  const threadKey = threadSessionKey("t-1");
  await c.wiring.openConversation(threadKey);
  assert.equal(c.repositories.get(threadKey), 1);
  const writesBefore = c.writes.get(threadKey) ?? 0;
  const buildsBefore = c.builds();
  // The close has begun and is awaiting its drain when the rebuild lands in
  // the same tick: the interleave is fixed by construction, not by timing.
  const closing = c.wiring.closeConversation(threadKey);
  await c.wiring.rebuild();
  await closing;
  assert.equal(c.wiring.current(threadKey), undefined);
  // The rebuild built main's brain and nothing onto the host the close was
  // about to discard, where no retire could ever reach it; the first
  // envelope took no write after its conversation stood down.
  await drainMicrotasks(60);
  assert.equal(c.builds() - buildsBefore, 1);
  assert.equal(c.writes.get(threadKey) ?? 0, writesBefore);
  await c.wiring.openConversation(threadKey);
  assert.ok(c.wiring.current(threadKey));
  assert.equal(c.repositories.get(threadKey), 2);
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
