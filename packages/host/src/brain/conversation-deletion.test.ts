import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "@effect/vitest";
import {
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BrainAgent,
  type BrainPersistedState,
  type BrainStateRepository,
  BrainStateStore,
  LOOK_SUBJECT,
  responsesModelAnswer,
  toolLoopRuntimeOver,
} from "@sidecar/brain";
import { inProcessStoreTransport, type StoreClient, storeClient } from "@sidecar/brain/store";
import {
  type BareResponsesModel,
  bareModelAdapter,
  fakeActionPerformer,
} from "@sidecar/brain/testing";
import {
  DEFAULT_AGENT_ID,
  MAIN_CONVERSATION_NAME,
  MAIN_SESSION_KEY,
  type ModelResponse,
  type TranscriptEvent,
} from "@sidecar/runtime/vocabulary";
import {
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  conversationLinesText,
  recentConversationEntries,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { temporaryDirectory } from "@sidecar/wire/testing";
import { Effect, Runtime } from "effect";
import type { TestContext } from "vitest";
import { ConversationThread } from "../conversation-thread.js";
import { operatorOverBrain } from "../testing/index.js";
import { CONVERSATION_DELETE_OUTCOME, deleteConversationFlow } from "./conversation-deletion.js";
import { followBrainRequests } from "./publication.js";

/**
 * The Clear composed as the main process composes it: the real database and
 * its envelope repository, the real brain store and agent, the real thread,
 * and the real deletion flow, with only the model synthetic. Every marker
 * below is a synthetic word that must be found in no context, no window, and
 * no row after the press — whatever the disk then does.
 */

const NOW = 1_800_000_000_000;
const OLD_ASK = "OLD_ASK_MARKER";
const OLD_REPLY = "OLD_REPLY_MARKER";
const OLD_COMPACTION = "OLD_COMPACTION_MARKER";
const LATE_REPLY = "LATE_REPLY_MARKER";
const AFTER_WORDS = "AFTER_THE_PRESS";

function heldClient() {
  const waiting: ((answer: ModelResponse) => void)[] = [];
  const inputs: string[] = [];
  const client: BareResponsesModel & {
    inputs: string[];
    release: (answer: ModelResponse) => void;
  } = {
    inputs,
    respond: (input) => {
      inputs.push(JSON.stringify(input));
      return new Promise((resolve) => {
        waiting.push(resolve);
      });
    },
    quietUntil: () => undefined,
    release: (answer) => {
      for (const resolve of waiting.splice(0)) resolve(answer);
    },
  };
  return client;
}

function reply(text: string, ...before: WireRecord[]): ModelResponse {
  const answer = responsesModelAnswer({
    output: [
      ...before,
      { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
    ],
  });
  assert.ok(answer);
  return answer;
}

/** The envelope repository as the store client builds it, with a switch that refuses writes. */
function repository(client: StoreClient) {
  const inner = client.brainStateRepository(MAIN_SESSION_KEY);
  const repo: BrainStateRepository & { refuse: boolean } = {
    refuse: false,
    load: () => inner.load(),
    save: (state: BrainPersistedState, transcript?: readonly TranscriptEvent[]) => {
      if (repo.refuse) throw new Error("disk refused");
      return inner.save(state, transcript);
    },
  };
  return repo;
}

async function composed(t: TestContext) {
  const root = await temporaryDirectory(t, "luke-clear-");
  const client = storeClient(inProcessStoreTransport(), Runtime.defaultRuntime);
  let clock = NOW;
  let ids = 0;
  let generations = 0;
  const reports: string[] = [];
  const repo = repository(client);
  const store = new BrainStateStore({
    repository: repo,
    createGenerationId: () => `gen-${++generations}`,
    now: () => clock,
    report: (message) => reports.push(message),
  });
  const relayed: (readonly ConversationEntry[])[] = [];
  const thread = new ConversationThread({
    store: {
      appendConversation: (entries, now) =>
        client.ask("conversation.append", { sessionKey: MAIN_SESSION_KEY, entries, now }),
    },
    now: () => clock,
    onChanged: (entries) => relayed.push(entries),
  });
  const record = (entry: ConversationEntry, at: number) =>
    thread.append([{ ...entry, recordedAt: at, eventId: `line-${++ids}` }]);
  // Every agent built here is followed as the main process follows it — the
  // one Conversation write for a run — and stopped, with its follower drained, by
  // the harness's close whatever the test asserted.
  const followers = new Map<BrainAgent, () => Promise<void>>();
  const build = (client: BareResponsesModel) => {
    const agent = new BrainAgent({
      conversationId: MAIN_SESSION_KEY,
      runtime: toolLoopRuntimeOver(bareModelAdapter(client)),
      observes: { kind: LOOK_SUBJECT.NONE },
      prepareTurn: () => ({ prompt: "instructions", layers: {} }),
      actions: fakeActionPerformer().actions,
      roster: () => ({ text: "- abc", identities: [] }),
      // The standing context as the main process renders it: the recent
      // thread, so a line the Clear left anywhere would reach the model.
      standingContext: () =>
        conversationLinesText(recentConversationEntries(thread.entries()), []) ?? "",
      readTranscriptSince: async () => ({ status: ACTION_RESULT_STATUS.REJECTED, reason: "no" }),
      readTranscript: async () => ({ status: ACTION_RESULT_STATUS.REJECTED, reason: "no" }),
      deliver: () => undefined,
      store,
      createRunId: () => `run-${++ids}`,
      report: () => undefined,
      now: () => clock,
    });
    followers.set(agent, followBrainRequests(agent, { broadcastRequests: () => undefined }));
    return agent;
  };
  const stop = async (agent: BrainAgent) => {
    await agent.stop();
    await followers.get(agent)?.();
    followers.delete(agent);
  };
  let refuseErase = false;
  let eraseGate: Promise<void> | undefined;
  const clear = () =>
    deleteConversationFlow({
      now: () => clock,
      fence: (at) => thread.fence(at),
      readCutoffBefore: async () => ({
        value: await client.ask("conversation.cutoff", { sessionKey: MAIN_SESSION_KEY }),
      }),
      fenceBrain: (at) => store.clear(at),
      erase: async (at, cutoffBefore) => {
        await eraseGate;
        if (refuseErase) return undefined;
        const generationId = store.generationId();
        const archiveId = `archive-${++ids}`;
        const outcome = await client.ask(
          "conversations.delete",
          generationId === undefined
            ? {
                sessionKey: MAIN_SESSION_KEY,
                now: at,
                archiveId,
                cutoffBefore: { value: cutoffBefore },
              }
            : {
                sessionKey: MAIN_SESSION_KEY,
                now: at,
                archiveId,
                keepSessionId: generationId,
                cutoffBefore: { value: cutoffBefore },
              },
        );
        return outcome ? { published: outcome.published } : undefined;
      },
      report: (message) => reports.push(message),
    });
  // The operator stands over whichever agent the ask names, as the host's
  // current brain would, so a rebuilt agent is submitted to like the first.
  let asking: BrainAgent | undefined;
  const operator = await operatorOverBrain({ current: () => asking });
  const submit = async (agent: BrainAgent, question: string) => {
    asking = agent;
    const result = await operator.submit({
      submissionId: `sub-${++ids}`,
      question,
      origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
    });
    assert.equal(result.outcome, "accepted");
    return result.outcome === "accepted" ? result.runId : "";
  };
  /** Every row the database holds for main, read on a second handle and flattened for a marker search. */
  const rows = () => {
    const raw = new DatabaseSync(path.join(root, "agent.sqlite"), { readOnly: true });
    try {
      return JSON.stringify({
        sessions: raw
          .prepare("SELECT session_id, reset_cleared_at FROM conversation_sessions")
          .all(),
        checkpoints: raw.prepare("SELECT item FROM runtime_checkpoints").all(),
        history: raw
          .prepare("SELECT words, recorded_at FROM conversation_events WHERE session_key = ?")
          .all(MAIN_SESSION_KEY),
        transcript: raw
          .prepare("SELECT payload FROM transcript_events WHERE session_key = ?")
          .all(MAIN_SESSION_KEY),
      });
    } finally {
      raw.close();
    }
  };
  /** The model's checkpoint items on disk, every lifetime's, flattened for a marker search. */
  const checkpoints = () => {
    const raw = new DatabaseSync(path.join(root, "agent.sqlite"), { readOnly: true });
    try {
      return JSON.stringify(raw.prepare("SELECT item FROM runtime_checkpoints").all());
    } finally {
      raw.close();
    }
  };
  /** The standing lifetime's id and marker on disk. */
  const standing = () => {
    const raw = new DatabaseSync(path.join(root, "agent.sqlite"), { readOnly: true });
    try {
      // SAFETY: the two columns selected are the ones the row type names.
      return raw
        .prepare(
          "SELECT session_id, reset_cleared_at FROM conversation_sessions WHERE session_key = ?",
        )
        .get(MAIN_SESSION_KEY) as
        | { session_id: string; reset_cleared_at: number | null }
        | undefined;
    } finally {
      raw.close();
    }
  };
  const open = async () => {
    await client.open({
      agentRoot: root,
      agentId: DEFAULT_AGENT_ID,
      sessionKey: MAIN_SESSION_KEY,
      conversationName: MAIN_CONVERSATION_NAME,
      now: clock,
    });
    thread.restore(
      await client.ask("conversation.list", { sessionKey: MAIN_SESSION_KEY, now: clock }),
      await client.ask("conversation.cutoff", { sessionKey: MAIN_SESSION_KEY }),
    );
  };
  return {
    root,
    client,
    open,
    standing,
    repo,
    store,
    thread,
    relayed,
    reports,
    build,
    stop,
    clear,
    submit,
    record,
    rows,
    checkpoints,
    tick: () => {
      clock += 1;
      return clock;
    },
    now: () => clock,
    refuseErase: (refuse: boolean) => {
      refuseErase = refuse;
    },
    holdErase: () => {
      let release: (() => void) | undefined;
      eraseGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => release?.();
    },
    close: async () => {
      for (const agent of [...followers.keys()]) await stop(agent);
      await client.close();
    },
  };
}

/** Polls a condition on Effect's own fiber scheduler rather than a fixed wall-clock wait. */
function waitFor(condition: () => boolean, rounds = 300): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (let round = 0; round < rounds; round += 1) {
      if (condition()) return;
      for (let tick = 0; tick < 100; tick += 1) yield* Effect.yieldNow();
    }
    assert.ok(condition(), "the condition did not hold in time");
  });
}

/**
 * Seeds a finished, compacted exchange whose words stand in the checkpoint,
 * the transcript, and the thread. The thread's two lines are written the way
 * the live record writes them — both speakers' settled utterances, tied to
 * the run — since the brain's publication writes no line of its own.
 */
function seeded(
  c: Awaited<ReturnType<typeof composed>>,
): Effect.Effect<{ agent: BrainAgent; client: ReturnType<typeof heldClient> }> {
  return Effect.gen(function* () {
    yield* Effect.promise(() => c.open());
    const client = heldClient();
    const agent = c.build(client);
    const first = yield* Effect.promise(() => c.submit(agent, OLD_ASK));
    assert.equal(
      yield* Effect.promise(() =>
        c.record({ kind: CONVERSATION_ENTRY_KIND.ASK, words: OLD_ASK, requestId: first }, c.tick()),
      ),
      true,
    );
    yield* waitFor(() => client.inputs.length > 0);
    client.release(
      reply(OLD_REPLY, { type: "compaction", id: "cmp_1", encrypted_content: OLD_COMPACTION }),
    );
    yield* waitFor(() => agent.request(first)?.status === BRAIN_REQUEST_STATUS.SUCCEEDED);
    assert.equal(agent.request(first)?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
    assert.equal(
      yield* Effect.promise(() =>
        c.record(
          { kind: CONVERSATION_ENTRY_KIND.REPLY, words: OLD_REPLY, requestId: first },
          c.tick(),
        ),
      ),
      true,
    );
    assert.ok(c.thread.entries().some((entry) => entry.words === OLD_REPLY));
    return { agent, client };
  });
}

/** One archive as the registry row holds it, read from the database the worker owns. */
type ArchiveRegistryRow = {
  archiveId: string;
  fileName: string;
  encoding: string;
  conversationLines: number;
  publishedAt: number | null;
};

function archivesOf(root: string): ArchiveRegistryRow[] {
  const raw = new DatabaseSync(path.join(root, "agent.sqlite"), { readOnly: true });
  try {
    // SAFETY: the columns selected are the ones the row type names, typed by the schema.
    return raw
      .prepare(
        `SELECT archive_id AS archiveId, file_name AS fileName, encoding,
                conversation_lines AS conversationLines, published_at AS publishedAt
         FROM conversation_archives ORDER BY deleted_at DESC, archive_id`,
      )
      .all() as ArchiveRegistryRow[];
  } finally {
    raw.close();
  }
}

/** The cutoff the archive's registry row recorded as standing before its deletion. */
function previousCutoffOf(root: string, archiveId: string): number | null | undefined {
  const raw = new DatabaseSync(path.join(root, "agent.sqlite"), { readOnly: true });
  try {
    // SAFETY: the one column selected is the nullable integer the schema names.
    const row = raw
      .prepare("SELECT previous_cutoff FROM conversation_archives WHERE archive_id = ?")
      .get(archiveId) as { previous_cutoff: number | null } | undefined;
    return row?.previous_cutoff;
  } finally {
    raw.close();
  }
}

it.effect(
  "a Clear under a held model answer fences the brain and the thread before any wait, keeps the line accepted after the press, archives what stood, and the next ask sees none of the old words",
  (t) =>
    Effect.gen(function* () {
      const c = yield* Effect.promise(() => composed(t));
      t.onTestFinished(() => c.close());
      const { agent, client } = yield* seeded(c);
      // A second ask whose answer is still out when the press lands, its own
      // line already on the thread the way the live record writes an utterance.
      c.tick();
      const beforeSecondAsk = client.inputs.length;
      const late = yield* Effect.promise(() => c.submit(agent, "second ask"));
      assert.equal(
        yield* Effect.promise(() =>
          c.record(
            { kind: CONVERSATION_ENTRY_KIND.ASK, words: "second ask", requestId: late },
            c.tick(),
          ),
        ),
        true,
      );
      yield* waitFor(() => client.inputs.length > beforeSecondAsk);
      const pressedAt = c.tick();
      const clearing = c.clear();
      // The fences are synchronous: the store already stands on the successor,
      // and the thread is already empty and relayed, before anything is awaited.
      assert.notEqual(c.store.generationId(), undefined);
      assert.equal(c.store.resetMarker()?.clearedAt, pressedAt);
      assert.deepEqual(c.thread.entries(), []);
      assert.deepEqual(c.relayed.at(-1), []);
      // A voice line landing a beat after the press, while the deletion waits, is the conversation's next line.
      const afterAt = c.tick();
      assert.equal(
        yield* Effect.promise(() =>
          c.record({ kind: CONVERSATION_ENTRY_KIND.ASK, words: AFTER_WORDS }, afterAt),
        ),
        true,
      );
      // The late answer lands on the fenced generation: recorded nowhere.
      client.release(reply(LATE_REPLY));
      yield* waitFor(() => agent.request(late) === undefined);
      assert.equal(yield* Effect.promise(() => clearing), CONVERSATION_DELETE_OUTCOME.COMPLETE);
      // The late run went with its generation: revoked, and standing in no record.
      assert.equal(agent.request(late), undefined);
      // The rows: the successor lifetime stands with nothing in it, the old words are gone, the later line stays.
      const standing = c.standing();
      assert.equal(standing?.session_id, c.store.generationId());
      assert.equal(standing?.reset_cleared_at, pressedAt);
      assert.deepEqual(
        (yield* Effect.promise(() =>
          c.client.ask("conversation.list", { sessionKey: MAIN_SESSION_KEY, now: c.now() }),
        )).map((entry) => entry.words),
        [AFTER_WORDS],
      );
      assert.deepEqual(
        c.thread.entries().map((entry) => entry.words),
        [AFTER_WORDS],
      );
      assert.equal(
        yield* Effect.promise(() =>
          c.client.ask("conversation.cutoff", { sessionKey: MAIN_SESSION_KEY }),
        ),
        pressedAt,
      );
      // The archive holds exactly what stood at the press, compressed on disk.
      const [archive] = archivesOf(c.root);
      assert.ok(archive);
      assert.notEqual(archive.publishedAt, null);
      // The two seeded lines and the second ask, which stood at the press; its answer never landed.
      assert.equal(archive.conversationLines, 3);
      // The same agent works on from the successor: its next ask carries none of the old words.
      const beforeNext = client.inputs.length;
      const next = yield* Effect.promise(() => c.submit(agent, "what now"));
      yield* waitFor(() => client.inputs.length > beforeNext);
      client.release(reply("fresh"));
      yield* waitFor(() => agent.request(next)?.status === BRAIN_REQUEST_STATUS.SUCCEEDED);
      assert.equal(agent.request(next)?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
      yield* Effect.promise(() => c.stop(agent));
    }),
);

it.effect(
  "a Clear whose rows the store will not remove answers refused, yet the old words reach no context, no window, and no later launch of the brain",
  (t) =>
    Effect.gen(function* () {
      const c = yield* Effect.promise(() => composed(t));
      t.onTestFinished(() => c.close());
      const { agent, client } = yield* seeded(c);
      c.refuseErase(true);
      const pressedAt = c.tick();
      assert.equal(yield* Effect.promise(() => c.clear()), CONVERSATION_DELETE_OUTCOME.REFUSED);
      // The thread is fenced in memory and by the durable cutoff the marker raised.
      assert.deepEqual(c.thread.entries(), []);
      assert.equal(
        yield* Effect.promise(() =>
          c.client.ask("conversation.cutoff", { sessionKey: MAIN_SESSION_KEY }),
        ),
        pressedAt,
      );
      assert.deepEqual(
        yield* Effect.promise(() =>
          c.client.ask("conversation.list", { sessionKey: MAIN_SESSION_KEY, now: c.now() }),
        ),
        [],
      );
      // The old checkpoint is gone from the database: the marker's successor
      // stands, empty. The transcript and lines are the refused erasure's, and
      // stay on disk behind the fences until a deletion takes them.
      assert.equal(c.standing()?.reset_cleared_at, pressedAt);
      // The same agent's next ask, and a rebuilt agent's — a credential change
      // landing now — both see none of the old words.
      const beforeAgain = client.inputs.length;
      const again = yield* Effect.promise(() => c.submit(agent, "again"));
      yield* waitFor(() => client.inputs.length > beforeAgain);
      client.release(reply("ok"));
      yield* waitFor(() => agent.request(again)?.status === BRAIN_REQUEST_STATUS.SUCCEEDED);
      yield* Effect.promise(() => c.stop(agent));
      const rebuiltClient = heldClient();
      const rebuilt = c.build(rebuiltClient);
      const afterRebuild = yield* Effect.promise(() => c.submit(rebuilt, "after a rebuild"));
      yield* waitFor(() => rebuiltClient.inputs.length > 0);
      rebuiltClient.release(reply("ok"));
      yield* waitFor(
        () => rebuilt.request(afterRebuild)?.status === BRAIN_REQUEST_STATUS.SUCCEEDED,
      );
      yield* Effect.promise(() => c.stop(rebuilt));
    }),
);

it.effect(
  "a Clear whose marker the disk refuses answers refused without touching the rows, and still fences every context; the next landed write replaces what the disk kept",
  (t) =>
    Effect.gen(function* () {
      const c = yield* Effect.promise(() => composed(t));
      t.onTestFinished(() => c.close());
      const { agent, client } = yield* seeded(c);
      c.repo.refuse = true;
      const pressedAt = c.tick();
      assert.equal(yield* Effect.promise(() => c.clear()), CONVERSATION_DELETE_OUTCOME.REFUSED);
      assert.deepEqual(archivesOf(c.root), []);
      // In memory the old generation stands nowhere: the store holds the marker
      // successor, the thread is fenced, and the agent's next ask sees no old word.
      assert.equal(c.store.resetMarker()?.clearedAt, pressedAt);
      assert.deepEqual(c.thread.entries(), []);
      c.repo.refuse = false;
      const beforeAgain = client.inputs.length;
      const next = yield* Effect.promise(() => c.submit(agent, "again"));
      yield* waitFor(() => client.inputs.length > beforeAgain);
      client.release(reply("ok"));
      yield* waitFor(() => agent.request(next)?.status === BRAIN_REQUEST_STATUS.SUCCEEDED);
      assert.equal(agent.request(next)?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
      // The acceptance's write replaced the old generation on disk with the marker successor.
      assert.equal(c.standing()?.reset_cleared_at, pressedAt);
      yield* Effect.promise(() => c.stop(agent));
    }),
);

it.effect(
  "a credential rebuild landing while the deletion waits on the disk builds over the successor, never the old checkpoint, and a second Clear during the first is harmless",
  (t) =>
    Effect.gen(function* () {
      const c = yield* Effect.promise(() => composed(t));
      t.onTestFinished(() => c.close());
      const { agent, client } = yield* seeded(c);
      yield* Effect.promise(() => c.stop(agent));
      const release = c.holdErase();
      c.tick();
      const clearing = c.clear();
      // The rebuild: a new agent over the same store, while the rows are still on disk.
      const rebuiltClient = heldClient();
      const rebuilt = c.build(rebuiltClient);
      yield* Effect.promise(() => rebuilt.ready());
      const during = yield* Effect.promise(() => c.submit(rebuilt, "during the wait"));
      yield* waitFor(() => rebuiltClient.inputs.length > 0);
      rebuiltClient.release(reply("ok"));
      yield* waitFor(() => rebuilt.request(during)?.status === BRAIN_REQUEST_STATUS.SUCCEEDED);
      // A second press while the first still waits: another fence, no harm.
      c.tick();
      const second = c.clear();
      release();
      assert.equal(yield* Effect.promise(() => clearing), CONVERSATION_DELETE_OUTCOME.COMPLETE);
      assert.equal(yield* Effect.promise(() => second), CONVERSATION_DELETE_OUTCOME.COMPLETE);
      assert.equal(c.standing()?.session_id, c.store.generationId());
      assert.equal(client.inputs.length, 1);
      yield* Effect.promise(() => c.stop(rebuilt));
    }),
);

it.effect(
  "a Clear whose marker the disk refused, followed by a Clear that lands, archives the lines still on disk under the cutoff the disk held before the press, never the refused press's own fence",
  (t) =>
    Effect.gen(function* () {
      const c = yield* Effect.promise(() => composed(t));
      t.onTestFinished(() => c.close());
      const { agent } = yield* seeded(c);
      yield* Effect.promise(() => c.stop(agent));
      // The first press: fenced in memory, marker refused, the lines still on disk.
      c.repo.refuse = true;
      c.tick();
      assert.equal(yield* Effect.promise(() => c.clear()), CONVERSATION_DELETE_OUTCOME.REFUSED);
      assert.equal(
        yield* Effect.promise(() =>
          c.client.ask("conversation.cutoff", { sessionKey: MAIN_SESSION_KEY }),
        ),
        undefined,
      );
      c.repo.refuse = false;
      // The second press lands. Its archive must record the cutoff the disk
      // held before it — none — and not the first press's in-memory fence.
      const secondAt = c.tick();
      assert.equal(yield* Effect.promise(() => c.clear()), CONVERSATION_DELETE_OUTCOME.COMPLETE);
      assert.equal(
        yield* Effect.promise(() =>
          c.client.ask("conversation.cutoff", { sessionKey: MAIN_SESSION_KEY }),
        ),
        secondAt,
      );
      const [archive] = archivesOf(c.root);
      assert.ok(archive);
      assert.equal(archive.conversationLines, 2);
      assert.equal(previousCutoffOf(c.root, archive.archiveId), null);
    }),
);
