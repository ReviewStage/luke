import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import { GeminiCliSessionAdapter } from "./adapter.js";
import { readGeminiSessionTranscript } from "./transcript.js";

const SESSION_FILE_STEM = "session-2026-08-20T11-58-abcd1234";

async function temporaryGeminiHome(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-gemini-transcript-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function writeSessionFile(
  geminiHome: string,
  records: readonly ParsedJsonObject[],
): Promise<void> {
  const chatsDirectory = path.join(geminiHome, "tmp", "luke", "chats");
  await fs.mkdir(chatsDirectory, { recursive: true });
  await fs.writeFile(
    path.join(chatsDirectory, `${SESSION_FILE_STEM}.jsonl`),
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
}

const CONVERSATION: readonly ParsedJsonObject[] = [
  {
    sessionId: "abcd1234-full-id",
    projectHash: "a".repeat(64),
    startTime: "2026-08-20T11:58:00.000Z",
    lastUpdated: "2026-08-20T11:58:00.000Z",
  },
  {
    id: "m1",
    type: "user",
    timestamp: "2026-08-20T11:58:10.000Z",
    content: "Fix the flaky updater test",
  },
  {
    id: "m2",
    type: "gemini",
    timestamp: "2026-08-20T11:58:30.000Z",
    content: [{ text: "Looking at the updater suite." }],
    toolCalls: [
      {
        id: "t1",
        name: "run_shell_command",
        displayName: "Shell",
        args: { command: "pnpm test updater" },
        status: "executing",
        timestamp: "2026-08-20T11:58:31.000Z",
      },
    ],
  },
  {
    id: "m2",
    type: "gemini",
    timestamp: "2026-08-20T11:58:30.000Z",
    content: [{ text: "Looking at the updater suite." }],
    toolCalls: [
      {
        id: "t1",
        name: "run_shell_command",
        displayName: "Shell",
        args: { command: "pnpm test updater" },
        status: "success",
        timestamp: "2026-08-20T11:58:50.000Z",
        resultDisplay: "1 failing: restarts twice",
      },
      {
        id: "t2",
        name: "replace",
        args: { file_path: "/Users/test/luke/updater.ts" },
        status: "success",
        timestamp: "2026-08-20T11:59:00.000Z",
        resultDisplay: { fileDiff: "not words" },
      },
    ],
  },
  { id: "m3", type: "info", timestamp: "2026-08-20T11:59:10.000Z", content: "Chat compressed" },
  { id: "m4", type: "error", timestamp: "2026-08-20T11:59:20.000Z", content: "Quota exceeded" },
  {
    id: "m5",
    type: "gemini",
    timestamp: "2026-08-20T11:59:40.000Z",
    content: "Fixed; the test passes now.",
  },
];

test("renders a replayed conversation into bounded lines", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  await writeSessionFile(geminiHome, CONVERSATION);

  const rendered = await readGeminiSessionTranscript({
    geminiHome,
    providerSessionId: SESSION_FILE_STEM,
  });

  assert.equal(
    rendered,
    [
      "Developer: Fix the flaky updater test",
      "Gemini: Looking at the updater suite.",
      "→ Shell: pnpm test updater",
      "← 1 failing: restarts twice",
      "→ replace: /Users/test/luke/updater.ts",
      "Error: Quota exceeded",
      "Gemini: Fixed; the test passes now.",
    ].join("\n"),
  );
});

test("keeps the newest turns when the rendering outgrows its bound", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  await writeSessionFile(geminiHome, CONVERSATION);

  const rendered = await readGeminiSessionTranscript({
    geminiHome,
    providerSessionId: SESSION_FILE_STEM,
    maximumRenderedLength: 80,
  });

  assert.ok(rendered?.startsWith("[earlier turns omitted]"));
  assert.ok(rendered?.endsWith("Gemini: Fixed; the test passes now."));
});

test("honors a rewind by dropping the rewound turns", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  await writeSessionFile(geminiHome, [
    { id: "m1", type: "user", timestamp: "2026-08-20T11:58:00.000Z", content: "First ask" },
    { id: "m2", type: "gemini", timestamp: "2026-08-20T11:58:10.000Z", content: "First answer" },
    { id: "m3", type: "user", timestamp: "2026-08-20T11:59:00.000Z", content: "Abandoned ask" },
    { $rewindTo: "m3" },
    { id: "m4", type: "user", timestamp: "2026-08-20T11:59:30.000Z", content: "Second ask" },
  ]);

  const rendered = await readGeminiSessionTranscript({
    geminiHome,
    providerSessionId: SESSION_FILE_STEM,
  });

  assert.equal(
    rendered,
    ["Developer: First ask", "Gemini: First answer", "Developer: Second ask"].join("\n"),
  );
});

test("refuses an id shaped like a path and answers nothing for an unknown one", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  await writeSessionFile(geminiHome, CONVERSATION);

  assert.equal(
    await readGeminiSessionTranscript({ geminiHome, providerSessionId: "../../secrets" }),
    undefined,
  );
  assert.equal(
    await readGeminiSessionTranscript({
      geminiHome,
      providerSessionId: "session-unknown-00000000",
    }),
    undefined,
  );
});

test("the adapter reads the same rendering on ask", async (t) => {
  const geminiHome = await temporaryGeminiHome(t);
  await writeSessionFile(geminiHome, CONVERSATION);

  const adapter = new GeminiCliSessionAdapter({ geminiHome });
  const rendered = await adapter.readTranscript(SESSION_FILE_STEM);

  assert.ok(rendered?.includes("Developer: Fix the flaky updater test"));
});
