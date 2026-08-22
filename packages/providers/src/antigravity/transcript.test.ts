import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import {
  ANTIGRAVITY_CONVERSATIONS_DIRECTORY,
  CORTEX_STEP_STATUS,
  CORTEX_STEP_TYPE,
} from "./records.js";
import { readAntigravitySessionTranscript } from "./transcript.js";

const HUB_PROFILE = "antigravity";
const CONVERSATION_ID = "12345678-aaaa-bbbb-cccc-0123456789ab";

// The same minimal protocol-buffer writer the adapter tests use, so the
// fixtures are synthesized rather than copied from a real machine.
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

function bytesField(fieldNumber: number, payload: readonly number[]): number[] {
  return [...varintBytes(fieldNumber * 8 + 2), ...varintBytes(payload.length), ...payload];
}

function textField(fieldNumber: number, words: string): number[] {
  return bytesField(fieldNumber, [...new TextEncoder().encode(words)]);
}

interface TestStep {
  idx: number;
  stepType: number;
  status?: number;
  payload?: readonly number[];
  errorDetails?: readonly number[];
}

async function makeHome(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-antigravity-transcript-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function writeConversationStore(
  home: string,
  conversationId: string,
  steps: readonly TestStep[],
): Promise<void> {
  const conversationsDirectory = path.join(home, HUB_PROFILE, ANTIGRAVITY_CONVERSATIONS_DIRECTORY);
  await fs.mkdir(conversationsDirectory, { recursive: true });
  const database = new DatabaseSync(path.join(conversationsDirectory, `${conversationId}.db`));
  try {
    database.exec(
      "CREATE TABLE steps (idx integer primary key, step_type integer, status integer, step_payload blob, error_details blob)",
    );
    const insert = database.prepare(
      "INSERT INTO steps (idx, step_type, status, step_payload, error_details) VALUES (?, ?, ?, ?, ?)",
    );
    for (const step of steps) {
      insert.run(
        step.idx,
        step.stepType,
        step.status ?? CORTEX_STEP_STATUS.DONE,
        step.payload ? Uint8Array.from(step.payload) : null,
        step.errorDetails ? Uint8Array.from(step.errorDetails) : null,
      );
    }
  } finally {
    database.close();
  }
}

test("renders the conversation's own words, tools, and failures in order", async (t) => {
  const home = await makeHome(t);
  await writeConversationStore(home, CONVERSATION_ID, [
    {
      idx: 0,
      stepType: CORTEX_STEP_TYPE.USER_INPUT,
      payload: bytesField(19, textField(2, "Add retry logic to the sync loop")),
    },
    {
      idx: 1,
      stepType: CORTEX_STEP_TYPE.PLANNER_RESPONSE,
      payload: bytesField(20, textField(1, "Starting with the failure path.")),
    },
    {
      idx: 2,
      stepType: 132,
      payload: bytesField(
        5,
        bytesField(4, [
          ...textField(2, "view_file"),
          ...textField(3, JSON.stringify({ AbsolutePath: "/repo/src/sync.ts" })),
        ]),
      ),
    },
    {
      idx: 3,
      stepType: CORTEX_STEP_TYPE.RUN_COMMAND,
      payload: [
        ...bytesField(5, bytesField(4, textField(2, "run_command"))),
        ...bytesField(28, textField(23, "pnpm test --filter sync")),
      ],
    },
    {
      idx: 4,
      stepType: 132,
      status: CORTEX_STEP_STATUS.ERROR,
      errorDetails: textField(2, "command exited 1"),
    },
    {
      idx: 5,
      stepType: CORTEX_STEP_TYPE.NOTIFY_USER,
      payload: bytesField(94, textField(2, "Retries are in; one test still fails.")),
    },
  ]);
  const rendered = await readAntigravitySessionTranscript({
    antigravityHome: home,
    providerSessionId: CONVERSATION_ID,
  });
  assert.equal(
    rendered,
    [
      "Developer: Add retry logic to the sync loop",
      "Antigravity: Starting with the failure path.",
      "→ view_file: /repo/src/sync.ts",
      "→ run_command: pnpm test --filter sync",
      "Error: command exited 1",
      "Antigravity: Retries are in; one test still fails.",
    ].join("\n"),
  );
});

test("cuts a long conversation from the front, at a line, and says so", async (t) => {
  const home = await makeHome(t);
  const steps = Array.from({ length: 40 }, (_, index) => ({
    idx: index,
    stepType: CORTEX_STEP_TYPE.PLANNER_RESPONSE,
    payload: bytesField(20, textField(1, `Reply number ${index} with some padding words.`)),
  }));
  await writeConversationStore(home, CONVERSATION_ID, steps);
  const rendered = await readAntigravitySessionTranscript({
    antigravityHome: home,
    providerSessionId: CONVERSATION_ID,
    maximumRenderedLength: 200,
  });
  assert.ok(rendered);
  assert.ok(rendered.startsWith("[earlier turns omitted]"));
  assert.ok(rendered.includes("Reply number 39"));
  assert.ok(rendered.length <= 200 + "[earlier turns omitted]\n".length);
});

test("refuses an id that is not a conversation id", async (t) => {
  const home = await makeHome(t);
  await writeConversationStore(home, CONVERSATION_ID, []);
  assert.equal(
    await readAntigravitySessionTranscript({
      antigravityHome: home,
      providerSessionId: "../../../etc/passwd",
    }),
    undefined,
  );
});

test("a conversation with no readable store keeps the honest refusal", async (t) => {
  const home = await makeHome(t);
  const conversationsDirectory = path.join(home, HUB_PROFILE, ANTIGRAVITY_CONVERSATIONS_DIRECTORY);
  await fs.mkdir(conversationsDirectory, { recursive: true });
  // A legacy conversation: a .pb file this build cannot read, and no .db.
  await fs.writeFile(
    path.join(conversationsDirectory, `${CONVERSATION_ID}.pb`),
    Uint8Array.from([0x12, 0x34]),
  );
  assert.equal(
    await readAntigravitySessionTranscript({
      antigravityHome: home,
      providerSessionId: CONVERSATION_ID,
    }),
    undefined,
  );
});

test("an unknown conversation renders nothing", async (t) => {
  const home = await makeHome(t);
  assert.equal(
    await readAntigravitySessionTranscript({
      antigravityHome: home,
      providerSessionId: CONVERSATION_ID,
    }),
    undefined,
  );
});
