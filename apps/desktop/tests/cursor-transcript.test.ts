import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { CursorLocalSessionAdapter } from "../src/cursor-local-adapter";
import type { ParsedJsonObject } from "./support/json";

function readCursorSessionTranscript(request: {
  cursorHome?: string;
  providerSessionId: string;
  readTailBytes?: number;
  maximumRenderedLength?: number;
}): Promise<string | undefined> {
  return new CursorLocalSessionAdapter({
    cursorHome: request.cursorHome,
    transcriptReadTailBytes: request.readTailBytes,
    transcriptMaximumRenderedLength: request.maximumRenderedLength,
  }).readTranscript(request.providerSessionId);
}

const TEST_SESSION_ID = "8b21b0b2-98c1-4f52-a1c1-0f9a53b2f001";
const TEST_PROJECT_DIRECTORY = "Users-test-luke";

async function temporaryCursorHome(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-cursor-transcript-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function writeTranscript(
  cursorHome: string,
  sessionId: string,
  records: readonly ParsedJsonObject[],
): Promise<void> {
  const sessionDirectory = path.join(
    cursorHome,
    "projects",
    TEST_PROJECT_DIRECTORY,
    "agent-transcripts",
    sessionId,
  );
  await fs.mkdir(sessionDirectory, { recursive: true });
  await fs.writeFile(
    path.join(sessionDirectory, `${sessionId}.jsonl`),
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
}

test("renders a session's turns without inventing the results Cursor never stores", async (t) => {
  const cursorHome = await temporaryCursorHome(t);
  await writeTranscript(cursorHome, TEST_SESSION_ID, [
    {
      role: "user",
      message: { content: [{ type: "text", text: "<user_query>Fix the flaky test</user_query>" }] },
    },
    {
      role: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "internal words that are not a reply" },
          { type: "text", text: "Looking at the failure now." },
          { type: "tool_use", id: "tu_1", name: "Edit", input: { file_path: "main.go" } },
        ],
      },
    },
    { role: "assistant", message: { content: "Fixed and green." } },
    { type: "turn_ended", status: "completed" },
  ]);

  const rendered = await readCursorSessionTranscript({
    cursorHome,
    providerSessionId: TEST_SESSION_ID,
  });

  assert.equal(
    rendered,
    [
      "Developer: Fix the flaky test",
      "Cursor: Looking at the failure now.",
      "→ Edit: main.go",
      "Cursor: Fixed and green.",
    ].join("\n"),
  );
  assert.ok(!rendered?.includes("internal words"), "thinking never renders");
});

test("keeps the developer's words and drops the scaffolding around them", async (t) => {
  const cursorHome = await temporaryCursorHome(t);
  await writeTranscript(cursorHome, TEST_SESSION_ID, [
    {
      role: "user",
      message: {
        content: [
          {
            type: "text",
            text:
              "<timestamp>2026-08-16</timestamp><attached_files>secret.ts</attached_files>" +
              "<user_query>Ship the release</user_query>",
          },
        ],
      },
    },
    // A record that is scaffolding alone was never something the developer said.
    {
      role: "user",
      message: {
        content: [{ type: "text", text: "<system_reminder>be careful</system_reminder>" }],
      },
    },
    // A bare string prompt has no wrapper to strip.
    { role: "user", message: { content: "And update the changelog" } },
  ]);

  const rendered = await readCursorSessionTranscript({
    cursorHome,
    providerSessionId: TEST_SESSION_ID,
  });

  assert.equal(
    rendered,
    ["Developer: Ship the release", "Developer: And update the changelog"].join("\n"),
  );
});

test("reports how a failed turn failed, in Cursor's own words", async (t) => {
  const cursorHome = await temporaryCursorHome(t);
  await writeTranscript(cursorHome, TEST_SESSION_ID, [
    { role: "assistant", message: { content: [{ type: "text", text: "Trying the build." }] } },
    { type: "turn_ended", status: "error", error: { message: "model stream disconnected" } },
    { type: "turn_ended", status: "error" },
  ]);

  const rendered = await readCursorSessionTranscript({
    cursorHome,
    providerSessionId: TEST_SESSION_ID,
  });

  assert.equal(
    rendered,
    [
      "Cursor: Trying the build.",
      "Error: model stream disconnected",
      "Error: The turn failed",
    ].join("\n"),
  );
});

test("reads nothing for a session that has no transcript file", async (t) => {
  const cursorHome = await temporaryCursorHome(t);
  await writeTranscript(cursorHome, TEST_SESSION_ID, [
    { role: "user", message: { content: "hello" } },
  ]);

  const rendered = await readCursorSessionTranscript({
    cursorHome,
    providerSessionId: "0000aaaa-1111-2222-3333-444455556666",
  });

  assert.equal(rendered, undefined);
});

test("refuses an id that could climb out of Cursor's directories", async (t) => {
  const cursorHome = await temporaryCursorHome(t);

  const rendered = await readCursorSessionTranscript({
    cursorHome,
    providerSessionId: "../../../etc/passwd",
  });

  assert.equal(rendered, undefined);
});
