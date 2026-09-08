import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CANDIDATE_ORIGIN,
  CANDIDATE_SESSION_KIND,
  CANDIDATE_STATUS,
  type CandidateSeed,
  CONSOLIDATION_SYSTEM_PROMPT,
  consolidationJob,
  DREAMS_FILE,
  MEMORY_HOUSEKEEPING_OUTCOME,
  promotionMarker,
} from "@sidecar/memory";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/realtime";
import {
  CronScheduler,
  recentDailyNotes,
  type ScheduledJob,
  type ScheduledJobStore,
} from "@sidecar/runtime";
import {
  type AgentRuntime,
  type ConversationRecord,
  conversationKindOf,
  DEFAULT_AGENT_ID,
  MAIN_CONVERSATION_NAME,
  MAIN_SESSION_KEY,
  RUN_END_REASON,
  type RuntimeRunRequest,
  type SessionKey,
  threadSessionKey,
} from "@sidecar/runtime-contracts";
import {
  RuntimeStoreClient,
  type RuntimeStorePort,
  serveRuntimeStore,
} from "@sidecar/runtime-store";
import { isRecord, type UnparsedWireValue } from "@sidecar/wire";
import {
  DEEP_PATH,
  type MemoryMaintenanceDependencies,
  wireMemoryMaintenance,
} from "./memory-maintenance";

const DAY_MS = 24 * 60 * 60 * 1000;
/** 03:00 local on a fixed day, so the notes' day stamps are stable in any zone the test runs in. */
const NOW = new Date(2026, 8, 8, 3, 0, 0).getTime();
const stamp = (atMs: number) => {
  const date = new Date(atMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const TODAY = stamp(NOW);
const YESTERDAY = stamp(NOW - DAY_MS);
const TWO_DAYS_AGO = stamp(NOW - 2 * DAY_MS);
const FACT = "The developer prefers pnpm over npm for every workspace install";

function client() {
  const channel = new MessageChannel();
  // SAFETY: a MessagePort posts and receives structured-clone values on the same events the port contract names.
  serveRuntimeStore(channel.port2 as unknown as RuntimeStorePort);
  // SAFETY: as above, for the client's end of the same channel.
  const store = new RuntimeStoreClient(channel.port1 as unknown as RuntimeStorePort);
  return {
    store,
    close: () => {
      channel.port1.close();
      channel.port2.close();
    },
  };
}

/** A runtime whose one answer per system prompt the test decides; it executes no tool. */
function fakeRuntime(answer: (prompt: string, input: string) => string | undefined) {
  const prompts: string[] = [];
  // SAFETY: the sweep reaches only openContext and start, both present; the rest of the runtime is never called.
  const runtime = {
    openContext: async () => ({
      context: { dispose: () => undefined, adoptCompaction: () => undefined },
      bootstrap: {},
    }),
    start: (request: RuntimeRunRequest) => {
      prompts.push(request.prompt);
      const input = request.input[0];
      const text = answer(request.prompt, input && "text" in input ? input.text : "");
      return {
        runId: request.runId,
        steer: () => false,
        cancel: () => undefined,
        done: Promise.resolve(
          text === undefined
            ? { reason: RUN_END_REASON.PROVIDER_FAILURE, failure: "upstream", detail: "down" }
            : { reason: RUN_END_REASON.COMPLETED, text },
        ),
      };
    },
  } as unknown as AgentRuntime;
  return { runtime, prompts };
}

/** The plan a well-behaved model answers: every candidate added. */
function addedPlan(input: string): string {
  // SAFETY: the prompt is the JSON the sweep built; the record check validates it.
  const parsed = JSON.parse(input) as UnparsedWireValue;
  const candidates = isRecord(parsed) && Array.isArray(parsed.candidates) ? parsed.candidates : [];
  return JSON.stringify({
    operations: candidates.filter(isRecord).map((candidate) => ({
      candidateKey: candidate.key,
      action: "added",
      priorEntries: [],
    })),
  });
}

async function harness(
  answer: (prompt: string, input: string) => string | undefined = (prompt, input) =>
    prompt === CONSOLIDATION_SYSTEM_PROMPT ? addedPlan(input) : "Dreamt of pnpm.",
  overrides: Partial<MemoryMaintenanceDependencies> = {},
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "luke-memory-maintenance-"));
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(path.join(workspace, "memory"), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, "MEMORY.md"),
    "# MEMORY.md\n\n- Deploys go out on Tuesday afternoons\n",
  );
  const { store, close } = client();
  await store.open({
    agentRoot: root,
    workspaceDirectory: workspace,
    agentId: DEFAULT_AGENT_ID,
    sessionKey: MAIN_SESSION_KEY,
    conversationName: MAIN_CONVERSATION_NAME,
    now: NOW,
  });
  const thread = threadSessionKey("11111111-1111-1111-1111-111111111111");
  const temporary = threadSessionKey("22222222-2222-2222-2222-222222222222");
  await store.createConversation({
    agentId: DEFAULT_AGENT_ID,
    sessionKey: thread,
    name: "Thread",
    now: NOW,
  });
  const records: ConversationRecord[] = [MAIN_SESSION_KEY, thread, temporary].map((sessionKey) => ({
    sessionKey,
    kind: conversationKindOf(sessionKey),
    name: sessionKey,
    createdAt: NOW,
    lastActivityAt: NOW,
  }));
  const history = new Map<SessionKey, ConversationEntry[]>();
  const fake = fakeRuntime(answer);
  const reports: string[] = [];
  let changed = 0;
  const maintenance = wireMemoryMaintenance({
    persistent: true,
    client: () => store,
    createRuntime: () => fake.runtime,
    workspaceDirectory: () => workspace,
    conversationDirectory: () => records,
    isTemporary: (sessionKey) => sessionKey === temporary,
    historyLines: (sessionKey) => history.get(sessionKey) ?? [],
    background: (work) => work(),
    now: () => NOW,
    createId: () => "id",
    report: (message) => reports.push(message),
    onNotebookChanged: () => {
      changed += 1;
    },
    ...overrides,
  });
  return {
    root,
    workspace,
    store,
    close,
    thread,
    temporary,
    history,
    maintenance,
    prompts: fake.prompts,
    reports,
    changed: () => changed,
    memory: () => fs.readFileSync(path.join(workspace, "MEMORY.md"), "utf8"),
  };
}

/** Three days of the same note line, staged as consolidation would have over three sweeps. */
async function stageRecurring(
  h: Awaited<ReturnType<typeof harness>>,
  overrides: Partial<CandidateSeed> = {},
) {
  const notePath = `memory/${TWO_DAYS_AGO}.md`;
  fs.writeFileSync(path.join(h.workspace, notePath), `# ${TWO_DAYS_AGO}\n\n- ${FACT}\n`);
  for (const [day, at] of [
    [TWO_DAYS_AGO, NOW - 2 * DAY_MS],
    [YESTERDAY, NOW - DAY_MS],
    [TODAY, NOW],
  ] as const) {
    await h.store.stageMemoryCandidates(
      [
        {
          text: FACT,
          path: notePath,
          startLine: 3,
          endLine: 3,
          origin: CANDIDATE_ORIGIN.USER,
          sessionKind: CANDIDATE_SESSION_KIND.INTERACTIVE,
          query: `ingest:${day}`,
          score: 0.8,
          day,
          ...overrides,
        },
      ],
      at,
    );
  }
  return notePath;
}

test("a sweep stages History lines once, ranks the recurring fact, applies the validated plan, and writes the diary", async () => {
  const h = await harness();
  h.history.set(MAIN_SESSION_KEY, [
    {
      kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
      words: "Remember that we always deploy on Tuesdays",
      eventId: "l1",
      recordedAt: NOW - 1_000,
    },
    {
      kind: CONVERSATION_ENTRY_KIND.REPLY,
      words: "Noted, Tuesdays it is.",
      eventId: "l2",
      recordedAt: NOW - 900,
    },
  ]);
  await stageRecurring(h);
  const first = await h.maintenance.runConsolidation();
  assert.ok(first);
  assert.equal(first.promoted, 1);
  assert.equal(first.deepPath, DEEP_PATH.MODEL_PLAN);
  assert.equal(first.diaryWritten, true);
  const memory = h.memory();
  assert.ok(memory.includes(FACT));
  assert.ok(memory.includes("- Deploys go out on Tuesday afternoons"), "prior entries stand");
  assert.ok(memory.includes(`Source: memory/${TWO_DAYS_AGO}.md#L3-L3`));
  const dreams = fs.readFileSync(path.join(h.workspace, DREAMS_FILE), "utf8");
  assert.ok(dreams.includes(`## Dream Diary (${TODAY})`));
  assert.ok(dreams.includes("Dreamt of pnpm."));
  const promoted = await h.store.listMemoryCandidates(CANDIDATE_STATUS.PROMOTED);
  assert.equal(promoted.length, 1);
  const staged = await h.store.listMemoryCandidates(CANDIDATE_STATUS.STAGED);
  const fromMain = staged.filter((candidate) => candidate.sourceSessionKey === MAIN_SESSION_KEY);
  assert.equal(fromMain.length, 2);
  assert.ok(fromMain.every((candidate) => candidate.signalCount === 1));
  assert.ok(h.changed() >= 1);

  // The same History again: nothing is learned twice, and the promoted fact takes no more signals.
  const second = await h.maintenance.runConsolidation();
  assert.ok(second);
  assert.equal(second.promoted, 0);
  const again = await h.store.listMemoryCandidates(CANDIDATE_STATUS.STAGED);
  assert.ok(
    again
      .filter((candidate) => candidate.sourceSessionKey === MAIN_SESSION_KEY)
      .every((candidate) => candidate.signalCount === 1),
    "a line already ingested adds no signal",
  );
  assert.equal(h.memory().split(FACT).length - 1, 1, "the promotion is not appended twice");
  h.close();
});

test("a candidate whose source was deleted before the deep phase is skipped, and a system-origin line never promotes however often it recurs", async () => {
  const h = await harness();
  // Three days of a thread line whose History no longer holds it.
  for (const [day, at] of [
    [TWO_DAYS_AGO, NOW - 2 * DAY_MS],
    [YESTERDAY, NOW - DAY_MS],
    [TODAY, NOW],
  ] as const) {
    await h.store.stageMemoryCandidates(
      [
        {
          text: "We decided the staging cluster moves to Frankfurt next quarter",
          path: `conversation:${h.thread}`,
          startLine: 0,
          endLine: 0,
          origin: CANDIDATE_ORIGIN.USER,
          sessionKind: CANDIDATE_SESSION_KIND.INTERACTIVE,
          sourceSessionKey: h.thread,
          sourceEventId: "gone",
          query: `ingest:${day}`,
          score: 0.8,
          day,
        },
        {
          text: "A child's tool output said the build passed on every platform tested",
          path: `conversation:${MAIN_SESSION_KEY}`,
          startLine: 0,
          endLine: 0,
          origin: CANDIDATE_ORIGIN.SYSTEM,
          sessionKind: CANDIDATE_SESSION_KIND.INTERACTIVE,
          sourceSessionKey: MAIN_SESSION_KEY,
          sourceEventId: "child",
          query: `ingest:${day}`,
          score: 0.9,
          day,
        },
      ],
      at,
    );
  }
  h.history.set(MAIN_SESSION_KEY, [
    {
      kind: CONVERSATION_ENTRY_KIND.OWN_ACT,
      words: "A child's tool output said the build passed on every platform tested",
      eventId: "child",
      recordedAt: NOW - 500,
    },
  ]);
  const report = await h.maintenance.runConsolidation();
  assert.ok(report);
  assert.equal(report.promoted, 0);
  assert.ok(
    report.notes.some((note) => /its source is gone or changed/u.test(note)),
    report.notes.join("; "),
  );
  assert.equal(h.memory().includes("Frankfurt"), false);
  assert.equal(h.memory().includes("build passed"), false);
  const staged = await h.store.listMemoryCandidates(CANDIDATE_STATUS.STAGED);
  const child = staged.find((candidate) => candidate.sourceEventId === "child");
  assert.equal(
    child?.origin,
    CANDIDATE_ORIGIN.SYSTEM,
    "an act line stays system-origin when ingested",
  );
  h.close();
});

test("an invalid rewrite falls back to the append-only path, and a hand edit between the plan and the publish refuses the rewrite", async () => {
  const invalid = await harness((prompt) =>
    prompt === CONSOLIDATION_SYSTEM_PROMPT
      ? JSON.stringify({
          operations: [{ candidateKey: "nope", action: "added", priorEntries: [] }],
        })
      : "diary",
  );
  await stageRecurring(invalid);
  const fallback = await invalid.maintenance.runConsolidation();
  assert.ok(fallback);
  assert.equal(fallback.deepPath, DEEP_PATH.APPEND_ONLY);
  assert.equal(fallback.promoted, 1);
  assert.ok(fallback.notes.some((note) => /rewrite rejected/u.test(note)));
  assert.ok(invalid.memory().includes(FACT));
  const rewrites = await invalid.store.listMemoryRewrites();
  assert.equal(
    rewrites.filter((rewrite) => rewrite.path === "MEMORY.md")[0]?.previous,
    "# MEMORY.md\n\n- Deploys go out on Tuesday afternoons\n",
  );
  invalid.close();

  let edited: Awaited<ReturnType<typeof harness>> | undefined;
  edited = await harness((prompt, input) => {
    if (prompt === CONSOLIDATION_SYSTEM_PROMPT && edited) {
      fs.appendFileSync(path.join(edited.workspace, "MEMORY.md"), "- Added by hand meanwhile\n");
      return addedPlan(input);
    }
    return "diary";
  });
  await stageRecurring(edited);
  const conflicted = await edited.maintenance.runConsolidation();
  assert.ok(conflicted);
  assert.equal(conflicted.promoted, 0);
  assert.equal(conflicted.deepPath, DEEP_PATH.NONE);
  assert.ok(conflicted.notes.some((note) => /changed since the rewrite was planned/u.test(note)));
  assert.ok(edited.memory().includes("Added by hand meanwhile"));
  assert.equal(edited.memory().includes(FACT), false);
  assert.equal(
    (await edited.store.listMemoryCandidates(CANDIDATE_STATUS.STAGED)).length >= 1,
    true,
  );
  edited.close();
});

test("forgetting a source removes its promotion by lineage, tombstones it, and reports the limitation a manual edit left", async () => {
  const h = await harness();
  const notePath = await stageRecurring(h);
  await h.maintenance.runConsolidation();
  const [promoted] = await h.store.listMemoryCandidates(CANDIDATE_STATUS.PROMOTED);
  assert.ok(promoted);
  fs.appendFileSync(
    path.join(h.workspace, "MEMORY.md"),
    "- Edited by hand Source: memory/2026-01-01.md#L1-L1\n",
  );
  const report = await h.maintenance.forget({ candidateKeys: [promoted.key], reason: "asked" });
  assert.ok(report);
  assert.equal(report.removedMemoryEntries, 1);
  assert.equal(report.limitations.length, 1);
  assert.equal(h.memory().includes(promotionMarker(promoted.key)), false);
  assert.equal(h.memory().includes(FACT), false);
  assert.ok(h.memory().includes("Edited by hand"));
  const relearn = await h.store.stageMemoryCandidates(
    [
      {
        text: FACT,
        path: notePath,
        startLine: 3,
        endLine: 3,
        origin: CANDIDATE_ORIGIN.USER,
        sessionKind: CANDIDATE_SESSION_KIND.INTERACTIVE,
        query: "ingest:later",
        score: 0.8,
        day: TODAY,
      },
    ],
    NOW + 1,
  );
  assert.deepEqual(relearn, { staged: 0, reinforced: 0, refused: 1 });
  assert.ok(h.reports.some((line) => /Memory forget limitation/u.test(line)));
  h.close();
});

test("the flush hook and the reset capture exist only for main and durable private threads, and a fresh conversation is primed with today's and yesterday's notes, slugged variants included", async () => {
  const h = await harness();
  assert.ok(h.maintenance.flushHookFor(MAIN_SESSION_KEY));
  assert.ok(h.maintenance.flushHookFor(h.thread));
  assert.equal(h.maintenance.flushHookFor(h.temporary), undefined);
  assert.equal(h.maintenance.flushMarkerFor(h.temporary), undefined);
  assert.equal(h.maintenance.capturesOnReset(h.temporary), false);
  const skipped = await h.maintenance.captureBeforeReset(h.temporary, [{ type: "message" }]);
  assert.equal(skipped.outcome, MEMORY_HOUSEKEEPING_OUTCOME.SKIPPED);
  const empty = await h.maintenance.captureBeforeReset(MAIN_SESSION_KEY, []);
  assert.equal(empty.outcome, MEMORY_HOUSEKEEPING_OUTCOME.NOTHING_TO_STORE);
  // A capture whose model fails is reported as failed, never as done.
  const failing = await harness(() => undefined);
  const failed = await failing.maintenance.captureBeforeReset(MAIN_SESSION_KEY, [
    { type: "message" },
  ]);
  assert.equal(failed.outcome, MEMORY_HOUSEKEEPING_OUTCOME.FAILED);
  failing.close();
  fs.writeFileSync(path.join(h.workspace, "memory", `${TODAY}.md`), "- today\n");
  fs.writeFileSync(path.join(h.workspace, "memory", `${YESTERDAY}-standup.md`), "- standup\n");
  fs.writeFileSync(path.join(h.workspace, "memory", `${TWO_DAYS_AGO}.md`), "- older\n");
  const primed = await recentDailyNotes(h.workspace, NOW);
  assert.deepEqual(
    primed.map((note) => note.name).sort(),
    [`${TODAY}.md`, `${YESTERDAY}-standup.md`].sort(),
  );
  h.close();
});

test("a scheduler restart keeps one consolidation job and one heartbeat, never a duplicate", async () => {
  const jobs = new Map<string, ScheduledJob>();
  const store: ScheduledJobStore = {
    list: async () => [...jobs.values()],
    put: async (job) => {
      jobs.set(job.id, job);
      return true;
    },
    delete: async (id) => jobs.delete(id),
  };
  const runs: string[] = [];
  const first = new CronScheduler({
    store,
    run: async (job) => void runs.push(job.id),
    now: () => NOW,
  });
  await first.start();
  await first.ensure(consolidationJob(NOW));
  first.stop();
  const second = new CronScheduler({
    store,
    run: async (job) => void runs.push(job.id),
    now: () => NOW,
  });
  await second.start();
  const kept = await second.ensure(consolidationJob(NOW + 5_000));
  assert.equal(kept?.createdAt, NOW, "the stored job stands; the default is not installed again");
  assert.equal(second.jobs().filter((job) => job.id === consolidationJob(NOW).id).length, 1);
  assert.equal(jobs.size, 1);
  second.stop();
});

test("the light limit bounds one sweep and the cursor advances only over the lines consumed, so the rest is staged by the next sweep rather than lost", async () => {
  const h = await harness();
  const lines: ConversationEntry[] = [];
  for (let index = 0; index < 105; index += 1) {
    lines.push({
      kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
      words: `Distinct decision number ${index} about the deployment schedule for service ${index}`,
      eventId: `line-${index}`,
      recordedAt: NOW - 10_000 + index,
    });
  }
  h.history.set(MAIN_SESSION_KEY, lines);
  const first = await h.maintenance.runConsolidation();
  assert.ok(first);
  const fromMain = (candidates: readonly { sourceSessionKey?: string }[]) =>
    candidates.filter((candidate) => candidate.sourceSessionKey === MAIN_SESSION_KEY).length;
  assert.equal(fromMain(await h.store.listMemoryCandidates()), 100);
  assert.equal(await h.store.memoryIngestionCursor(MAIN_SESSION_KEY), NOW - 10_000 + 99);
  const second = await h.maintenance.runConsolidation();
  assert.ok(second);
  assert.equal(fromMain(await h.store.listMemoryCandidates()), 105);
  assert.equal(await h.store.memoryIngestionCursor(MAIN_SESSION_KEY), NOW - 10_000 + 104);
  const third = await h.maintenance.runConsolidation();
  assert.ok(third);
  assert.equal(fromMain(await h.store.listMemoryCandidates()), 105, "nothing learned twice");
  h.close();
});

test("the flush marker is kept per conversation under the generation the brain names, and a new generation reads none", async () => {
  const h = await harness();
  const marker = h.maintenance.flushMarkerFor(MAIN_SESSION_KEY);
  assert.ok(marker);
  assert.equal(await marker.read("gen-1"), undefined);
  await marker.write("gen-1", 2);
  assert.equal(await marker.read("gen-1"), 2);
  assert.equal(
    await marker.read("gen-2"),
    undefined,
    "a marker from an earlier lifetime is never this cycle's",
  );
  const thread = h.maintenance.flushMarkerFor(h.thread);
  assert.ok(thread);
  assert.equal(
    await thread.read("gen-1"),
    undefined,
    "one conversation's marker says nothing about another's",
  );
  await thread.write("gen-1", 0);
  assert.equal(await marker.read("gen-1"), 2);
  h.close();
});

test("a completed dated note is staged beside a full History budget rather than starved past the lookback, and the budget is spent only once per note line", async () => {
  const h = await harness();
  const lines: ConversationEntry[] = [];
  for (let index = 0; index < 250; index += 1) {
    lines.push({
      kind: CONVERSATION_ENTRY_KIND.TYPED_ASK,
      words: `Distinct decision number ${index} about the deployment schedule for service ${index}`,
      eventId: `line-${index}`,
      recordedAt: NOW - 10_000 + index,
    });
  }
  h.history.set(MAIN_SESSION_KEY, lines);
  const note = Array.from(
    { length: 20 },
    (_, index) => `- Yesterday's note line ${index} about the release train for team ${index}`,
  );
  fs.writeFileSync(
    path.join(h.workspace, "memory", `${YESTERDAY}.md`),
    `# ${YESTERDAY}\n\n${note.join("\n")}\n`,
  );
  const notePath = `memory/${YESTERDAY}.md`;
  const fromNote = (candidates: readonly { path: string }[]) =>
    candidates.filter((candidate) => candidate.path === notePath).length;
  const fromMain = (candidates: readonly { sourceSessionKey?: string }[]) =>
    candidates.filter((candidate) => candidate.sourceSessionKey === MAIN_SESSION_KEY).length;
  assert.ok(await h.maintenance.runConsolidation());
  let candidates = await h.store.listMemoryCandidates();
  assert.equal(fromNote(candidates), 20, "the note takes its share ahead of the conversations");
  assert.equal(fromMain(candidates), 80, "the conversations take the rest of the limit");
  assert.ok(await h.maintenance.runConsolidation());
  candidates = await h.store.listMemoryCandidates();
  assert.equal(
    fromNote(candidates),
    20,
    "a note line already held costs no budget and is learned once",
  );
  assert.equal(fromMain(candidates), 180, "the whole limit goes to the lines the first sweep left");
  assert.ok(await h.maintenance.runConsolidation());
  assert.equal(fromMain(await h.store.listMemoryCandidates()), 250);
  h.close();
});
