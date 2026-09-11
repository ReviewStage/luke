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
import { type ParsedJsonObject, temporaryDirectory } from "@sidecar/wire/testing";
import { type TestContext, test } from "vitest";
import { homeManifest } from "../testing/index.js";
import { ompPlugin } from "./index.js";
import { OMP_SESSIONS_DIRECTORY } from "./records.js";

const TEST_TIME = Date.parse("2026-08-20T12:00:00.000Z");
const SECRET_TRANSCRIPT_TEXT = "SECRET_TRANSCRIPT_TEXT";
const SESSION_ID = "01a0540a-c238-7264-80d8-546b0c7be0d8";
const OTHER_SESSION_ID = "01a0540a-c238-7264-80d8-546b0c7be0d9";

function sessionFileName(id: string): string {
  return `2026-08-20T11-58-00-000Z_${id}.jsonl`;
}

interface SessionFile {
  readonly projectDirectoryName: string;
  readonly sessionId: string;
  readonly records: readonly ParsedJsonObject[];
  readonly mtimeMs?: number;
}

async function writeSessionFile(ompHome: string, file: SessionFile): Promise<void> {
  const projectDirectory = path.join(ompHome, OMP_SESSIONS_DIRECTORY, file.projectDirectoryName);
  await fs.mkdir(projectDirectory, { recursive: true });
  const filePath = path.join(projectDirectory, sessionFileName(file.sessionId));
  await fs.writeFile(
    filePath,
    `${file.records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
  const mtimeMs = file.mtimeMs ?? TEST_TIME - 1_000;
  await fs.utimes(filePath, mtimeMs / 1000, mtimeMs / 1000);
}

async function observeSessions(
  t: TestContext,
  files: readonly SessionFile[],
): Promise<ReadonlyMap<string, ProviderSessionObservation>> {
  const ompHome = await temporaryDirectory(t, "luke-omp-");
  for (const file of files) await writeSessionFile(ompHome, file);
  const observations = await ompPlugin({ ompHome, now: () => TEST_TIME }).observe();
  return new Map(observations.map((observation) => [observation.providerSessionId, observation]));
}

function titleSlot(title: string): ParsedJsonObject {
  return { type: "title", v: 1, title, updatedAt: "2026-08-20T11:58:00.000Z", pad: "" };
}

function sessionHeader(cwd: string, title?: string, id: string = SESSION_ID): ParsedJsonObject {
  return {
    type: "session",
    version: 3,
    id,
    timestamp: "2026-08-20T11:58:00.000Z",
    cwd,
    ...(title === undefined ? undefined : { title }),
  };
}

/** One stored message record, which is how OMP writes every turn. */
function message(timestamp: string, words: ParsedJsonObject): ParsedJsonObject {
  return { type: "message", id: "m1", parentId: null, timestamp, message: words };
}

function userMessage(timestamp: string): ParsedJsonObject {
  return message(timestamp, {
    role: "user",
    content: [{ type: "text", text: SECRET_TRANSCRIPT_TEXT }],
    timestamp: Date.parse(timestamp),
  });
}

function assistantMessage(timestamp: string, extra: ParsedJsonObject = {}): ParsedJsonObject {
  const { content, ...rest } = extra;
  return message(timestamp, {
    role: "assistant",
    content: content ?? [{ type: "text", text: "Parting words." }],
    model: "grok-4.6",
    provider: "xai-oauth",
    stopReason: "stop",
    timestamp: Date.parse(timestamp),
    ...rest,
  });
}

function custom(customType: string, timestamp: string, data: ParsedJsonObject): ParsedJsonObject {
  return { type: "custom", customType, id: "c1", parentId: "m1", timestamp, data };
}

const TOOL_CALL = {
  type: "toolCall",
  id: "call-1",
  name: "bash",
  arguments: { command: "./scripts/check.sh" },
  intent: "Run the check suite",
} as const;

/**
 * What one recording's lattice branch resolves to. Title, repository and model
 * are the session's identity rather than its state, and the recorded golden
 * roster already pins those, so a lattice row says nothing about them and the
 * comparison below can be a whole-object equality instead of a field walk.
 */
interface RowOutcome {
  readonly status: SessionStatus;
  readonly lastActivityAt: number;
  readonly completionCause?: SessionCompletionCause;
  readonly activity?: string;
  readonly error?: string;
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
  };
}

/** No title anywhere, so a row falls back to its working directory. */
const HEAD: readonly ParsedJsonObject[] = [sessionHeader("/Users/test/luke")];

/**
 * One session file per case, and the lattice branch its records resolve to.
 * Every branch is a row here, because the lattice is the whole of what a
 * recording can be read for.
 */
const OBSERVATION_CASE: readonly {
  readonly name: string;
  readonly records: readonly ParsedJsonObject[];
  readonly mtimeMs?: number;
  readonly expected: RowOutcome;
}[] = [
  {
    name: "a settled assistant turn holds for the developer",
    records: [
      userMessage("2026-08-20T11:58:10.000Z"),
      assistantMessage("2026-08-20T11:59:00.000Z"),
    ],
    expected: {
      status: SESSION_STATUS.WAITING,
      lastActivityAt: Date.parse("2026-08-20T11:59:00.000Z"),
    },
  },
  {
    name: "an open tool call is working, named by what it is for",
    records: [
      assistantMessage("2026-08-20T11:59:30.000Z", { content: [TOOL_CALL] }),
      custom("tool_execution_start", "2026-08-20T11:59:40.000Z", {
        toolCallId: "call-1",
        toolName: "bash",
        intent: "Run the check suite",
        startedAt: "2026-08-20T11:59:40.000Z",
      }),
    ],
    expected: {
      status: SESSION_STATUS.WORKING,
      activity: "bash: Run the check suite",
      lastActivityAt: Date.parse("2026-08-20T11:59:40.000Z"),
    },
  },
  {
    name: "a prompt the model has not answered is working",
    records: [userMessage("2026-08-20T11:59:00.000Z")],
    expected: {
      status: SESSION_STATUS.WORKING,
      lastActivityAt: Date.parse("2026-08-20T11:59:00.000Z"),
    },
  },
  {
    name: "a working turn gone quiet is unknown rather than still working",
    records: [userMessage("2026-08-20T10:00:00.000Z")],
    mtimeMs: TEST_TIME - 2 * 60 * 60 * 1000,
    expected: {
      status: SESSION_STATUS.UNKNOWN,
      lastActivityAt: Date.parse("2026-08-20T10:00:00.000Z"),
    },
  },
  {
    name: "a session_exit completes the row",
    records: [
      assistantMessage("2026-08-20T11:59:00.000Z"),
      custom("session_exit", "2026-08-20T11:59:30.000Z", { reason: "normal", kind: "normal" }),
    ],
    expected: {
      status: SESSION_STATUS.COMPLETE,
      completionCause: SESSION_COMPLETION_CAUSE.SESSION_CLOSED,
      lastActivityAt: Date.parse("2026-08-20T11:59:30.000Z"),
    },
  },
  {
    name: "a fatal exit is an error, not a completion",
    records: [
      assistantMessage("2026-08-20T11:59:00.000Z"),
      custom("session_exit", "2026-08-20T11:59:30.000Z", { reason: "crash", kind: "fatal" }),
    ],
    expected: {
      status: SESSION_STATUS.ERROR,
      lastActivityAt: Date.parse("2026-08-20T11:59:30.000Z"),
    },
  },
  {
    name: "a turn that stopped on an error reports what stopped it",
    records: [
      assistantMessage("2026-08-20T11:59:00.000Z", {
        content: [{ type: "text", text: SECRET_TRANSCRIPT_TEXT }],
        stopReason: "error",
        errorMessage: "Provider rejected the request.",
      }),
    ],
    expected: {
      status: SESSION_STATUS.ERROR,
      error: "Provider rejected the request.",
      lastActivityAt: Date.parse("2026-08-20T11:59:00.000Z"),
    },
  },
  {
    name: "a new prompt supersedes the turn that failed before it",
    records: [
      assistantMessage("2026-08-20T11:58:30.000Z", {
        stopReason: "error",
        errorMessage: "Provider rejected the request.",
      }),
      userMessage("2026-08-20T11:59:00.000Z"),
    ],
    expected: {
      status: SESSION_STATUS.WORKING,
      lastActivityAt: Date.parse("2026-08-20T11:59:00.000Z"),
    },
  },
  {
    name: "an interrupted turn holds for the developer past its placeholder results",
    records: [
      assistantMessage("2026-08-20T11:58:30.000Z", {
        content: [TOOL_CALL],
        stopReason: "aborted",
      }),
      message("2026-08-20T11:59:00.000Z", {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "bash",
        content: [{ type: "text", text: "Aborted." }],
        isError: true,
      }),
    ],
    expected: {
      status: SESSION_STATUS.WAITING,
      lastActivityAt: Date.parse("2026-08-20T11:59:00.000Z"),
    },
  },
  {
    name: "a resumed session leaves its exit behind",
    records: [
      assistantMessage("2026-08-20T11:58:00.000Z"),
      custom("session_exit", "2026-08-20T11:58:30.000Z", { reason: "fatal", kind: "fatal" }),
      userMessage("2026-08-20T11:59:00.000Z"),
    ],
    expected: {
      status: SESSION_STATUS.WORKING,
      lastActivityAt: Date.parse("2026-08-20T11:59:00.000Z"),
    },
  },
];

for (const observationCase of OBSERVATION_CASE) {
  test(observationCase.name, async (t) => {
    const observed = await observeSessions(t, [
      {
        projectDirectoryName: "luke",
        sessionId: SESSION_ID,
        records: [...HEAD, ...observationCase.records],
        ...(observationCase.mtimeMs === undefined
          ? undefined
          : { mtimeMs: observationCase.mtimeMs }),
      },
    ]);

    assert.equal(observed.size, 1);
    assert.deepEqual(outcomeOf(observed.get(SESSION_ID)), observationCase.expected);
  });
}

/**
 * A session's own name, then its header's, then the workspace it runs in —
 * OMP writes the first into a padded slot it rewrites in place, so an empty
 * slot is the common case rather than a broken one.
 */
const TITLE_CASE: readonly {
  readonly name: string;
  readonly head: readonly ParsedJsonObject[];
  readonly title: string;
}[] = [
  {
    name: "titles a session by its own title slot",
    head: [titleSlot("Fix the flaky check"), sessionHeader("/Users/test/luke")],
    title: "Fix the flaky check",
  },
  {
    name: "falls back to the header's title where the slot is empty",
    head: [titleSlot(""), sessionHeader("/Users/test/luke", "Rename the settings panel rows")],
    title: "Rename the settings panel rows",
  },
  {
    name: "labels a session named nowhere by its working directory",
    head: [titleSlot(""), sessionHeader("/Users/test/luke")],
    title: "luke",
  },
];

for (const titleCase of TITLE_CASE) {
  test(titleCase.name, async (t) => {
    const observed = await observeSessions(t, [
      {
        projectDirectoryName: "encoded-cwd",
        sessionId: SESSION_ID,
        records: [...titleCase.head, assistantMessage("2026-08-20T11:59:00.000Z")],
      },
    ]);

    const observation = observed.get(SESSION_ID);
    assert.equal(observation?.title, titleCase.title);
    // The row's repository is the working directory the recording named, not
    // the encoded directory the file sits in.
    assert.equal(observation?.detail?.repository, "luke");
    assert.equal(observation?.detail?.model, "grok-4.6");
  });
}

test("reads neither sidecar blob directories nor files that are not sessions", async (t) => {
  const ompHome = await temporaryDirectory(t, "luke-omp-");
  await writeSessionFile(ompHome, {
    projectDirectoryName: "luke",
    sessionId: SESSION_ID,
    records: [
      titleSlot("Keep this row"),
      sessionHeader("/Users/test/luke"),
      assistantMessage("2026-08-20T11:59:00.000Z"),
    ],
  });
  const projectDirectory = path.join(ompHome, OMP_SESSIONS_DIRECTORY, "luke");
  // A sidecar directory named after a session's file holds that session's
  // artifacts and its subagents' recordings, not rows of their own.
  await fs.mkdir(
    path.join(projectDirectory, sessionFileName(SESSION_ID).slice(0, -".jsonl".length)),
    { recursive: true },
  );
  await fs.writeFile(path.join(projectDirectory, "notes.txt"), "not a session\n");

  const observations = await ompPlugin({ ompHome, now: () => TEST_TIME }).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    [SESSION_ID],
  );
});

test("observes each project directory's sessions", async (t) => {
  const observed = await observeSessions(t, [
    {
      projectDirectoryName: "fresh",
      sessionId: SESSION_ID,
      records: [
        titleSlot(""),
        sessionHeader("/Users/test/fresh"),
        userMessage("2026-08-20T11:59:00.000Z"),
      ],
    },
    {
      projectDirectoryName: "stale",
      sessionId: OTHER_SESSION_ID,
      records: [
        titleSlot(""),
        sessionHeader("/Users/test/stale", undefined, OTHER_SESSION_ID),
        userMessage("2026-08-20T11:59:00.000Z"),
      ],
    },
  ]);

  assert.deepEqual(new Set(observed.keys()), new Set([SESSION_ID, OTHER_SESSION_ID]));
  assert.equal(observed.get(SESSION_ID)?.detail?.repository, "fresh");
  assert.equal(observed.get(OTHER_SESSION_ID)?.detail?.repository, "stale");
});

test("observes nothing where OMP has never run", async (t) => {
  const ompHome = path.join(await temporaryDirectory(t, "luke-omp-"), "missing");

  const plugin = ompPlugin({ ompHome, now: () => TEST_TIME });

  assert.deepEqual(await plugin.observe(), []);
  assert.deepEqual(plugin.latest(), []);
});

// "Never write provider transcripts or session-state files. Reading them is
// what Luke is for; writing to them is never." The observation pass and both
// transcript reads run over a home holding a recorded session, and every
// byte, size and date under it stands where it stood.
test("observing and reading a transcript writes nothing under OMP's home", async (t) => {
  const ompHome = await temporaryDirectory(t, "luke-omp-");
  await writeSessionFile(ompHome, {
    projectDirectoryName: "luke",
    sessionId: SESSION_ID,
    records: [
      titleSlot("Fix the flaky test"),
      sessionHeader("/Users/test/luke"),
      userMessage("2026-08-20T11:58:30.000Z"),
      assistantMessage("2026-08-20T11:59:00.000Z"),
    ],
  });
  const plugin = ompPlugin({ ompHome, now: () => TEST_TIME });
  const before = await homeManifest(ompHome);

  await plugin.observe();
  const read = await plugin.reads?.transcript?.(SESSION_ID);
  const since = await plugin.reads?.transcriptSince?.(SESSION_ID);
  // A read that found nothing would leave the home untouched for the wrong
  // reason, so both reads answering is part of what is being pinned.
  assert.equal(read?.status, "accepted");
  assert.equal(since?.status, "accepted");
  await plugin.reads?.transcriptSince?.(
    SESSION_ID,
    since?.status === "accepted" ? since.cursor : undefined,
  );

  assert.deepEqual(await homeManifest(ompHome), before);
});
