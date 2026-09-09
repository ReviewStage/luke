import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { dispatchRead, OMISSION_MARKER } from "@sidecar/session";
import { type ParsedJsonObject, temporaryDirectory } from "@sidecar/wire/testing";
import { boundedTranscript, TRANSCRIPT_BOUNDS } from "../shared/jsonl-transcript.js";
import { readTail, tailRecords } from "../shared/local-files.js";
import { ompPlugin } from "./index.js";
import { OMP_SESSIONS_DIRECTORY } from "./records.js";
import { linesFromOmpRecord, ompTranscriptFilePath } from "./transcript.js";

const SESSION_ID = "01a0540a-c238-7264-80d8-546b0c7be0d8";
const SESSION_FILE_NAME = `2026-08-20T11-58-00-000Z_${SESSION_ID}.jsonl`;

/** Reads the way the brain's own ask does, through the plugin's read seam. */
async function readOmpSessionTranscript(request: {
  ompHome: string;
  providerSessionId: string;
}): Promise<string | undefined> {
  const result = await dispatchRead(
    ompPlugin({ ompHome: request.ompHome }),
    "transcript",
    request.providerSessionId,
  );
  return result.status === "accepted" ? result.transcript : undefined;
}

async function temporaryOmpHome(t: TestContext): Promise<string> {
  return temporaryDirectory(t, "luke-omp-transcript-");
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

/** One stored message record, which is how OMP writes every turn. */
function message(
  id: string,
  parentId: string | null,
  timestamp: string,
  words: ParsedJsonObject,
): ParsedJsonObject {
  return { type: "message", id, parentId, timestamp, message: words };
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
  message("m1", null, "2026-08-20T11:58:00.000Z", {
    role: "user",
    content: [{ type: "text", text: "Fix the flaky updater test" }],
  }),
  message("m2", "m1", "2026-08-20T11:58:10.000Z", {
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
  }),
  message("m3", "m2", "2026-08-20T11:58:20.000Z", {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "bash",
    content: [{ type: "text", text: "1 failing: restarts twice" }],
    isError: false,
  }),
  message("m4", "m3", "2026-08-20T11:58:30.000Z", {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "call-2",
        name: "edit",
        arguments: { path: "/Users/test/luke/updater.ts" },
      },
    ],
  }),
  message("m5", "m4", "2026-08-20T11:58:40.000Z", {
    role: "toolResult",
    toolCallId: "call-2",
    toolName: "edit",
    content: [{ type: "text", text: "Quota exceeded" }],
    isError: true,
  }),
  message("m6", "m5", "2026-08-20T11:59:00.000Z", {
    role: "assistant",
    content: [{ type: "text", text: "Fixed; the test passes now." }],
  }),
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

  // The cut is `boundedTranscript`'s, so it is asked for where it lives: a
  // read the build performs never cuts a rendering at all.
  const filePath = await ompTranscriptFilePath(ompHome, SESSION_ID);
  assert.ok(filePath);
  const rendered = boundedTranscript(
    tailRecords(await readTail(filePath, TRANSCRIPT_BOUNDS.READ_TAIL_BYTES)).flatMap(
      linesFromOmpRecord,
    ),
    80,
  );

  assert.ok(rendered?.startsWith(OMISSION_MARKER));
  assert.ok(rendered?.endsWith("OMP: Fixed; the test passes now."));
});

test("renders a string prompt, a turn's recorded error, and no synthetic words", async (t) => {
  const ompHome = await temporaryOmpHome(t);
  await writeSessionFile(ompHome, [
    {
      type: "session",
      version: 3,
      id: SESSION_ID,
      timestamp: "2026-08-20T11:58:00.000Z",
      cwd: "/Users/test/luke",
    },
    message("m1", null, "2026-08-20T11:58:00.000Z", {
      role: "user",
      content: "Fix the flaky updater test",
    }),
    message("m2", "m1", "2026-08-20T11:58:10.000Z", {
      role: "assistant",
      content: [{ type: "text", text: "Looking." }],
      stopReason: "error",
      errorMessage: "Provider rejected the request.",
    }),
    message("m3", "m2", "2026-08-20T11:58:20.000Z", {
      role: "user",
      content: "continue",
      synthetic: true,
    }),
  ]);

  const rendered = await readOmpSessionTranscript({
    ompHome,
    providerSessionId: SESSION_ID,
  });

  assert.equal(
    rendered,
    [
      "Developer: Fix the flaky updater test",
      "OMP: Looking.",
      "Error: Provider rejected the request.",
    ].join("\n"),
  );
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

test("reads what a recording gained since the cursor an earlier read minted", async (t) => {
  const ompHome = await temporaryOmpHome(t);
  await writeSessionFile(ompHome, CONVERSATION.slice(0, 3));
  const plugin = ompPlugin({ ompHome });

  const first = await dispatchRead(plugin, "transcriptSince", SESSION_ID);
  assert.equal(first.status, "accepted");
  if (first.status !== "accepted") return;
  assert.equal(first.text, "Developer: Fix the flaky updater test");
  assert.equal(first.truncated, false);

  await fs.appendFile(
    path.join(ompHome, OMP_SESSIONS_DIRECTORY, "luke", SESSION_FILE_NAME),
    `${JSON.stringify(
      message("m9", "m1", "2026-08-20T11:59:00.000Z", {
        role: "assistant",
        content: [{ type: "text", text: "Green again." }],
      }),
    )}\n`,
  );

  const second = await dispatchRead(plugin, "transcriptSince", SESSION_ID, first.cursor);
  assert.equal(second.status, "accepted");
  if (second.status !== "accepted") return;
  assert.equal(second.text, "OMP: Green again.");
  assert.notEqual(second.cursor, first.cursor);
});
