import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  type ProviderSessionObservation,
  SESSION_COMPLETION_CAUSE,
  SESSION_STATUS,
} from "@sidecar/session";
import { type ParsedJsonObject, temporaryDirectory } from "@sidecar/wire/testing";
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

function userMessage(timestamp: string): ParsedJsonObject {
  return {
    type: "message",
    id: "m-user",
    parentId: null,
    timestamp,
    message: {
      role: "user",
      content: [{ type: "text", text: SECRET_TRANSCRIPT_TEXT }],
      timestamp: Date.parse(timestamp),
    },
  };
}

function assistantMessage(timestamp: string, extra: ParsedJsonObject = {}): ParsedJsonObject {
  const { content, ...rest } = extra;
  return {
    type: "message",
    id: "m-assistant",
    parentId: null,
    timestamp,
    message: {
      role: "assistant",
      content: content ?? [{ type: "text", text: "Parting words." }],
      model: "grok-4.6",
      provider: "xai-oauth",
      stopReason: "stop",
      timestamp: Date.parse(timestamp),
      ...rest,
    },
  };
}

function custom(customType: string, timestamp: string, data: ParsedJsonObject): ParsedJsonObject {
  return { type: "custom", customType, id: "c1", parentId: "m-assistant", timestamp, data };
}

const TOOL_CALL = {
  type: "toolCall",
  id: "call-1",
  name: "bash",
  arguments: { command: "./scripts/check.sh" },
  intent: "Run the check suite",
} as const;

interface ObservationSummary {
  status?: string;
  completionCause?: string;
  title?: string;
  repository?: string;
  model?: string;
  activity?: string;
  error?: string;
  lastActivityAt?: number;
}

const SUMMARY_FIELD = [
  "status",
  "completionCause",
  "title",
  "repository",
  "model",
  "activity",
  "error",
  "lastActivityAt",
] as const;

function summarize(observation: ProviderSessionObservation): ObservationSummary {
  return {
    status: observation.status,
    completionCause: observation.completionCause,
    title: observation.title,
    repository: observation.detail?.repository,
    model: observation.detail?.model,
    activity: observation.detail?.activity,
    error: observation.detail?.error,
    lastActivityAt: observation.lastActivityAt,
  };
}

function assertObserved(
  observation: ProviderSessionObservation | undefined,
  expected: ObservationSummary,
): void {
  assert.ok(observation, "expected the session to be observed");
  const actual = summarize(observation);
  // Only the fields the case named, so a row says what that branch is for
  // rather than restating every field of every other branch.
  for (const field of SUMMARY_FIELD) {
    if (!(field in expected)) continue;
    assert.deepEqual(actual[field], expected[field], field);
  }
}

/** No title anywhere, so a row falls back to its working directory. */
const UNTITLED_HEAD: readonly ParsedJsonObject[] = [sessionHeader("/Users/test/luke")];

/**
 * One session file per case, and what the row it produces says. Every branch
 * of OMP's status lattice is a row here, because the lattice is the whole of
 * what a recording can be read for.
 */
const OBSERVATION_CASE: readonly {
  readonly name: string;
  /** The title slot and session header, when a case is about titling at all. */
  readonly head?: readonly ParsedJsonObject[];
  readonly records: readonly ParsedJsonObject[];
  readonly mtimeMs?: number;
  readonly expected: ObservationSummary;
}[] = [
  {
    name: "a settled assistant turn holds for the developer, titled by its slot",
    head: [titleSlot("Fix the flaky check"), sessionHeader("/Users/test/luke")],
    records: [
      userMessage("2026-08-20T11:58:10.000Z"),
      assistantMessage("2026-08-20T11:59:00.000Z"),
    ],
    expected: {
      status: SESSION_STATUS.WAITING,
      title: "Fix the flaky check",
      repository: "luke",
      model: "grok-4.6",
      lastActivityAt: Date.parse("2026-08-20T11:59:00.000Z"),
      error: undefined,
    },
  },
  {
    name: "an empty title slot falls back to the header's title",
    head: [titleSlot(""), sessionHeader("/Users/test/luke", "Rename the settings panel rows")],
    records: [assistantMessage("2026-08-20T11:59:00.000Z")],
    expected: { title: "Rename the settings panel rows" },
  },
  {
    name: "a session named nowhere is labelled by its working directory",
    records: [assistantMessage("2026-08-20T11:59:00.000Z")],
    expected: { title: "luke", repository: "luke" },
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
    expected: { status: SESSION_STATUS.WORKING },
  },
  {
    name: "a working turn gone quiet is unknown rather than still working",
    records: [userMessage("2026-08-20T10:00:00.000Z")],
    mtimeMs: TEST_TIME - 2 * 60 * 60 * 1000,
    expected: { status: SESSION_STATUS.UNKNOWN },
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
    },
  },
  {
    name: "a fatal exit is an error, not a completion",
    records: [
      assistantMessage("2026-08-20T11:59:00.000Z"),
      custom("session_exit", "2026-08-20T11:59:30.000Z", { reason: "crash", kind: "fatal" }),
    ],
    expected: { status: SESSION_STATUS.ERROR, completionCause: undefined },
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
    expected: { status: SESSION_STATUS.ERROR, error: "Provider rejected the request." },
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
    expected: { status: SESSION_STATUS.WORKING, error: undefined },
  },
  {
    name: "an interrupted turn holds for the developer past its placeholder results",
    records: [
      assistantMessage("2026-08-20T11:58:30.000Z", {
        content: [TOOL_CALL],
        stopReason: "aborted",
      }),
      {
        type: "message",
        id: "m2",
        parentId: "m-assistant",
        timestamp: "2026-08-20T11:59:00.000Z",
        message: {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "bash",
          content: [{ type: "text", text: "Aborted." }],
          isError: true,
        },
      },
    ],
    expected: { status: SESSION_STATUS.WAITING },
  },
  {
    name: "a resumed session leaves its exit behind",
    records: [
      assistantMessage("2026-08-20T11:58:00.000Z"),
      custom("session_exit", "2026-08-20T11:58:30.000Z", { reason: "fatal", kind: "fatal" }),
      userMessage("2026-08-20T11:59:00.000Z"),
    ],
    expected: { status: SESSION_STATUS.WORKING, completionCause: undefined },
  },
];

for (const observationCase of OBSERVATION_CASE) {
  test(observationCase.name, async (t) => {
    const observed = await observeSessions(t, [
      {
        projectDirectoryName: "luke",
        sessionId: SESSION_ID,
        records: [...(observationCase.head ?? UNTITLED_HEAD), ...observationCase.records],
        ...(observationCase.mtimeMs === undefined
          ? undefined
          : { mtimeMs: observationCase.mtimeMs }),
      },
    ]);

    assert.equal(observed.size, 1);
    assertObserved(observed.get(SESSION_ID), observationCase.expected);
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
