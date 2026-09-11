import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  type ProviderSessionObservation,
  SESSION_COMPLETION_CAUSE,
  SESSION_STATUS,
  type SessionCompletionCause,
  type SessionStatus,
} from "@sidecar/session";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import { type TestContext, test } from "vitest";
import { temporaryDirectory } from "../testing/temporary-directory.js";
import { claudeCodePlugin } from "./index.js";
import { CLAUDE_PROJECTS_DIRECTORY } from "./records.js";

const TEST_TIME = Date.parse("2026-08-11T23:45:00.000Z");
const SECRET_TRANSCRIPT_TEXT = "SECRET_TRANSCRIPT_TEXT";
const SESSION_ID = "session-under-test";
const PROJECT_DIRECTORY = "-Users-test-luke";
const CWD = "/Users/test/luke";

/**
 * Longer than the bounded tail one observation pass reads, so a record written
 * before it sits outside that tail however small the rest of the file is.
 */
const PAST_TAIL_TEXT = "x".repeat(96 * 1024);
/** One filler record's words: forty of them outweigh that same tail. */
const PAST_TAIL_FILLER = SECRET_TRANSCRIPT_TEXT.repeat(200);

async function temporaryClaudeHome(t: TestContext): Promise<string> {
  return temporaryDirectory(t, "luke-claude-code-");
}

interface SessionFile {
  readonly sessionId?: string;
  readonly projectDirectoryName?: string;
  readonly records: readonly ParsedJsonObject[];
  readonly mtimeMs?: number;
}

async function writeSessionFile(claudeHome: string, file: SessionFile): Promise<void> {
  const projectDirectory = path.join(
    claudeHome,
    CLAUDE_PROJECTS_DIRECTORY,
    file.projectDirectoryName ?? PROJECT_DIRECTORY,
  );
  await fs.mkdir(projectDirectory, { recursive: true });
  const filePath = path.join(projectDirectory, `${file.sessionId ?? SESSION_ID}.jsonl`);
  await fs.writeFile(
    filePath,
    `${file.records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
  const mtimeMs = file.mtimeMs ?? TEST_TIME - 1_000;
  await fs.utimes(filePath, mtimeMs / 1000, mtimeMs / 1000);
}

async function writeHookEvent(
  spoolDirectory: string,
  providerSessionId: string,
  event: string,
  mtimeMs: number,
): Promise<void> {
  await fs.mkdir(spoolDirectory, { recursive: true });
  const filePath = path.join(spoolDirectory, `${providerSessionId}.json`);
  await fs.writeFile(filePath, JSON.stringify({ event }));
  await fs.utimes(filePath, mtimeMs / 1000, mtimeMs / 1000);
}

async function observeSessions(
  t: TestContext,
  files: readonly SessionFile[],
  hookEventsDirectory?: () => string | undefined,
): Promise<readonly ProviderSessionObservation[]> {
  const claudeHome = await temporaryClaudeHome(t);
  for (const file of files) await writeSessionFile(claudeHome, file);
  return claudeCodePlugin({
    claudeHome,
    now: () => TEST_TIME,
    ...(hookEventsDirectory ? { hookEventsDirectory } : undefined),
  }).observe();
}

async function observeOne(
  t: TestContext,
  file: SessionFile,
): Promise<ProviderSessionObservation | undefined> {
  const [observation] = await observeSessions(t, [file]);
  return observation;
}

function user(timestamp: string, extra: ParsedJsonObject = {}): ParsedJsonObject {
  return { type: "user", cwd: CWD, timestamp, ...extra };
}

function assistant(timestamp: string, message: ParsedJsonObject = {}): ParsedJsonObject {
  return { type: "assistant", cwd: CWD, timestamp, message };
}

function system(
  subtype: string,
  timestamp: string,
  extra: ParsedJsonObject = {},
): ParsedJsonObject {
  return { type: "system", subtype, cwd: CWD, timestamp, ...extra };
}

function toolUse(name: string, input?: ParsedJsonObject): ParsedJsonObject {
  return { type: "tool_use", name, ...(input ? { input } : undefined) };
}

/** A transcript mid-turn: the assistant reached for a tool and has not returned. */
function midTurn(timestamp: string): readonly ParsedJsonObject[] {
  return [assistant(timestamp, { stop_reason: "tool_use", content: [toolUse("Bash")] })];
}

/**
 * What one transcript's records resolve to. Title, repository, branch and
 * model are the session's identity rather than its state, and have tables of
 * their own below, so a lattice row can be compared whole.
 */
interface RowOutcome {
  readonly status: SessionStatus;
  readonly lastActivityAt: number;
  readonly completionCause?: SessionCompletionCause;
  readonly activity?: string;
  readonly error?: string;
  readonly holdingForDeveloper?: boolean;
}

function outcomeOf(observation: ProviderSessionObservation | undefined): RowOutcome {
  assert.ok(observation, "expected the session to be observed");
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
  };
}

const STALE = "2026-08-11T23:25:00.000Z";
const FRESH = "2026-08-11T23:44:55.000Z";
const STALE_MTIME = TEST_TIME - 20 * 60 * 1000;

/**
 * One transcript per case, and the row its tail resolves to. Every branch of
 * Claude Code's status lattice is a row here.
 */
const TAIL_CASE: readonly {
  readonly name: string;
  readonly records: readonly ParsedJsonObject[];
  readonly mtimeMs?: number;
  readonly expected: RowOutcome;
}[] = [
  {
    name: "a settled turn holds for the developer",
    records: [
      user("2026-08-11T23:44:50.000Z", { message: { content: SECRET_TRANSCRIPT_TEXT } }),
      assistant(FRESH),
    ],
    expected: { status: SESSION_STATUS.WAITING, lastActivityAt: Date.parse(FRESH) },
  },
  {
    name: "a prompt gone quiet is unknown instead of inventing activity",
    records: [user(STALE)],
    mtimeMs: STALE_MTIME,
    expected: { status: SESSION_STATUS.UNKNOWN, lastActivityAt: Date.parse(STALE) },
  },
  {
    name: "a settled turn gone quiet leaves attention",
    records: [assistant(STALE)],
    mtimeMs: STALE_MTIME,
    expected: { status: SESSION_STATUS.UNKNOWN, lastActivityAt: Date.parse(STALE) },
  },
  {
    name: "a trailing system record decides no status of its own",
    records: [assistant(FRESH), system("turn-complete", "2026-08-11T23:44:58.000Z")],
    expected: {
      status: SESSION_STATUS.WAITING,
      lastActivityAt: Date.parse("2026-08-11T23:44:58.000Z"),
    },
  },
  {
    name: "a fresh assistant tool call is active work",
    records: [assistant(FRESH, { content: [toolUse("Read")] })],
    expected: {
      status: SESSION_STATUS.WORKING,
      lastActivityAt: Date.parse(FRESH),
      activity: "Read",
    },
  },
  {
    name: "a large tail with no completing record stays active",
    records: [
      assistant(FRESH, { content: [toolUse("Read")] }),
      user("2026-08-11T23:44:58.000Z", {
        toolUseResult: { type: "tool_result", content: PAST_TAIL_TEXT },
      }),
    ],
    expected: {
      status: SESSION_STATUS.WORKING,
      lastActivityAt: Date.parse("2026-08-11T23:44:58.000Z"),
      activity: "Read",
    },
  },
  {
    name: "a failed request is an error once the retries are spent",
    records: [
      assistant("2026-08-11T23:44:50.000Z", { stop_reason: "tool_use", content: [] }),
      system("api_error", FRESH, {
        error: { formatted: "429 rate limit exceeded", status: 429 },
        retryInMs: 1056.6,
        retryAttempt: 10,
        maxRetries: 10,
      }),
    ],
    expected: {
      status: SESSION_STATUS.ERROR,
      lastActivityAt: Date.parse(FRESH),
      error: "429 rate limit exceeded",
    },
  },
  {
    // Claude Code records every backoff, not only the attempt that gives up.
    // Interrupting on the first would be an interruption about nothing.
    name: "a retry the session is still backing off from stays working",
    records: [
      assistant("2026-08-11T23:44:50.000Z", { stop_reason: "tool_use", content: [] }),
      system("api_error", FRESH, {
        error: { formatted: "529 Overloaded", status: 529 },
        retryInMs: 575.1,
        retryAttempt: 1,
        maxRetries: 10,
      }),
    ],
    expected: { status: SESSION_STATUS.WORKING, lastActivityAt: Date.parse(FRESH) },
  },
  {
    // The row would otherwise show the failure text under an "Idle" chip, and
    // stop sorting as a session that needs someone.
    name: "a spent failure stays an error after it goes stale",
    records: [
      system("api_error", STALE, {
        error: { formatted: "429 rate limit exceeded", status: 429 },
        retryAttempt: 10,
        maxRetries: 10,
      }),
    ],
    mtimeMs: STALE_MTIME,
    expected: {
      status: SESSION_STATUS.ERROR,
      lastActivityAt: Date.parse(STALE),
      error: "429 rate limit exceeded",
    },
  },
  {
    name: "a recorded error is cleared once the session gets past it",
    records: [
      system("api_error", "2026-08-11T23:44:50.000Z", { error: { formatted: "529 overloaded" } }),
      assistant(FRESH, { stop_reason: "tool_use", content: [] }),
    ],
    expected: { status: SESSION_STATUS.WORKING, lastActivityAt: Date.parse(FRESH) },
  },
  {
    // A tool left behind here would make the settled session read as though it
    // were still working on it.
    name: "a tool stops being reported once the turn that ran it ends",
    records: [
      assistant("2026-08-11T23:44:50.000Z", {
        stop_reason: "tool_use",
        content: [toolUse("Bash", { description: "Run the macOS packaging check" })],
      }),
      user("2026-08-11T23:44:52.000Z", { message: { content: [{ type: "tool_result" }] } }),
      assistant(FRESH, { stop_reason: "end_turn", content: [{ type: "text", text: "Passed." }] }),
    ],
    expected: { status: SESSION_STATUS.WAITING, lastActivityAt: Date.parse(FRESH) },
  },
  {
    name: "a tool keeps being reported between one call and the next",
    records: [
      assistant("2026-08-11T23:44:50.000Z", {
        stop_reason: "tool_use",
        content: [toolUse("Bash", { description: "Run the macOS packaging check" })],
      }),
      user("2026-08-11T23:44:52.000Z", { message: { content: [{ type: "tool_result" }] } }),
    ],
    expected: {
      status: SESSION_STATUS.WORKING,
      lastActivityAt: Date.parse("2026-08-11T23:44:52.000Z"),
      activity: "Bash: Run the macOS packaging check",
    },
  },
  {
    name: "a result settles the row as finished work",
    records: [
      assistant("2026-08-11T23:44:50.000Z"),
      { type: "result", cwd: CWD, timestamp: FRESH },
    ],
    expected: {
      status: SESSION_STATUS.COMPLETE,
      completionCause: SESSION_COMPLETION_CAUSE.WORK_FINISHED,
      lastActivityAt: Date.parse(FRESH),
    },
  },
];

for (const tailCase of TAIL_CASE) {
  test(tailCase.name, async (t) => {
    const observation = await observeOne(t, {
      records: tailCase.records,
      ...(tailCase.mtimeMs === undefined ? undefined : { mtimeMs: tailCase.mtimeMs }),
    });

    assert.deepEqual(outcomeOf(observation), tailCase.expected);
  });
}

// ---------------------------------------------------------------------------
// Hook-event refinement. Every case layers a spool the observation hook would
// have written over a transcript, because that is the arrangement in
// production: the tail is always read, and the event only sharpens it.
// ---------------------------------------------------------------------------

const HOOK_CASE: readonly {
  readonly name: string;
  readonly records: readonly ParsedJsonObject[];
  readonly mtimeMs: number;
  readonly event: string;
  readonly eventAtMs: number;
  readonly expected: RowOutcome;
}[] = [
  {
    // Mid-turn by every record: a tool call holding for permission writes
    // nothing further, so without the event this session reads as working.
    // The event also dates the session: the spool is written only by Luke's
    // own script, so its clock cannot suffer the transcripts' bulk-touch
    // problem.
    name: "a permission prompt the transcript cannot show turns the row to waiting",
    records: midTurn("2026-08-11T23:40:00.000Z"),
    mtimeMs: TEST_TIME - 5 * 60 * 1000,
    event: "notification",
    eventAtMs: TEST_TIME - 60_000,
    expected: {
      status: SESSION_STATUS.WAITING,
      lastActivityAt: TEST_TIME - 60_000,
      // The tool it is holding on is still what it is doing.
      activity: "Bash",
      holdingForDeveloper: true,
    },
  },
  {
    name: "a session-end event settles a row the tail would leave waiting",
    records: [assistant("2026-08-11T23:40:00.000Z", { stop_reason: "end_turn", content: [] })],
    mtimeMs: TEST_TIME - 5 * 60 * 1000,
    event: "session-end",
    eventAtMs: TEST_TIME - 60_000,
    expected: {
      status: SESSION_STATUS.COMPLETE,
      completionCause: SESSION_COMPLETION_CAUSE.SESSION_CLOSED,
      lastActivityAt: TEST_TIME - 60_000,
    },
  },
  {
    name: "a stop-failure event reports the error the tail was still suppressing",
    records: [
      // Mid-backoff bookkeeping, which on its own is rightly suppressed.
      system("api_error", "2026-08-11T23:40:00.000Z", {
        retryAttempt: 1,
        maxRetries: 10,
        error: { message: "rate limited" },
      }),
    ],
    mtimeMs: TEST_TIME - 5 * 60 * 1000,
    event: "stop-failure",
    eventAtMs: TEST_TIME - 60_000,
    expected: { status: SESSION_STATUS.ERROR, lastActivityAt: TEST_TIME - 60_000 },
  },
  {
    // Twenty minutes past the last record, the tail alone decays to unknown.
    name: "a stop event keeps a finished turn waiting past the freshness decay",
    records: [assistant(STALE, { stop_reason: "end_turn", content: [] })],
    mtimeMs: STALE_MTIME,
    event: "stop",
    eventAtMs: TEST_TIME - 60_000,
    expected: { status: SESSION_STATUS.WAITING, lastActivityAt: TEST_TIME - 60_000 },
  },
  {
    // A stop from a minute before the transcript's last record: hooks were
    // off, or the write raced. The session is demonstrably mid-turn again.
    name: "an event the transcript has moved past refines nothing",
    records: midTurn("2026-08-11T23:44:00.000Z"),
    mtimeMs: TEST_TIME - 60_000,
    event: "stop",
    eventAtMs: TEST_TIME - 2 * 60 * 1000,
    expected: {
      status: SESSION_STATUS.WORKING,
      lastActivityAt: Date.parse("2026-08-11T23:44:00.000Z"),
      activity: "Bash",
    },
  },
  {
    // Stop fires beside the result record; the settled outcome outranks it.
    name: "a stop event does not unsay a result the transcript recorded",
    records: [{ type: "result", cwd: CWD, timestamp: "2026-08-11T23:44:00.000Z" }],
    mtimeMs: TEST_TIME - 60_000,
    event: "stop",
    eventAtMs: TEST_TIME - 59_000,
    expected: {
      status: SESSION_STATUS.COMPLETE,
      completionCause: SESSION_COMPLETION_CAUSE.WORK_FINISHED,
      lastActivityAt: TEST_TIME - 59_000,
    },
  },
  {
    // Freshened by the resume, the tail's own verdict — a turn that ended is
    // holding for the developer — stands again.
    name: "a session-start event bumps the clock without deciding the status",
    records: [assistant(STALE, { stop_reason: "end_turn", content: [] })],
    mtimeMs: STALE_MTIME,
    event: "session-start",
    eventAtMs: TEST_TIME - 60_000,
    expected: { status: SESSION_STATUS.WAITING, lastActivityAt: TEST_TIME - 60_000 },
  },
  {
    // The permission was granted and the tool ran: a record newer than the
    // notification, though within the tolerance the other events enjoy.
    name: "a notification the transcript has answered stands down at once",
    records: midTurn("2026-08-11T23:44:59.000Z"),
    mtimeMs: TEST_TIME - 1_000,
    event: "notification",
    eventAtMs: TEST_TIME - 3_000,
    expected: {
      status: SESSION_STATUS.WORKING,
      lastActivityAt: Date.parse("2026-08-11T23:44:59.000Z"),
      activity: "Bash",
    },
  },
];

for (const hookCase of HOOK_CASE) {
  test(hookCase.name, async (t) => {
    const claudeHome = await temporaryClaudeHome(t);
    const spool = await temporaryDirectory(t, "luke-claude-spool-");
    await writeSessionFile(claudeHome, { records: hookCase.records, mtimeMs: hookCase.mtimeMs });
    await writeHookEvent(spool, SESSION_ID, hookCase.event, hookCase.eventAtMs);

    const [observation] = await claudeCodePlugin({
      claudeHome,
      hookEventsDirectory: () => spool,
      now: () => TEST_TIME,
    }).observe();

    assert.deepEqual(outcomeOf(observation), hookCase.expected);
  });
}

test("a spool that cannot be read costs only the refinement", async (t) => {
  const observation = await observeOne(t, {
    records: midTurn("2026-08-11T23:44:00.000Z"),
    mtimeMs: TEST_TIME - 60_000,
  });
  const withoutSpool = outcomeOf(observation);

  const [refined] = await observeSessions(
    t,
    [{ records: midTurn("2026-08-11T23:44:00.000Z"), mtimeMs: TEST_TIME - 60_000 }],
    () => path.join("no-such", "spool"),
  );

  assert.deepEqual(outcomeOf(refined), withoutSpool);
});

// ---------------------------------------------------------------------------
// The session's identity: the name somebody chose, then the one Claude Code
// generated, then the workspace. A long session's titles sit far behind its
// tail, so the head read is what recovers them.
// ---------------------------------------------------------------------------

/** Forty of these outweigh the bounded tail, so anything before them is past it. */
const TAIL_FILLER: readonly ParsedJsonObject[] = Array.from({ length: 40 }, (_, index) =>
  user(`2026-08-11T23:44:${String(10 + index).padStart(2, "0")}.000Z`, {
    message: { content: PAST_TAIL_FILLER },
  }),
);

const TITLE_CASE: readonly {
  readonly name: string;
  readonly records: readonly ParsedJsonObject[];
  readonly title: string;
}[] = [
  {
    name: "labels a session Claude Code has not named by its workspace",
    records: [assistant(FRESH)],
    title: "luke",
  },
  {
    name: "titles a session by the name Claude Code generated",
    records: [{ type: "ai-title", aiTitle: "Revamp the notch panel" }, assistant(FRESH)],
    title: "Revamp the notch panel",
  },
  {
    name: "a chosen title outranks the generated one",
    records: [
      { type: "ai-title", aiTitle: "Investigate flaky tests" },
      { type: "custom-title", customTitle: "Claude Code app chat detection" },
      assistant(FRESH),
    ],
    title: "Claude Code app chat detection",
  },
  {
    name: "recovers a generated title from a session too long to hold one in its tail",
    records: [
      { type: "ai-title", aiTitle: "Graduate the L-face identity" },
      user("2026-08-11T23:44:50.000Z", { toolUseResult: { content: PAST_TAIL_TEXT } }),
      assistant(FRESH, { stop_reason: "end_turn", content: [] }),
    ],
    title: "Graduate the L-face identity",
  },
  {
    name: "recovers a chosen title from the head of a session too long to hold one",
    records: [{ type: "custom-title", customTitle: "Renamed early" }, ...TAIL_FILLER],
    title: "Renamed early",
  },
  {
    name: "a chosen title in the head outranks a generated one the tail still holds",
    records: [
      { type: "custom-title", customTitle: "Chosen early" },
      ...TAIL_FILLER,
      { type: "ai-title", aiTitle: "Generated late" },
    ],
    title: "Chosen early",
  },
];

for (const titleCase of TITLE_CASE) {
  test(titleCase.name, async (t) => {
    const observation = await observeOne(t, { records: titleCase.records });

    assert.equal(observation?.title, titleCase.title);
  });
}

test("reports the workspace, branch, model and the tool being run", async (t) => {
  const observation = await observeOne(t, {
    records: [
      assistant(FRESH, {}),
      {
        type: "assistant",
        cwd: CWD,
        gitBranch: "dean/notch-panel",
        timestamp: FRESH,
        message: {
          model: "claude-opus-5",
          stop_reason: "tool_use",
          content: [toolUse("Bash", { description: "Package the macOS app" })],
        },
      },
    ],
  });

  assert.deepEqual(observation?.detail, {
    activity: "Bash: Package the macOS app",
    repository: "luke",
    branch: "dean/notch-panel",
    model: "claude-opus-5",
  });
  assert.equal(observation?.advertises, undefined);
});

test("a settled turn's words and Claude Code's own away summary stay off the observation", async (t) => {
  const observation = await observeOne(t, {
    records: [
      assistant(FRESH, {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Closing words." }],
      }),
      system("away_summary", "2026-08-11T23:44:58.000Z", {
        content: "You asked for the notch geometry; next, say whether to ship it.",
      }),
    ],
  });

  // Neither is a field about the session: the closing message is the
  // transcript itself, and the away summary is prose Claude Code wrote for
  // its own developer. An observation reports fields, never prose.
  assert.equal(observation?.status, SESSION_STATUS.WAITING);
});

// ---------------------------------------------------------------------------
// The conversation's own clock, not the file's. Claude Code touches session
// files in bulk long after their conversations ended, so mtime says when
// something last handled the file and the last timestamped conversation
// record says when the session last moved.
// ---------------------------------------------------------------------------

const CLOCK_CASE: readonly {
  readonly name: string;
  readonly records: readonly ParsedJsonObject[];
  readonly mtimeMs: number;
  readonly lastActivityAt: number;
}[] = [
  {
    name: "dates a touched transcript by its own records rather than the touch",
    records: [
      user("2026-08-11T20:44:50.000Z"),
      assistant("2026-08-11T20:45:00.000Z", { stop_reason: "end_turn", content: [] }),
      // The bookkeeping record a later pass appended: no timestamp, and the
      // same pass is what bumped the file's mtime to the present.
      { type: "last-prompt", cwd: CWD },
    ],
    mtimeMs: TEST_TIME,
    lastActivityAt: Date.parse("2026-08-11T20:45:00.000Z"),
  },
  {
    name: "keeps a touch from making a long-settled session look recent",
    records: [assistant("2026-06-25T08:30:00.000Z", { stop_reason: "end_turn", content: [] })],
    mtimeMs: TEST_TIME,
    lastActivityAt: Date.parse("2026-06-25T08:30:00.000Z"),
  },
  {
    name: "falls back to the file's date when the tail carries no timestamp",
    records: [user("")],
    mtimeMs: TEST_TIME - 5_000,
    lastActivityAt: TEST_TIME - 5_000,
  },
  {
    // A tail holding only bookkeeping says nothing about when the conversation
    // last moved, and the touch must not answer for it: one deeper read finds
    // the conversation's own clock months back.
    name: "reads past a tail of appended bookkeeping to the conversation's own clock",
    records: [
      user("2026-02-14T10:00:00.000Z"),
      assistant("2026-02-14T10:05:00.000Z", { stop_reason: "end_turn", content: [] }),
      { type: "ai-title", aiTitle: "Old refactor" },
      { type: "last-prompt", cwd: CWD, prompt: PAST_TAIL_TEXT },
    ],
    mtimeMs: TEST_TIME,
    lastActivityAt: Date.parse("2026-02-14T10:05:00.000Z"),
  },
  {
    // Bookkeeping stamped with the moment it was appended rather than the
    // moment the conversation moved.
    name: "keeps a bookkeeping record's timestamp from re-dating the conversation",
    records: [
      user("2026-02-14T10:00:00.000Z"),
      assistant("2026-02-14T10:05:00.000Z", { stop_reason: "end_turn", content: [] }),
      { type: "queue-operation", operation: "enqueue", timestamp: "2026-08-11T23:44:59.000Z" },
    ],
    mtimeMs: TEST_TIME,
    lastActivityAt: Date.parse("2026-02-14T10:05:00.000Z"),
  },
];

for (const clockCase of CLOCK_CASE) {
  test(clockCase.name, async (t) => {
    const observation = await observeOne(t, {
      records: clockCase.records,
      mtimeMs: clockCase.mtimeMs,
    });

    assert.equal(observation?.lastActivityAt, clockCase.lastActivityAt);
  });
}

test("re-reads a transcript once it has been written to again", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(claudeHome, {
    records: [assistant("2026-08-11T23:44:40.000Z")],
    mtimeMs: TEST_TIME - 20_000,
  });

  const plugin = claudeCodePlugin({ claudeHome, now: () => TEST_TIME });
  const [before] = await plugin.observe();
  await writeSessionFile(claudeHome, {
    records: [{ type: "result", cwd: CWD, timestamp: FRESH }],
    mtimeMs: TEST_TIME - 5_000,
  });
  const [after] = await plugin.observe();

  // The same plugin serves both passes, so the second one must notice the new
  // mtime and re-read rather than serving the first parse back.
  assert.equal(before?.status, SESSION_STATUS.WAITING);
  assert.equal(after?.status, SESSION_STATUS.COMPLETE);
  assert.deepEqual(plugin.latest(), [after]);
});

test("serves an untouched transcript from its previous parse", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);
  await writeSessionFile(claudeHome, {
    records: [{ type: "result", cwd: CWD, timestamp: FRESH }],
    mtimeMs: TEST_TIME - 20_000,
  });

  const plugin = claudeCodePlugin({ claudeHome, now: () => TEST_TIME });
  const [before] = await plugin.observe();
  // Same mtime, different content: only a write Claude Code actually made —
  // which moves the mtime — may cost a read, so the parse is served as it was.
  await writeSessionFile(claudeHome, {
    records: [assistant(FRESH)],
    mtimeMs: TEST_TIME - 20_000,
  });
  const [after] = await plugin.observe();

  assert.equal(before?.status, SESSION_STATUS.COMPLETE);
  assert.equal(after?.status, SESSION_STATUS.COMPLETE);
});

test("keeps old sessions and preserves the newest duplicate provider id", async (t) => {
  const observations = await observeSessions(t, [
    {
      sessionId: "old-session",
      projectDirectoryName: "-Users-test-old",
      records: [{ type: "assistant", cwd: "/Users/test/old" }],
      mtimeMs: TEST_TIME - 90_000,
    },
    {
      sessionId: "duplicate-session",
      projectDirectoryName: "-Users-test-duplicate-old",
      records: [{ type: "assistant", cwd: "/Users/test/duplicate-old" }],
      mtimeMs: TEST_TIME - 30_000,
    },
    {
      sessionId: "duplicate-session",
      projectDirectoryName: "-Users-test-duplicate-new",
      records: [{ type: "result", cwd: "/Users/test/duplicate-new" }],
      mtimeMs: TEST_TIME - 10_000,
    },
  ]);

  assert.deepEqual(
    observations.map((observation) => ({
      providerSessionId: observation.providerSessionId,
      status: observation.status,
      title: observation.title,
    })),
    [
      {
        providerSessionId: "duplicate-session",
        status: SESSION_STATUS.COMPLETE,
        title: "duplicate-new",
      },
      { providerSessionId: "old-session", status: SESSION_STATUS.WAITING, title: "old" },
    ],
  );
});

test("observes nothing where Claude Code has no local project directory", async (t) => {
  const claudeHome = await temporaryClaudeHome(t);

  const plugin = claudeCodePlugin({ claudeHome, now: () => TEST_TIME });

  assert.deepEqual(await plugin.observe(), []);
  assert.deepEqual(plugin.latest(), []);
});
