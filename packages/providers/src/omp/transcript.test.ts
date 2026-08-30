import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import { OmpSessionAdapter } from "./adapter.js";
import { OMP_SESSIONS_DIRECTORY } from "./records.js";
import { readOmpSessionTranscript } from "./transcript.js";

const SESSION_ID = "01a0540a-c238-7264-80d8-546b0c7be0d8";
const SESSION_FILE_NAME = `2026-08-20T11-58-00-000Z_${SESSION_ID}.jsonl`;

async function temporaryOmpHome(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-omp-transcript-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function writeSessionFile(
  ompHome: string,
  records: readonly ParsedJsonObject[],
): Promise<void> {
  const projectDirectory = path.join(ompHome, OMP_SESSIONS_DIRECTORY, "luke");
  await fs.mkdir(projectDirectory, { recursive: true });
  await fs.writeFile(
    path.join(projectDirectory, SESSION_FILE_NAME),
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
}

const CONVERSATION: readonly ParsedJsonObject[] = [
  {
    type: "title",
    v: 1,
    title: "Fix the flaky updater test",
    updatedAt: "2026-08-20T11:58:00.000Z",
    pad: "",
  },
  {
    type: "session",
    version: 3,
    id: SESSION_ID,
    timestamp: "2026-08-20T11:58:00.000Z",
    cwd: "/Users/test/luke",
  },
  {
    type: "message",
    id: "m1",
    parentId: null,
    timestamp: "2026-08-20T11:58:00.000Z",
    message: {
      role: "user",
      content: [{ type: "text", text: "Fix the flaky updater test" }],
    },
  },
  {
    type: "message",
    id: "m2",
    parentId: "m1",
    timestamp: "2026-08-20T11:58:10.000Z",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "hidden" },
        { type: "text", text: "Looking at the updater suite." },
        {
          type: "toolCall",
          id: "call-1",
          name: "bash",
          arguments: { command: "pnpm test updater" },
          intent: "pnpm test updater",
        },
      ],
    },
  },
  {
    type: "message",
    id: "m3",
    parentId: "m2",
    timestamp: "2026-08-20T11:58:20.000Z",
    message: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "bash",
      content: [{ type: "text", text: "1 failing: restarts twice" }],
      isError: false,
    },
  },
  {
    type: "message",
    id: "m4",
    parentId: "m3",
    timestamp: "2026-08-20T11:58:30.000Z",
    message: {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call-2",
          name: "edit",
          arguments: { path: "/Users/test/luke/updater.ts" },
        },
      ],
    },
  },
  {
    type: "message",
    id: "m5",
    parentId: "m4",
    timestamp: "2026-08-20T11:58:40.000Z",
    message: {
      role: "toolResult",
      toolCallId: "call-2",
      toolName: "edit",
      content: [{ type: "text", text: "Quota exceeded" }],
      isError: true,
    },
  },
  {
    type: "message",
    id: "m6",
    parentId: "m5",
    timestamp: "2026-08-20T11:59:00.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Fixed; the test passes now." }],
    },
  },
];

test("renders a conversation into bounded lines", async (t) => {
  const ompHome = await temporaryOmpHome(t);
  await writeSessionFile(ompHome, CONVERSATION);

  const rendered = await readOmpSessionTranscript({
    ompHome,
    providerSessionId: SESSION_ID,
  });

  assert.equal(
    rendered,
    [
      "Developer: Fix the flaky updater test",
      "OMP: Looking at the updater suite.",
      "→ bash: pnpm test updater",
      "← 1 failing: restarts twice",
      "→ edit: /Users/test/luke/updater.ts",
      "Error: Quota exceeded",
      "OMP: Fixed; the test passes now.",
    ].join("\n"),
  );
});

test("keeps the newest turns when the rendering outgrows its bound", async (t) => {
  const ompHome = await temporaryOmpHome(t);
  await writeSessionFile(ompHome, CONVERSATION);

  const rendered = await readOmpSessionTranscript({
    ompHome,
    providerSessionId: SESSION_ID,
    maximumRenderedLength: 80,
  });

  assert.ok(rendered?.startsWith("[earlier turns omitted]"));
  assert.ok(rendered?.endsWith("OMP: Fixed; the test passes now."));
});

test("refuses an id shaped like a path and answers nothing for an unknown one", async (t) => {
  const ompHome = await temporaryOmpHome(t);
  await writeSessionFile(ompHome, CONVERSATION);

  assert.equal(
    await readOmpSessionTranscript({ ompHome, providerSessionId: "../../secrets" }),
    undefined,
  );
  assert.equal(
    await readOmpSessionTranscript({
      ompHome,
      providerSessionId: "01a0540a-c238-7264-80d8-000000000000",
    }),
    undefined,
  );
});

test("the adapter reads the same rendering on ask", async (t) => {
  const ompHome = await temporaryOmpHome(t);
  await writeSessionFile(ompHome, CONVERSATION);

  const adapter = new OmpSessionAdapter({ ompHome });
  const rendered = await adapter.readTranscript(SESSION_ID);

  assert.equal(rendered.status, "accepted");
  if (rendered.status === "accepted") {
    assert.ok(rendered.transcript.includes("Developer: Fix the flaky updater test"));
  }
});
