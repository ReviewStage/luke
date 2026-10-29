import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ToolSet, tool } from "ai";
import { Result } from "effect";
import { test } from "vitest";
import { z } from "zod";
import { unparsedWire, type WireBoundaryInput, type WireRecord, wireRecord } from "../index.js";
import { runTest } from "../testing/index.js";
import { TOOL_PART_STATE } from "./tool-parts.js";
import {
  readStoredUIMessages,
  readStoredUIMessagesEither,
  UNREGISTERED_TOOL_PART,
} from "./validate.js";

/** The shared fixtures beside the session vocabulary, plain JSON so another language's decoder reads the same files. */
const FIXTURE_DIRECTORY = path.join(
  fileURLToPath(import.meta.url),
  "../../../fixtures/ui-messages",
);

const FIXTURE = {
  SPOKEN_ASK: "spoken-ask.json",
  REPLY_WITH_TOOL_PART: "reply-with-tool-part.json",
  COMPACTION: "compaction.json",
  OBSERVATION_HOOK: "observation-hook.json",
  OBSERVATION_TRANSCRIPT_CHANGE: "observation-transcript-change.json",
  CHILD_TASK: "child-task.json",
  CHILD_COMPLETION: "child-completion.json",
  RECALLED_NOTES: "recalled-notes.json",
  COMPACTION_UNCOUNTED: "compaction-uncounted.json",
} as const;

async function fixture(name: (typeof FIXTURE)[keyof typeof FIXTURE]): Promise<WireRecord> {
  // SAFETY: the fixture files are JSON this repository commits; JSON.parse answers the structured-clone shape the wire boundary takes.
  const parsed = JSON.parse(
    await readFile(path.join(FIXTURE_DIRECTORY, name), "utf8"),
  ) as WireBoundaryInput;
  const record = wireRecord(unparsedWire(parsed));
  if (record === undefined) throw new Error("fixture is not a record");
  return record;
}

const TOOLS: ToolSet = {
  read_transcript: tool({
    description: "Reads the tail of an observed session's transcript.",
    inputSchema: z.object({ providerId: z.string(), providerSessionId: z.string() }),
    outputSchema: z.object({ lines: z.array(z.string()) }),
  }),
};

test("each fixture round-trips through the wrapper unchanged", async () => {
  for (const name of Object.values(FIXTURE)) {
    const message = await fixture(name);
    assert.deepEqual(await runTest(readStoredUIMessages([message], TOOLS)), {
      ok: true,
      value: [message],
    });
  }
});

test("a stored-row read drops a tool part naming a tool the registry has retired and reads the row without it", async () => {
  const reply = await fixture(FIXTURE.REPLY_WITH_TOOL_PART);
  const replyParts = reply.parts;
  assert.ok(Array.isArray(replyParts));
  const read = await runTest(readStoredUIMessages([reply], {}, UNREGISTERED_TOOL_PART.DROP));
  assert.equal(read.ok, true);
  if (!read.ok) return;
  const [stored] = read.value;
  assert.deepEqual(stored, {
    ...reply,
    parts: replyParts.filter((part) => wireRecord(part)?.type !== "tool-read_transcript"),
  });
  // A call still pending under the retired tool goes the same way, and a registered part beside it stays.
  const mixed = {
    ...reply,
    parts: [
      {
        type: "tool-retired_tool",
        toolCallId: "call_11",
        state: TOOL_PART_STATE.INPUT_AVAILABLE,
        input: { anything: true },
      },
      ...replyParts,
    ],
  };
  const readMixed = await runTest(
    readStoredUIMessages([mixed], TOOLS, UNREGISTERED_TOOL_PART.DROP),
  );
  assert.deepEqual(readMixed, { ok: true, value: [reply] });
  // The Either entry point takes the same word.
  const either = await runTest(
    readStoredUIMessagesEither([mixed], TOOLS, UNREGISTERED_TOOL_PART.DROP),
  );
  assert.ok(Result.isSuccess(either));
  assert.deepEqual(either.success, [reply]);
});

test("a stored-row read holds a row to the structure and the registry's names, not to each tool's schemas, which the write door holds it to", async () => {
  const reply = await fixture(FIXTURE.REPLY_WITH_TOOL_PART);
  const answered = {
    ...reply,
    parts: [
      {
        type: "tool-read_transcript",
        toolCallId: "call_12",
        state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
        input: { providerId: "codex", providerSessionId: "session-1" },
        output: { lines: "not a list" },
      },
    ],
  };
  assert.equal((await runTest(readStoredUIMessages([answered], TOOLS))).ok, false);
  assert.deepEqual(
    await runTest(readStoredUIMessages([answered], TOOLS, UNREGISTERED_TOOL_PART.DROP)),
    { ok: true, value: [answered] },
  );
  // A row the SDK's structure refuses is still refused on read.
  const shapeless = { ...reply, parts: [{ type: "text" }] };
  assert.equal(
    (await runTest(readStoredUIMessages([shapeless], TOOLS, UNREGISTERED_TOOL_PART.DROP))).ok,
    false,
  );
});
