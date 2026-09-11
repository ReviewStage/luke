import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type ProviderSessionObservation,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_COMPLETION_CAUSE,
  SESSION_STATUS,
  type SessionCompletionCause,
  SessionRoster,
  type SessionStatus,
} from "@sidecar/session";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import { type TestContext, test } from "vitest";
import { temporaryDirectory } from "../testing/temporary-directory.js";
import { codexLocalPlugin } from "./index.js";
import { isCodexRealtimeDelegationText } from "./records.js";

const TEST_TIME = Date.parse("2026-08-11T23:45:00.000Z");
const CODEX_STATE_DATABASE = "state_5.sqlite";
const STALE_AT = TEST_TIME - 20 * 60 * 1000;
const CWD = "/Users/test/luke";
const THREAD_ID = "codex-thread";
const SOURCE_THREAD_ID = "01a01c04-31e2-7be1-a478-0f321abcdef0";
const DELEGATION_TITLE =
  `<codex_delegation>\n<source_thread_id>${SOURCE_THREAD_ID}</source_thread_id>\n` +
  "<input>delegated work</input>\n</codex_delegation>";

interface TestThread {
  id?: string;
  cwd?: string;
  lastActivityAt?: number;
  source?: string;
  recencyAt?: number;
  updatedAt?: number;
  archived?: number;
  title?: string;
  firstUserMessage?: string;
  gitBranch?: string;
  model?: string;
  reasoningEffort?: string;
  /** Written to a rollout file of its own and named by the row. */
  rollout?: readonly ParsedJsonObject[];
  /** What the observation hook last spooled for this thread. */
  hookEvent?: { readonly event: string; readonly atMs: number };
}

function createThreadsTable(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      source TEXT NOT NULL,
      model_provider TEXT NOT NULL,
      cwd TEXT NOT NULL,
      title TEXT NOT NULL,
      sandbox_policy TEXT NOT NULL,
      approval_mode TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      first_user_message TEXT NOT NULL DEFAULT '',
      created_at_ms INTEGER,
      updated_at_ms INTEGER,
      preview TEXT NOT NULL DEFAULT '',
      recency_at_ms INTEGER NOT NULL DEFAULT 0,
      git_branch TEXT,
      model TEXT,
      reasoning_effort TEXT
    )
  `);
}

function insertThread(database: DatabaseSync, thread: TestThread, rolloutPath: string): void {
  const lastActivityAt = thread.lastActivityAt ?? TEST_TIME - 1_000;
  database
    .prepare(`
      INSERT INTO threads (
        id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
        sandbox_policy, approval_mode, archived, first_user_message, created_at_ms,
        updated_at_ms, preview, recency_at_ms, git_branch, model, reasoning_effort
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      thread.id ?? THREAD_ID,
      rolloutPath,
      Math.floor(lastActivityAt / 1000),
      Math.floor((thread.updatedAt ?? lastActivityAt) / 1000),
      thread.source ?? "cli",
      "openai_sse",
      thread.cwd ?? CWD,
      thread.title ?? "",
      "workspace-write",
      "never",
      thread.archived ?? 0,
      thread.firstUserMessage ?? "",
      lastActivityAt,
      thread.updatedAt ?? lastActivityAt,
      "",
      thread.recencyAt ?? lastActivityAt,
      thread.gitBranch ?? null,
      thread.model ?? null,
      thread.reasoningEffort ?? null,
    );
}

async function writeCodexSessionIndex(
  codexHome: string,
  entries: readonly { id: string; threadName: string }[],
): Promise<void> {
  await fs.writeFile(
    path.join(codexHome, "session_index.jsonl"),
    `${entries
      .map((entry) => JSON.stringify({ id: entry.id, thread_name: entry.threadName }))
      .join("\n")}\n`,
  );
}

interface CodexFixture {
  readonly threads: readonly TestThread[];
  readonly indexNames?: readonly { id: string; threadName: string }[];
}

/**
 * Seeds one Codex home — the state database, each thread's rollout, each
 * thread's spool entry — and returns the plugin standing over it.
 */
async function codexHomeWith(t: TestContext, fixture: CodexFixture) {
  const codexHome = await temporaryDirectory(t, "luke-codex-");
  const spool = path.join(codexHome, "spool");
  await fs.mkdir(spool, { recursive: true });

  const database = new DatabaseSync(path.join(codexHome, CODEX_STATE_DATABASE), {});
  try {
    createThreadsTable(database);
    for (const thread of fixture.threads) {
      const id = thread.id ?? THREAD_ID;
      const rolloutPath = thread.rollout ? path.join(codexHome, `rollout-${id}.jsonl`) : "";
      if (thread.rollout) {
        await fs.writeFile(
          rolloutPath,
          `${thread.rollout.map((record) => JSON.stringify(record)).join("\n")}\n`,
        );
      }
      insertThread(database, thread, rolloutPath);
    }
  } finally {
    database.close();
  }

  let hooked = false;
  for (const thread of fixture.threads) {
    if (!thread.hookEvent) continue;
    hooked = true;
    const filePath = path.join(spool, `${thread.id ?? THREAD_ID}.json`);
    await fs.writeFile(filePath, JSON.stringify({ event: thread.hookEvent.event }));
    await fs.utimes(filePath, thread.hookEvent.atMs / 1000, thread.hookEvent.atMs / 1000);
  }
  if (fixture.indexNames) await writeCodexSessionIndex(codexHome, fixture.indexNames);

  return {
    codexHome,
    plugin: codexLocalPlugin({
      codexHome,
      now: () => TEST_TIME,
      ...(hooked ? { hookEventsDirectory: () => spool } : undefined),
    }),
  };
}

async function observeThreads(
  t: TestContext,
  fixture: CodexFixture,
): Promise<readonly ProviderSessionObservation[]> {
  const { plugin } = await codexHomeWith(t, fixture);
  return plugin.observe();
}

async function observeOne(
  t: TestContext,
  thread: TestThread,
  indexNames?: readonly { id: string; threadName: string }[],
): Promise<ProviderSessionObservation | undefined> {
  const [observation] = await observeThreads(t, {
    threads: [thread],
    ...(indexNames ? { indexNames } : undefined),
  });
  return observation;
}

const started = { type: "event_msg", payload: { type: "task_started" } } as const;
const completed = {
  type: "event_msg",
  payload: { type: "task_complete", last_agent_message: "Done." },
} as const;

function call(name: string, argumentsJson: string): ParsedJsonObject {
  return {
    type: "response_item",
    payload: { type: "function_call", name, arguments: argumentsJson },
  };
}

function worldState(full: boolean, active: boolean): ParsedJsonObject {
  return { type: "world_state", payload: { full, state: { realtime: { active } } } };
}

function userMessage(words: string): ParsedJsonObject {
  return {
    type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text: words }] },
  };
}

// ---------------------------------------------------------------------------
// What a thread is called. Codex names its own threads, and a delegated chat's
// derived title is a marker rather than a name, so it resolves through names
// Codex actually keeps.
// ---------------------------------------------------------------------------

const TITLE_CASE: readonly {
  readonly name: string;
  readonly thread: TestThread;
  readonly indexNames?: readonly { id: string; threadName: string }[];
  readonly title: string;
  readonly parentProviderSessionId?: string;
  readonly realtimeVoice?: boolean;
}[] = [
  {
    name: "observes a Codex thread under the name Codex gave it",
    thread: { title: "Release stage-cli to npm" },
    title: "Release stage-cli to npm",
  },
  {
    name: "falls back to the workspace for a delegation marker with no name to borrow",
    thread: { cwd: "/Users/test/delegated-repository", title: DELEGATION_TITLE },
    title: "delegated-repository",
    parentProviderSessionId: SOURCE_THREAD_ID,
  },
  {
    name: "resolves a delegation marker through the source chat's indexed name",
    thread: { title: DELEGATION_TITLE },
    indexNames: [{ id: SOURCE_THREAD_ID, threadName: "Fix Luke Voice Announcements" }],
    title: "Fix Luke Voice Announcements",
    parentProviderSessionId: SOURCE_THREAD_ID,
  },
  {
    name: "prefers a delegated chat's own indexed name over its source's",
    thread: { title: DELEGATION_TITLE },
    indexNames: [
      { id: SOURCE_THREAD_ID, threadName: "Parent chat" },
      { id: THREAD_ID, threadName: "Add Claude Code archive status" },
    ],
    title: "Add Claude Code archive status",
    parentProviderSessionId: SOURCE_THREAD_ID,
  },
  {
    // Codex indexed the delegated chat's own synthetic title; preferring it
    // would put the raw marker back on the row the resolution exists to name.
    name: "a marker that leaked into the name index is still not a name",
    thread: { title: DELEGATION_TITLE },
    indexNames: [
      { id: SOURCE_THREAD_ID, threadName: "Fix Luke voice announcements" },
      { id: THREAD_ID, threadName: DELEGATION_TITLE },
    ],
    title: "Fix Luke voice announcements",
    parentProviderSessionId: SOURCE_THREAD_ID,
  },
  {
    // An empty name is the name being removed, and unmakes what an earlier
    // line said rather than being skipped past.
    name: "a name the index has since cleared no longer resolves a delegation",
    thread: { cwd: "/Users/test/delegated-repository", title: DELEGATION_TITLE },
    indexNames: [
      { id: SOURCE_THREAD_ID, threadName: "Fix Luke voice announcements" },
      { id: SOURCE_THREAD_ID, threadName: "" },
    ],
    title: "delegated-repository",
    parentProviderSessionId: SOURCE_THREAD_ID,
  },
  {
    name: "keeps a legitimate title that only resembles a delegation marker",
    thread: { title: "<codex_delegation> <source_thread_id>not-a-uuid" },
    title: "<codex_delegation> <source_thread_id>not-a-uuid",
  },
  {
    name: "a realtime delegation title with no source resolves to the workspace",
    thread: {
      cwd: "/Users/test/delegated-repository",
      title: "<realtime_delegation>\n<input>run the tests</input>\n</realtime_delegation>",
    },
    title: "delegated-repository",
    realtimeVoice: true,
  },
  {
    // The row keeps the first message for its whole life, so the marker
    // outlives Codex naming the chat.
    name: "keeps realtime delegation sessions marked after Codex names the chat",
    thread: {
      title: "What sessions do we have open?",
      firstUserMessage: "<realtime_delegation> <input>What sessions do we have open</input>",
    },
    title: "What sessions do we have open?",
    realtimeVoice: true,
  },
  {
    name: "observes the exact parent of a thread-spawn sub-agent",
    thread: {
      title: "Inspect the Conductor relationship",
      source: JSON.stringify({
        subagent: {
          thread_spawn: { parent_thread_id: SOURCE_THREAD_ID, depth: 1, agent_path: "/root" },
        },
      }),
    },
    title: "Inspect the Conductor relationship",
    parentProviderSessionId: SOURCE_THREAD_ID,
  },
];

for (const titleCase of TITLE_CASE) {
  test(titleCase.name, async (t) => {
    const observation = await observeOne(t, titleCase.thread, titleCase.indexNames);

    assert.equal(observation?.title, titleCase.title);
    assert.equal(observation?.parentProviderSessionId, titleCase.parentProviderSessionId);
    assert.equal(observation?.realtimeVoice, titleCase.realtimeVoice);
  });
}

test("recognizes the realtime delegation marker in Codex text", () => {
  assert.equal(isCodexRealtimeDelegationText("<realtime_delegation> <input>hello</input>"), true);
  assert.equal(isCodexRealtimeDelegationText("a named chat"), false);
});

test("reports the workspace, branch, model and the app that holds the thread", async (t) => {
  const observation = await observeOne(t, {
    title: "Release stage-cli to npm",
    gitBranch: "codex/bump-version",
    model: "gpt-5.6-luna",
    reasoningEffort: "medium",
  });

  assert.deepEqual(observation?.detail, {
    repository: "luke",
    branch: "codex/bump-version",
    model: "gpt-5.6-luna · medium",
    link: `codex://threads/${THREAD_ID}`,
  });
  assert.deepEqual(observation?.applications, [
    {
      id: SESSION_APPLICATION_ID.CHATGPT,
      displayName: "ChatGPT",
      scope: SESSION_APPLICATION_SCOPE.SESSION,
      link: `codex://threads/${THREAD_ID}`,
    },
  ]);
  assert.equal(observation?.advertises, undefined);
});

test("addresses a Codex thread by the id Codex files it under", async (t) => {
  // A real thread id is a UUID, but the id is Codex's to choose and it is
  // carried into an address, so one needing escaping proves it is escaped
  // rather than pasted in.
  const observation = await observeOne(t, { id: "codex thread/one?two" });

  assert.equal(observation?.detail?.link, "codex://threads/codex%20thread%2Fone%3Ftwo");
});

// ---------------------------------------------------------------------------
// What a thread is doing. `threads` carries no status column at all, so the
// rollout's turn boundary is the whole of what a row can say.
// ---------------------------------------------------------------------------

interface RowOutcome {
  readonly status: SessionStatus;
  readonly lastActivityAt: number;
  readonly completionCause?: SessionCompletionCause;
  readonly activity?: string;
  readonly error?: string;
  readonly holdingForDeveloper?: boolean;
  readonly realtimeVoiceLive?: boolean;
}

function outcomeOf(observation: ProviderSessionObservation | undefined): RowOutcome {
  assert.ok(observation, "expected the thread to be observed");
  return {
    status: observation.status,
    lastActivityAt: observation.lastActivityAt,
    ...(observation.completionCause === undefined
      ? undefined
      : { completionCause: observation.completionCause }),
    ...(observation.detail?.activity === undefined
      ? undefined
      : { activity: observation.detail.activity }),
    ...(observation.detail?.error === undefined ? undefined : { error: observation.detail.error }),
    ...(observation.holdingForDeveloper === undefined
      ? undefined
      : { holdingForDeveloper: observation.holdingForDeveloper }),
    ...(observation.realtimeVoiceLive === undefined
      ? undefined
      : { realtimeVoiceLive: observation.realtimeVoiceLive }),
  };
}

const ROLLOUT_CASE: readonly {
  readonly name: string;
  readonly thread: TestThread;
  readonly expected: RowOutcome;
}[] = [
  {
    name: "a thread with no rollout at all is working while its row is fresh",
    thread: {},
    expected: { status: SESSION_STATUS.WORKING, lastActivityAt: TEST_TIME - 1_000 },
  },
  {
    name: "keeps a stale unarchived thread unknown instead of inventing activity",
    thread: { lastActivityAt: STALE_AT },
    expected: { status: SESSION_STATUS.UNKNOWN, lastActivityAt: STALE_AT },
  },
  {
    name: "reports a finished turn as waiting for its developer",
    thread: { rollout: [started, call("exec_command", '{"cmd":"pnpm test"}'), completed] },
    expected: { status: SESSION_STATUS.WAITING, lastActivityAt: TEST_TIME - 1_000 },
  },
  {
    name: "reports a running turn as working with the call it is making",
    thread: { rollout: [completed, started, call("exec_command", '{"cmd":"pnpm test"}')] },
    expected: {
      status: SESSION_STATUS.WORKING,
      lastActivityAt: TEST_TIME - 1_000,
      activity: "exec_command: pnpm test",
    },
  },
  {
    // Codex passes a search's terms as a list rather than a string.
    name: "names a call whose argument Codex passes as a list of tokens",
    thread: { rollout: [started, call("run", '{"search_query":["notch","geometry","inset"]}')] },
    expected: {
      status: SESSION_STATUS.WORKING,
      lastActivityAt: TEST_TIME - 1_000,
      activity: "run: notch geometry inset",
    },
  },
  {
    // A plan's steps are objects, and flattening them would be noise.
    name: "names a call by its tool alone when no argument reads as a phrase",
    thread: {
      rollout: [started, call("update_plan", '{"plan":[{"step":"Read it","status":"done"}]}')],
    },
    expected: {
      status: SESSION_STATUS.WORKING,
      lastActivityAt: TEST_TIME - 1_000,
      activity: "update_plan",
    },
  },
  {
    name: "drops the previous turn's call when a new turn starts",
    thread: {
      rollout: [started, call("exec_command", '{"cmd":"pnpm test"}'), completed, started],
    },
    expected: { status: SESSION_STATUS.WORKING, lastActivityAt: TEST_TIME - 1_000 },
  },
  {
    name: "reports a turn that stopped on a standalone error event",
    thread: {
      rollout: [
        started,
        { type: "event_msg", payload: { type: "error", message: "stream disconnected" } },
      ],
    },
    expected: {
      status: SESSION_STATUS.ERROR,
      lastActivityAt: TEST_TIME - 1_000,
      error: "stream disconnected",
    },
  },
  {
    name: "reports a failed turn's error instead of its parting words",
    thread: {
      rollout: [
        started,
        {
          type: "event_msg",
          payload: {
            type: "task_complete",
            last_agent_message: "I was about to run the tests.",
            error: { message: "exceeded usage quota" },
          },
        },
      ],
    },
    expected: {
      status: SESSION_STATUS.ERROR,
      lastActivityAt: TEST_TIME - 1_000,
      error: "exceeded usage quota",
    },
  },
  {
    // A failed turn is stuck until someone comes back to it, and going stale
    // is exactly what waiting on a rescue looks like.
    name: "keeps a failed turn at error past the freshness decay",
    thread: {
      lastActivityAt: STALE_AT,
      rollout: [
        started,
        { type: "event_msg", payload: { type: "error", message: "stream disconnected" } },
      ],
    },
    expected: {
      status: SESSION_STATUS.ERROR,
      lastActivityAt: STALE_AT,
      error: "stream disconnected",
    },
  },
  {
    name: "drops the previous turn's error when a new turn starts",
    thread: {
      rollout: [
        started,
        { type: "event_msg", payload: { type: "error", message: "stream disconnected" } },
        started,
      ],
    },
    expected: { status: SESSION_STATUS.WORKING, lastActivityAt: TEST_TIME - 1_000 },
  },
  {
    name: "bounds an error to one row-sized line",
    thread: {
      rollout: [
        started,
        { type: "event_msg", payload: { type: "error", message: "x".repeat(200) } },
      ],
    },
    expected: {
      status: SESSION_STATUS.ERROR,
      lastActivityAt: TEST_TIME - 1_000,
      error: `${"x".repeat(79)}…`,
    },
  },
  {
    name: "holds a long turn at working however stale its row is",
    thread: { lastActivityAt: TEST_TIME - 30 * 60 * 1000, rollout: [started] },
    expected: { status: SESSION_STATUS.WORKING, lastActivityAt: TEST_TIME - 30 * 60 * 1000 },
  },
  {
    // The settled delegated turn still reads as waiting — the conversation is
    // what the notice layer holds its tongue about, not the row.
    name: "observes a live realtime voice conversation over a thread",
    thread: { rollout: [worldState(true, true), started, completed] },
    expected: {
      status: SESSION_STATUS.WAITING,
      lastActivityAt: TEST_TIME - 1_000,
      realtimeVoiceLive: true,
    },
  },
  {
    // The first turn after the conversation ends patches the section closed.
    name: "observes the realtime voice conversation closing on a later turn",
    thread: {
      rollout: [
        worldState(true, true),
        started,
        completed,
        worldState(false, false),
        started,
        completed,
      ],
    },
    expected: { status: SESSION_STATUS.WAITING, lastActivityAt: TEST_TIME - 1_000 },
  },
  {
    // A delegation is written only while the conversation is open, so one is
    // proof of it even when the snapshot that opened it left the bounded tail.
    name: "reads a delegation as the conversation being live when its snapshot left the tail",
    thread: {
      rollout: [
        started,
        userMessage("<realtime_delegation>\n  <input>run it</input>\n</realtime_delegation>"),
        completed,
      ],
    },
    expected: {
      status: SESSION_STATUS.WAITING,
      lastActivityAt: TEST_TIME - 1_000,
      realtimeVoiceLive: true,
    },
  },
  {
    name: "a typed user message never reads as a live voice conversation",
    thread: { rollout: [started, userMessage("please run the release script"), completed] },
    expected: { status: SESSION_STATUS.WAITING, lastActivityAt: TEST_TIME - 1_000 },
  },
];

for (const rolloutCase of ROLLOUT_CASE) {
  test(rolloutCase.name, async (t) => {
    const observation = await observeOne(t, rolloutCase.thread);

    assert.deepEqual(outcomeOf(observation), rolloutCase.expected);
  });
}

// ---------------------------------------------------------------------------
// Hook-event refinement. Every case layers a spool the observation hook would
// have written over the state database, because that is the arrangement in
// production: the rows and rollouts are always read, and the event only
// sharpens them.
// ---------------------------------------------------------------------------

const HOOK_CASE: readonly {
  readonly name: string;
  readonly thread: TestThread;
  readonly expected: RowOutcome;
}[] = [
  {
    // Mid-turn by every record: a call holding for approval writes nothing
    // further, so without the event this thread reads as working. The event
    // also dates the session: the spool is written only by Luke's own script,
    // so its clock is the moment the session actually moved.
    name: "a permission request the database cannot show turns the row to waiting",
    thread: {
      lastActivityAt: TEST_TIME - 5 * 60 * 1000,
      rollout: [started],
      hookEvent: { event: "notification", atMs: TEST_TIME - 60_000 },
    },
    expected: {
      status: SESSION_STATUS.WAITING,
      lastActivityAt: TEST_TIME - 60_000,
      holdingForDeveloper: true,
    },
  },
  {
    // A standing notification is proof the approval dialog is still up — the
    // hold writes no records, so any record at or past it would have
    // discarded it — and an ask still asking must neither flip back to active
    // work nor melt into an idle row however long it has stood.
    name: "a permission hold that outlives the freshness window is still an ask",
    thread: {
      lastActivityAt: TEST_TIME - 30 * 60 * 1000,
      rollout: [started],
      hookEvent: { event: "notification", atMs: TEST_TIME - 20 * 60 * 1000 },
    },
    expected: {
      status: SESSION_STATUS.WAITING,
      lastActivityAt: TEST_TIME - 20 * 60 * 1000,
      holdingForDeveloper: true,
    },
  },
  {
    name: "a session-end event settles a row the rollout would leave waiting",
    thread: {
      lastActivityAt: TEST_TIME - 5 * 60 * 1000,
      rollout: [completed],
      hookEvent: { event: "session-end", atMs: TEST_TIME - 60_000 },
    },
    expected: {
      status: SESSION_STATUS.COMPLETE,
      completionCause: SESSION_COMPLETION_CAUSE.SESSION_CLOSED,
      lastActivityAt: TEST_TIME - 60_000,
    },
  },
  {
    // Twenty minutes past the row's clock, the database alone decays to unknown.
    name: "a stop event keeps a finished turn waiting past the freshness decay",
    thread: {
      lastActivityAt: STALE_AT,
      rollout: [completed],
      hookEvent: { event: "stop", atMs: TEST_TIME - 60_000 },
    },
    expected: { status: SESSION_STATUS.WAITING, lastActivityAt: TEST_TIME - 60_000 },
  },
  {
    // Codex fires no failure hook, so `stop` fires for the failed turn too: an
    // event standing for the same turn must not read the failure as waiting.
    name: "a stop event does not talk a failed turn out of its error",
    thread: {
      lastActivityAt: TEST_TIME - 60_000,
      rollout: [
        started,
        {
          type: "event_msg",
          payload: { type: "task_complete", error: { message: "exceeded usage quota" } },
        },
      ],
      hookEvent: { event: "stop", atMs: TEST_TIME - 30_000 },
    },
    expected: {
      status: SESSION_STATUS.ERROR,
      lastActivityAt: TEST_TIME - 30_000,
      error: "exceeded usage quota",
    },
  },
  {
    // A stop from a minute before the row's clock: hooks were off, or the
    // write raced. The thread is demonstrably mid-turn again.
    name: "an event the thread has moved past refines nothing",
    thread: {
      lastActivityAt: TEST_TIME - 60_000,
      rollout: [started],
      hookEvent: { event: "stop", atMs: TEST_TIME - 2 * 60 * 1000 },
    },
    expected: { status: SESSION_STATUS.WORKING, lastActivityAt: TEST_TIME - 60_000 },
  },
  {
    name: "a prompt event reads a fresh turn as working before the rollout shows it",
    thread: {
      lastActivityAt: TEST_TIME - 60_000,
      rollout: [completed],
      hookEvent: { event: "prompt", atMs: TEST_TIME - 5_000 },
    },
    expected: { status: SESSION_STATUS.WORKING, lastActivityAt: TEST_TIME - 5_000 },
  },
  {
    // The approval was granted and the call ran: a row touched after the
    // notification, though within the tolerance the other events enjoy.
    name: "a notification the thread has answered stands down at once",
    thread: {
      lastActivityAt: TEST_TIME - 1_000,
      rollout: [started],
      hookEvent: { event: "notification", atMs: TEST_TIME - 3_000 },
    },
    expected: { status: SESSION_STATUS.WORKING, lastActivityAt: TEST_TIME - 1_000 },
  },
];

for (const hookCase of HOOK_CASE) {
  test(hookCase.name, async (t) => {
    const observation = await observeOne(t, hookCase.thread);

    assert.deepEqual(outcomeOf(observation), hookCase.expected);
  });
}

test("a spool that cannot be read costs only the refinement", async (t) => {
  const codexHome = await temporaryDirectory(t, "luke-codex-");
  const database = new DatabaseSync(path.join(codexHome, CODEX_STATE_DATABASE), {});
  try {
    createThreadsTable(database);
    insertThread(database, {}, "");
  } finally {
    database.close();
  }

  const [observation] = await codexLocalPlugin({
    codexHome,
    hookEventsDirectory: () => path.join(codexHome, "no-such-spool"),
    now: () => TEST_TIME,
  }).observe();

  assert.equal(observation?.status, SESSION_STATUS.WORKING);
});

// ---------------------------------------------------------------------------
// A chat another conversation delegated is a limb of that conversation: while
// the source thread's rollout says its voice conversation is open, the
// delegated chat's turn boundaries belong to the same spoken exchange.
// ---------------------------------------------------------------------------

const VOICE_LINK_CASE: readonly {
  readonly name: string;
  readonly delegated: TestThread;
  readonly title: string;
}[] = [
  {
    // The delegated chat's own rollout says nothing about the conversation
    // that spawned it; the link through the marker is what carries the hold.
    name: "a delegated chat holds announcements while its source's voice is live",
    delegated: { id: "codex-delegated", title: DELEGATION_TITLE, rollout: [started, completed] },
    title: "Fix Luke voice announcements",
  },
  {
    // Codex has named the chat, so the title no longer carries the marker; the
    // first user message is where the link has to survive.
    name: "the voice hold outlives Codex naming the delegated chat",
    delegated: {
      id: "codex-delegated",
      title: "What sessions are open?",
      firstUserMessage: DELEGATION_TITLE,
    },
    title: "What sessions are open?",
  },
];

for (const voiceCase of VOICE_LINK_CASE) {
  test(voiceCase.name, async (t) => {
    const observations = await observeThreads(t, {
      threads: [
        {
          id: SOURCE_THREAD_ID,
          lastActivityAt: TEST_TIME - 2_000,
          title: "Fix Luke voice announcements",
          rollout: [worldState(true, true), started, completed],
        },
        voiceCase.delegated,
      ],
    });

    const source = observations.find((o) => o.providerSessionId === SOURCE_THREAD_ID);
    const delegated = observations.find((o) => o.providerSessionId === "codex-delegated");
    assert.equal(source?.realtimeVoiceLive, true);
    assert.equal(delegated?.realtimeVoiceLive, true);
    assert.equal(delegated?.title, voiceCase.title);
  });
}

// ---------------------------------------------------------------------------
// What is not a row at all.
// ---------------------------------------------------------------------------

test("hides archived threads however recently they were touched", async (t) => {
  // Archiving touches the row's clock, so the freshly-touched archived thread
  // is the one that would resurface if anything short of the archive flag
  // itself decided the roster.
  const observations = await observeThreads(t, {
    threads: [
      { id: "old-session", cwd: "/Users/test/old", lastActivityAt: TEST_TIME - 90_000 },
      {
        id: "just-archived-session",
        cwd: "/Users/test/archived",
        lastActivityAt: TEST_TIME - 3 * 24 * 60 * 60 * 1000,
        recencyAt: TEST_TIME - 3 * 24 * 60 * 60 * 1000,
        updatedAt: TEST_TIME - 1_000,
        archived: 1,
      },
      {
        id: "long-archived-session",
        cwd: "/Users/test/long-archived",
        lastActivityAt: TEST_TIME - 3 * 24 * 60 * 60 * 1000,
        archived: 1,
      },
      { id: "new-session", cwd: "/Users/test/new", lastActivityAt: TEST_TIME - 10_000 },
    ],
  });

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["new-session", "old-session"],
  );
});

test("a thread archived between passes leaves the roster and stays gone", async (t) => {
  const { codexHome, plugin } = await codexHomeWith(t, {
    threads: [{ id: "codex-live", lastActivityAt: TEST_TIME - 10_000 }],
  });
  const registry = new SessionRoster();

  await registry.refresh(plugin);
  assert.deepEqual(
    registry.list().map((session) => session.providerSessionId),
    ["codex-live"],
  );

  const database = new DatabaseSync(path.join(codexHome, CODEX_STATE_DATABASE), {});
  try {
    // Codex touches the row's clock as it archives — exactly the touch that
    // must not read as fresh news.
    database
      .prepare("UPDATE threads SET archived = 1, updated_at_ms = ?, recency_at_ms = ? WHERE id = ?")
      .run(TEST_TIME, TEST_TIME, "codex-live");
  } finally {
    database.close();
  }

  await registry.refresh(plugin);
  assert.deepEqual(registry.list(), []);
});

test("observes nothing where Codex has no local state database", async (t) => {
  const codexHome = await temporaryDirectory(t, "luke-codex-");

  const plugin = codexLocalPlugin({ codexHome, now: () => TEST_TIME });

  assert.deepEqual(await plugin.observe(), []);
  assert.deepEqual(plugin.latest(), []);
});
