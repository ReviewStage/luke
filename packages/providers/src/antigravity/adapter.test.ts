import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { SESSION_STATUS } from "@sidecar/session";
import { AntigravitySessionAdapter } from "./adapter.js";
import {
  ANTIGRAVITY_CONVERSATIONS_DIRECTORY,
  ANTIGRAVITY_SUMMARIES_FILE,
  CASCADE_RUN_STATUS,
  CORTEX_STEP_STATUS,
  CORTEX_STEP_TYPE,
} from "./records.js";

const TEST_TIME = Date.parse("2026-08-21T17:00:00.000Z");
const HUB_PROFILE = "antigravity";
const IDE_PROFILE = "antigravity-ide";

/** Words that must never leave the records they are parsed from. */
const SECRET_TRANSCRIPT_TEXT = "SECRET_ROTATION_TOKEN_ABC123";

// ---------------------------------------------------------------------------
// A minimal protocol-buffer writer, so the fixtures are synthesized rather
// than copied from a real machine: a real summaries file carries real titles,
// branches, and recaps, which the repository must never hold.
// ---------------------------------------------------------------------------

function varintBytes(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value;
  do {
    const byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    bytes.push(remaining > 0 ? byte | 0x80 : byte);
  } while (remaining > 0);
  return bytes;
}

function varintField(fieldNumber: number, value: number): number[] {
  return [...varintBytes(fieldNumber * 8), ...varintBytes(value)];
}

function bytesField(fieldNumber: number, payload: readonly number[]): number[] {
  return [...varintBytes(fieldNumber * 8 + 2), ...varintBytes(payload.length), ...payload];
}

function textField(fieldNumber: number, words: string): number[] {
  return bytesField(fieldNumber, [...new TextEncoder().encode(words)]);
}

function timestampField(fieldNumber: number, timeMs: number): number[] {
  return bytesField(fieldNumber, varintField(1, Math.floor(timeMs / 1000)));
}

// Field numbers below are the store's own, mirrored from records.ts.
const SUMMARY_FIELD = {
  TITLE: 1,
  LAST_MODIFIED_TIME: 3,
  STATUS: 5,
  WAITING_STEPS: 8,
  WORKSPACES: 9,
  ANNOTATIONS: 15,
  KILLED: 23,
} as const;

interface TestSummary {
  conversationId: string;
  title?: string;
  annotationTitle?: string;
  runStatus?: number;
  killed?: boolean;
  archived?: boolean;
  observedAt?: number;
  folderUri?: string;
  branch?: string;
  waitingCommandLine?: string;
  notifyWords?: string;
}

function toolCallMetadata(name: string, argumentsJson?: string): number[] {
  const toolCall = [
    ...textField(2, name),
    ...(argumentsJson === undefined ? [] : textField(3, argumentsJson)),
  ];
  return bytesField(5, bytesField(4, toolCall));
}

function summaryMessage(summary: TestSummary): number[] {
  const workspace = [
    ...(summary.folderUri === undefined ? [] : textField(1, summary.folderUri)),
    ...(summary.branch === undefined ? [] : textField(4, summary.branch)),
  ];
  const annotations = [
    ...(summary.annotationTitle === undefined ? [] : textField(1, summary.annotationTitle)),
    ...(summary.archived ? varintField(4, 1) : []),
  ];
  const waitingStep =
    summary.waitingCommandLine === undefined
      ? []
      : bytesField(
          SUMMARY_FIELD.WAITING_STEPS,
          bytesField(1, [
            ...varintField(1, CORTEX_STEP_TYPE.RUN_COMMAND),
            ...toolCallMetadata("run_command"),
            ...bytesField(28, textField(23, summary.waitingCommandLine)),
          ]),
        );
  const notifyStep =
    summary.notifyWords === undefined
      ? []
      : bytesField(
          12,
          bytesField(1, [
            ...varintField(1, CORTEX_STEP_TYPE.NOTIFY_USER),
            ...bytesField(94, textField(2, summary.notifyWords)),
          ]),
        );
  return [
    ...(summary.title === undefined ? [] : textField(SUMMARY_FIELD.TITLE, summary.title)),
    ...timestampField(SUMMARY_FIELD.LAST_MODIFIED_TIME, summary.observedAt ?? TEST_TIME),
    ...varintField(SUMMARY_FIELD.STATUS, summary.runStatus ?? CASCADE_RUN_STATUS.IDLE),
    ...waitingStep,
    ...(workspace.length > 0 ? bytesField(SUMMARY_FIELD.WORKSPACES, workspace) : []),
    ...notifyStep,
    ...(annotations.length > 0 ? bytesField(SUMMARY_FIELD.ANNOTATIONS, annotations) : []),
    ...(summary.killed ? varintField(SUMMARY_FIELD.KILLED, 1) : []),
  ];
}

function summariesBytes(summaries: readonly TestSummary[]): Uint8Array {
  return Uint8Array.from(
    summaries.flatMap((summary) =>
      bytesField(1, [
        ...textField(1, summary.conversationId),
        ...bytesField(2, summaryMessage(summary)),
      ]),
    ),
  );
}

async function makeHome(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-antigravity-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function writeSummaries(
  home: string,
  profile: string,
  summaries: readonly TestSummary[],
): Promise<void> {
  const profileDirectory = path.join(home, profile);
  await fs.mkdir(profileDirectory, { recursive: true });
  await fs.writeFile(
    path.join(profileDirectory, ANTIGRAVITY_SUMMARIES_FILE),
    summariesBytes(summaries),
  );
}

interface TestStep {
  idx: number;
  stepType: number;
  status: number;
  payload?: readonly number[];
  errorDetails?: readonly number[];
}

async function writeConversationStore(
  home: string,
  profile: string,
  conversationId: string,
  steps: readonly TestStep[],
  trajectoryMetadata?: readonly number[],
): Promise<void> {
  const conversationsDirectory = path.join(home, profile, ANTIGRAVITY_CONVERSATIONS_DIRECTORY);
  await fs.mkdir(conversationsDirectory, { recursive: true });
  const database = new DatabaseSync(path.join(conversationsDirectory, `${conversationId}.db`));
  try {
    database.exec(
      "CREATE TABLE steps (idx integer primary key, step_type integer, status integer, step_payload blob, error_details blob)",
    );
    database.exec('CREATE TABLE trajectory_metadata_blob (id text DEFAULT "main", data blob)');
    const insert = database.prepare(
      "INSERT INTO steps (idx, step_type, status, step_payload, error_details) VALUES (?, ?, ?, ?, ?)",
    );
    for (const step of steps) {
      insert.run(
        step.idx,
        step.stepType,
        step.status,
        step.payload ? Uint8Array.from(step.payload) : null,
        step.errorDetails ? Uint8Array.from(step.errorDetails) : null,
      );
    }
    if (trajectoryMetadata) {
      database
        .prepare("INSERT INTO trajectory_metadata_blob (id, data) VALUES ('main', ?)")
        .run(Uint8Array.from(trajectoryMetadata));
    }
  } finally {
    database.close();
  }
}

function adapterFor(home: string, timeMs = TEST_TIME): AntigravitySessionAdapter {
  return new AntigravitySessionAdapter({ antigravityHome: home, now: () => timeMs });
}

test("observes a settled conversation with its title, workspace, and branch", async (t) => {
  const home = await makeHome(t);
  await writeSummaries(home, HUB_PROFILE, [
    {
      conversationId: "11111111-aaaa-bbbb-cccc-000000000001",
      title: "Fix the flaky roster test",
      runStatus: CASCADE_RUN_STATUS.IDLE,
      folderUri: "file:///Users/dev/projects/roster",
      branch: "dev/fix-roster",
    },
  ]);
  const [observation] = await adapterFor(home).observe();
  assert.ok(observation);
  assert.equal(observation.providerSessionId, "11111111-aaaa-bbbb-cccc-000000000001");
  assert.equal(observation.title, "Fix the flaky roster test");
  assert.equal(observation.status, SESSION_STATUS.WAITING);
  assert.equal(observation.holdingForDeveloper, undefined);
  assert.equal(observation.directory, "/Users/dev/projects/roster");
  assert.equal(observation.detail?.repository, "roster");
  assert.equal(observation.detail?.branch, "dev/fix-roster");
  assert.equal(observation.observedAt, Math.floor(TEST_TIME / 1000) * 1000);
});

test("a running conversation is working, and its tip names the tool", async (t) => {
  const home = await makeHome(t);
  const conversationId = "22222222-aaaa-bbbb-cccc-000000000002";
  await writeSummaries(home, HUB_PROFILE, [
    { conversationId, title: "Ship it", runStatus: CASCADE_RUN_STATUS.RUNNING },
  ]);
  await writeConversationStore(home, HUB_PROFILE, conversationId, [
    {
      idx: 0,
      stepType: 132,
      status: CORTEX_STEP_STATUS.RUNNING,
      payload: toolCallMetadata("run_command", JSON.stringify({ CommandLine: "pnpm test" })),
    },
  ]);
  const [observation] = await adapterFor(home).observe();
  assert.ok(observation);
  assert.equal(observation.status, SESSION_STATUS.WORKING);
  assert.equal(observation.detail?.activity, "run_command: pnpm test");
});

test("a step holding for permission is waiting on the developer", async (t) => {
  const home = await makeHome(t);
  await writeSummaries(home, HUB_PROFILE, [
    {
      conversationId: "33333333-aaaa-bbbb-cccc-000000000003",
      title: "Migrate the schema",
      runStatus: CASCADE_RUN_STATUS.RUNNING,
      waitingCommandLine: "rm -rf node_modules",
    },
  ]);
  const [observation] = await adapterFor(home).observe();
  assert.ok(observation);
  assert.equal(observation.status, SESSION_STATUS.WAITING);
  assert.equal(observation.holdingForDeveloper, true);
  assert.equal(observation.detail?.activity, "run_command: rm -rf node_modules");
});

test("a failure on the newest step of a settled conversation reads as an error", async (t) => {
  const home = await makeHome(t);
  const conversationId = "44444444-aaaa-bbbb-cccc-000000000004";
  await writeSummaries(home, HUB_PROFILE, [
    { conversationId, title: "Refactor", runStatus: CASCADE_RUN_STATUS.IDLE },
  ]);
  await writeConversationStore(home, HUB_PROFILE, conversationId, [
    {
      idx: 0,
      stepType: 132,
      status: CORTEX_STEP_STATUS.ERROR,
      errorDetails: textField(1, "model quota exhausted"),
    },
  ]);
  const [observation] = await adapterFor(home).observe();
  assert.ok(observation);
  assert.equal(observation.status, SESSION_STATUS.ERROR);
  assert.equal(observation.detail?.error, "model quota exhausted");
});

test("a failure does not heal by going stale", async (t) => {
  const home = await makeHome(t);
  const conversationId = "44444444-aaaa-bbbb-cccc-000000000005";
  await writeSummaries(home, HUB_PROFILE, [
    {
      conversationId,
      title: "Refactor",
      runStatus: CASCADE_RUN_STATUS.IDLE,
      observedAt: TEST_TIME - 60 * 60 * 1000,
    },
  ]);
  await writeConversationStore(home, HUB_PROFILE, conversationId, [
    {
      idx: 0,
      stepType: 132,
      status: CORTEX_STEP_STATUS.ERROR,
      errorDetails: textField(1, "model quota exhausted"),
    },
  ]);
  const [observation] = await adapterFor(home).observe();
  assert.equal(observation?.status, SESSION_STATUS.ERROR);
  assert.equal(observation?.detail?.error, "model quota exhausted");
});

test("the agent's latest notification is the recap of a settled conversation", async (t) => {
  const home = await makeHome(t);
  await writeSummaries(home, HUB_PROFILE, [
    {
      conversationId: "55555555-aaaa-bbbb-cccc-000000000005",
      title: "Add pagination",
      runStatus: CASCADE_RUN_STATUS.IDLE,
      notifyWords: "Pagination is in; the list view now loads fifty rows at a time.",
    },
    {
      conversationId: "55555555-aaaa-bbbb-cccc-000000000006",
      title: "Still running",
      runStatus: CASCADE_RUN_STATUS.RUNNING,
      notifyWords: "A notification a moving turn has already left behind.",
    },
  ]);
  const observations = await adapterFor(home).observe();
  const settled = observations.find((observation) => observation.title === "Add pagination");
  const running = observations.find((observation) => observation.title === "Still running");
  assert.equal(settled?.recap, "Pagination is in; the list view now loads fifty rows at a time.");
  assert.equal(running?.recap, undefined);
});

test("the developer's own rename outranks the generated title", async (t) => {
  const home = await makeHome(t);
  await writeSummaries(home, HUB_PROFILE, [
    {
      conversationId: "66666666-aaaa-bbbb-cccc-000000000007",
      title: "Generated Title",
      annotationTitle: "My Actual Task",
    },
  ]);
  const [observation] = await adapterFor(home).observe();
  assert.equal(observation?.title, "My Actual Task");
});

test("an archived conversation draws no row", async (t) => {
  const home = await makeHome(t);
  await writeSummaries(home, HUB_PROFILE, [
    { conversationId: "77777777-aaaa-bbbb-cccc-000000000008", title: "Old", archived: true },
    { conversationId: "77777777-aaaa-bbbb-cccc-000000000009", title: "Current" },
  ]);
  const observations = await adapterFor(home).observe();
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.title, "Current");
});

test("a killed run is the developer's move, not live work", async (t) => {
  const home = await makeHome(t);
  await writeSummaries(home, HUB_PROFILE, [
    {
      conversationId: "88888888-aaaa-bbbb-cccc-00000000000a",
      title: "Stopped",
      runStatus: CASCADE_RUN_STATUS.RUNNING,
      killed: true,
    },
  ]);
  const [observation] = await adapterFor(home).observe();
  assert.equal(observation?.status, SESSION_STATUS.WAITING);
});

test("a run gone quiet decays to unknown rather than posing as live", async (t) => {
  const home = await makeHome(t);
  const staleTime = TEST_TIME - 60 * 60 * 1000;
  await writeSummaries(home, HUB_PROFILE, [
    {
      conversationId: "99999999-aaaa-bbbb-cccc-00000000000b",
      title: "Abandoned",
      runStatus: CASCADE_RUN_STATUS.RUNNING,
      observedAt: staleTime,
    },
  ]);
  const [observation] = await adapterFor(home).observe();
  assert.equal(observation?.status, SESSION_STATUS.UNKNOWN);
});

test("both profiles are observed, and the first reading of a conversation wins", async (t) => {
  const home = await makeHome(t);
  const shared = "aaaaaaaa-aaaa-bbbb-cccc-00000000000c";
  await writeSummaries(home, HUB_PROFILE, [{ conversationId: shared, title: "Hub reading" }]);
  await writeSummaries(home, IDE_PROFILE, [
    { conversationId: shared, title: "IDE reading" },
    { conversationId: "bbbbbbbb-aaaa-bbbb-cccc-00000000000d", title: "IDE only" },
  ]);
  const observations = await adapterFor(home).observe();
  assert.deepEqual(observations.map((observation) => observation.title).sort(), [
    "Hub reading",
    "IDE only",
  ]);
});

test("a summaries file this build cannot read whole observes nothing", async (t) => {
  const home = await makeHome(t);
  const profileDirectory = path.join(home, HUB_PROFILE);
  await fs.mkdir(profileDirectory, { recursive: true });
  await fs.writeFile(
    path.join(profileDirectory, ANTIGRAVITY_SUMMARIES_FILE),
    Uint8Array.from([0xff, 0xff, 0xff]),
  );
  assert.deepEqual(await adapterFor(home).observe(), []);
});

test("a machine with no Antigravity home observes nothing", async (t) => {
  const home = await makeHome(t);
  assert.deepEqual(await adapterFor(path.join(home, "missing")).observe(), []);
});

test("a profile without a summaries index draws rows from the stores themselves", async (t) => {
  const home = await makeHome(t);
  const conversationId = "dddddddd-aaaa-bbbb-cccc-00000000000f";
  await writeConversationStore(home, IDE_PROFILE, conversationId, [
    {
      idx: 0,
      stepType: CORTEX_STEP_TYPE.NOTIFY_USER,
      status: CORTEX_STEP_STATUS.DONE,
      payload: bytesField(94, textField(2, "The refactor is in; tests pass.")),
    },
    {
      idx: 1,
      stepType: CORTEX_STEP_TYPE.PLANNER_RESPONSE,
      status: CORTEX_STEP_STATUS.DONE,
    },
  ]);
  const [observation] = await adapterFor(home).observe();
  assert.ok(observation);
  assert.equal(observation.providerSessionId, conversationId);
  // The store records no title and no workspace, so the row keeps the
  // unnamed-workspace fallback rather than a composed name.
  assert.equal(observation.title, "workspace");
  assert.equal(observation.status, SESSION_STATUS.WAITING);
  assert.equal(observation.recap, "The refactor is in; tests pass.");
});

test("a derived conversation holding for permission is waiting on the developer", async (t) => {
  const home = await makeHome(t);
  const conversationId = "dddddddd-aaaa-bbbb-cccc-000000000010";
  await writeConversationStore(home, IDE_PROFILE, conversationId, [
    {
      idx: 0,
      stepType: CORTEX_STEP_TYPE.RUN_COMMAND,
      status: CORTEX_STEP_STATUS.WAITING,
      payload: [
        ...toolCallMetadata("run_command"),
        ...bytesField(28, textField(23, "git push --force")),
      ],
    },
  ]);
  const [observation] = await adapterFor(home).observe();
  assert.ok(observation);
  assert.equal(observation.status, SESSION_STATUS.WAITING);
  assert.equal(observation.holdingForDeveloper, true);
  assert.equal(observation.detail?.activity, "run_command: git push --force");
});

test("a derived conversation whose newest step is moving is working", async (t) => {
  const home = await makeHome(t);
  const conversationId = "dddddddd-aaaa-bbbb-cccc-000000000011";
  await writeConversationStore(home, IDE_PROFILE, conversationId, [
    {
      idx: 0,
      stepType: 132,
      status: CORTEX_STEP_STATUS.RUNNING,
      payload: toolCallMetadata("view_file", JSON.stringify({ AbsolutePath: "/repo/main.ts" })),
    },
  ]);
  const [observation] = await adapterFor(home).observe();
  assert.ok(observation);
  assert.equal(observation.status, SESSION_STATUS.WORKING);
  assert.equal(observation.detail?.activity, "view_file: /repo/main.ts");
});

test("the developer's rename names a derived conversation", async (t) => {
  const home = await makeHome(t);
  const conversationId = "dddddddd-aaaa-bbbb-cccc-000000000012";
  await writeConversationStore(home, IDE_PROFILE, conversationId, [
    { idx: 0, stepType: CORTEX_STEP_TYPE.PLANNER_RESPONSE, status: CORTEX_STEP_STATUS.DONE },
  ]);
  const annotationsDirectory = path.join(home, IDE_PROFILE, "annotations");
  await fs.mkdir(annotationsDirectory, { recursive: true });
  await fs.writeFile(
    path.join(annotationsDirectory, `${conversationId}.pbtxt`),
    'title:"Sync loop retries"  last_user_view_time:{seconds:1787358874}',
  );
  const [observation] = await adapterFor(home).observe();
  assert.equal(observation?.title, "Sync loop retries");
});

test("an index's reading of a conversation outranks its store's", async (t) => {
  const home = await makeHome(t);
  const conversationId = "dddddddd-aaaa-bbbb-cccc-000000000013";
  await writeSummaries(home, HUB_PROFILE, [
    { conversationId, title: "Indexed", runStatus: CASCADE_RUN_STATUS.RUNNING },
  ]);
  await writeConversationStore(home, HUB_PROFILE, conversationId, [
    { idx: 0, stepType: CORTEX_STEP_TYPE.PLANNER_RESPONSE, status: CORTEX_STEP_STATUS.DONE },
  ]);
  const observations = await adapterFor(home).observe();
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.title, "Indexed");
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
});

test("an Agent Manager conversation's address is the app's own scheme", async (t) => {
  const home = await makeHome(t);
  const conversationId = "eeeeeeee-aaaa-bbbb-cccc-000000000014";
  await writeSummaries(home, HUB_PROFILE, [
    { conversationId, title: "Linked", folderUri: "file:///Users/dev/projects/roster" },
  ]);
  const [observation] = await adapterFor(home).observe();
  assert.equal(observation?.detail?.link, `antigravity://c/${conversationId}`);
});

test("an IDE conversation's address opens its own workspace window", async (t) => {
  const home = await makeHome(t);
  const conversationId = "eeeeeeee-aaaa-bbbb-cccc-000000000015";
  const workspaceFolder = path.join(home, "projects", "roster");
  await fs.mkdir(path.join(workspaceFolder, ".git"), { recursive: true });
  await fs.writeFile(
    path.join(workspaceFolder, ".git", "HEAD"),
    "ref: refs/heads/dev/fix-roster\n",
  );
  await writeConversationStore(
    home,
    IDE_PROFILE,
    conversationId,
    [{ idx: 0, stepType: CORTEX_STEP_TYPE.PLANNER_RESPONSE, status: CORTEX_STEP_STATUS.DONE }],
    bytesField(1, textField(1, `file://${workspaceFolder}`)),
  );
  const [observation] = await adapterFor(home).observe();
  assert.ok(observation);
  assert.equal(observation.title, "roster");
  assert.equal(observation.directory, workspaceFolder);
  assert.equal(observation.detail?.repository, "roster");
  // The repository stands right there to ask, and observation still reports
  // no branch: the store's metadata recorded none, and reading the folder's
  // `.git` costs macOS's folder consent dialog when a repository lives under
  // Documents, Desktop, or Downloads.
  assert.equal(observation.detail?.branch, undefined);
  assert.equal(observation.detail?.link, `antigravity-ide://file${workspaceFolder}`);
});

test("a derived conversation's workspace comes from the store's own metadata", async (t) => {
  const home = await makeHome(t);
  const conversationId = "eeeeeeee-aaaa-bbbb-cccc-000000000019";
  await writeConversationStore(
    home,
    IDE_PROFILE,
    conversationId,
    [{ idx: 0, stepType: CORTEX_STEP_TYPE.PLANNER_RESPONSE, status: CORTEX_STEP_STATUS.DONE }],
    [
      // CortexTrajectoryMetadata: workspaces[0] with folder URI and branch.
      ...bytesField(1, [
        ...textField(1, "file:///Users/dev/projects/roster"),
        ...textField(4, "main"),
      ]),
    ],
  );
  const [observation] = await adapterFor(home).observe();
  assert.ok(observation);
  assert.equal(observation.title, "roster");
  assert.equal(observation.directory, "/Users/dev/projects/roster");
  assert.equal(observation.detail?.repository, "roster");
  assert.equal(observation.detail?.branch, "main");
  assert.equal(observation.detail?.link, "antigravity-ide://file/Users/dev/projects/roster");
});

test("the app's own generated title outranks the developer's opening ask", async (t) => {
  const home = await makeHome(t);
  const conversationId = "eeeeeeee-aaaa-bbbb-cccc-00000000001a";
  await writeConversationStore(home, IDE_PROFILE, conversationId, [
    {
      idx: 0,
      stepType: CORTEX_STEP_TYPE.USER_INPUT,
      status: CORTEX_STEP_STATUS.DONE,
      payload: bytesField(19, textField(2, "hey can you look at the sync loop for me")),
    },
    {
      idx: 1,
      stepType: CORTEX_STEP_TYPE.CHECKPOINT,
      status: CORTEX_STEP_STATUS.DONE,
      // CortexStepCheckpoint.user_intent, where the app writes the title.
      payload: bytesField(30, textField(4, "Sync Loop Review")),
    },
    { idx: 2, stepType: CORTEX_STEP_TYPE.PLANNER_RESPONSE, status: CORTEX_STEP_STATUS.DONE },
  ]);
  const [observation] = await adapterFor(home).observe();
  assert.equal(observation?.title, "Sync Loop Review");
});

test("a derived conversation is named by the developer's opening ask", async (t) => {
  const home = await makeHome(t);
  const conversationId = "eeeeeeee-aaaa-bbbb-cccc-000000000018";
  await writeConversationStore(home, IDE_PROFILE, conversationId, [
    {
      idx: 0,
      stepType: CORTEX_STEP_TYPE.USER_INPUT,
      status: CORTEX_STEP_STATUS.DONE,
      payload: bytesField(19, textField(2, "Add retry logic to the sync loop")),
    },
    { idx: 1, stepType: CORTEX_STEP_TYPE.PLANNER_RESPONSE, status: CORTEX_STEP_STATUS.DONE },
  ]);
  const [observation] = await adapterFor(home).observe();
  assert.equal(observation?.title, "Add retry logic to the sync loop");
});

test("an IDE conversation with no workspace reports no address", async (t) => {
  const home = await makeHome(t);
  const conversationId = "eeeeeeee-aaaa-bbbb-cccc-000000000016";
  await writeConversationStore(home, IDE_PROFILE, conversationId, [
    { idx: 0, stepType: CORTEX_STEP_TYPE.PLANNER_RESPONSE, status: CORTEX_STEP_STATUS.DONE },
  ]);
  const [observation] = await adapterFor(home).observe();
  assert.equal(observation?.detail?.link, undefined);
});

test("a CLI conversation reports no address, like every terminal agent", async (t) => {
  const home = await makeHome(t);
  const conversationId = "eeeeeeee-aaaa-bbbb-cccc-000000000017";
  await writeConversationStore(
    home,
    "antigravity-cli",
    conversationId,
    [{ idx: 0, stepType: CORTEX_STEP_TYPE.PLANNER_RESPONSE, status: CORTEX_STEP_STATUS.DONE }],
    bytesField(1, textField(1, "file:///Users/dev/projects/roster")),
  );
  const [observation] = await adapterFor(home).observe();
  assert.ok(observation);
  assert.equal(observation.title, "roster");
  assert.equal(observation.detail?.link, undefined);
});

test("conversation words never reach the observation", async (t) => {
  const home = await makeHome(t);
  const conversationId = "cccccccc-aaaa-bbbb-cccc-00000000000e";
  await writeSummaries(home, HUB_PROFILE, [
    { conversationId, title: "Quiet", runStatus: CASCADE_RUN_STATUS.RUNNING },
  ]);
  await writeConversationStore(home, HUB_PROFILE, conversationId, [
    {
      idx: 0,
      stepType: CORTEX_STEP_TYPE.USER_INPUT,
      status: CORTEX_STEP_STATUS.DONE,
      payload: bytesField(19, textField(2, SECRET_TRANSCRIPT_TEXT)),
    },
    {
      idx: 1,
      stepType: CORTEX_STEP_TYPE.PLANNER_RESPONSE,
      status: CORTEX_STEP_STATUS.GENERATING,
      payload: bytesField(20, textField(1, SECRET_TRANSCRIPT_TEXT)),
    },
  ]);
  const [observation] = await adapterFor(home).observe();
  assert.ok(observation);
  assert.equal(JSON.stringify(observation).includes(SECRET_TRANSCRIPT_TEXT), false);
});
