import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  unparsedWire,
  type WireBoundaryInput,
  type WireRecord,
  wireRecord,
} from "@sidecar/wire";
import { type ToolSet, tool } from "ai";
import { z } from "zod";
import {
  type CompactionMessage,
  type CompactionSummary,
  compactionSummaryMessage,
  isCompactionMessage,
} from "./compaction.js";
import { readStoredUIMessages, type StoredUIMessage } from "./validate.js";

const FIXTURE_DIRECTORY = path.join(
  fileURLToPath(import.meta.url),
  "../../../fixtures/ui-messages",
);

async function fixture(name: string): Promise<WireRecord> {
  // SAFETY: the fixture files are JSON this repository commits; JSON.parse answers the structured-clone shape the wire boundary takes.
  const parsed = JSON.parse(
    await readFile(path.join(FIXTURE_DIRECTORY, name), "utf8"),
  ) as WireBoundaryInput;
  const record = wireRecord(unparsedWire(parsed));
  if (record === undefined) throw new Error("fixture is not a record");
  return record;
}

/** A built row as a store reads it back: through the JSON a row is kept as. */
function stored(message: CompactionMessage): WireRecord {
  // SAFETY: the row is this test's own JSON-serializable value; parsing it back yields the wire value a reader takes.
  const record = wireRecord(unparsedWire(JSON.parse(JSON.stringify(message)) as WireBoundaryInput));
  if (record === undefined) throw new Error("the row is not a record");
  return record;
}

const TOOLS: ToolSet = {
  read_transcript: tool({
    description: "Reads the tail of an observed session's transcript.",
    inputSchema: z.object({ providerId: z.string(), providerSessionId: z.string() }),
    outputSchema: z.object({ lines: z.array(z.string()) }),
  }),
};

/** The committed compaction fixture's own values, so the builder is held to the shape another decoder reads. */
const FIXTURE_SUMMARY: CompactionSummary = {
  text: "Earlier in this conversation the developer asked about the fixture session twice; it was working on a fixture test and then held on a permission prompt. Nothing was sent to it.",
  firstKeptMessageId: "5a2d7b3c-8e4f-4a9b-8c12-3d4e5f6a7b81",
  tokensBefore: 48210,
};
const FIXTURE_ID = "7c3e9d4f-1a5b-4c2d-9e34-5f6a7b8c9d92";

test("the summary message is the compaction fixture's shape exactly, and reads back through the store reader", async () => {
  const message = compactionSummaryMessage(FIXTURE_ID, FIXTURE_SUMMARY);
  assert.deepEqual(message, await fixture("compaction.json"));
  assert.ok(message);
  const read = await readStoredUIMessages([stored(message)], TOOLS);
  assert.deepEqual(read, { ok: true, value: [message] });
});

test("a fold whose runtime reported no token count writes none: the key is absent, never zero", async () => {
  const { tokensBefore: _unreported, ...uncounted } = FIXTURE_SUMMARY;
  const message = compactionSummaryMessage("2f6b8c1d-9e0a-4b3c-8d7e-6f5a4b3c2d11", uncounted);
  assert.deepEqual(message, await fixture("compaction-uncounted.json"));
  assert.ok(message);
  assert.deepEqual(Object.keys(message.metadata.compaction), ["first_kept_message_id"]);
  assert.deepEqual(await readStoredUIMessages([stored(message)], TOOLS), {
    ok: true,
    value: [message],
  });
});

test("the row is an assistant message in Luke's own voice with one finished text part, and its metadata names what it folded", () => {
  const message = compactionSummaryMessage("m-1", {
    text: "  The developer asked twice; nothing was sent.  ",
    firstKeptMessageId: "m-0",
    tokensBefore: 0,
  });
  assert.ok(message);
  assert.equal(message.role, MESSAGE_ROLE.ASSISTANT);
  assert.equal(message.metadata.author, MESSAGE_AUTHOR.BRAIN);
  assert.deepEqual(message.metadata.compaction, { first_kept_message_id: "m-0", tokens_before: 0 });
  assert.deepEqual(
    message.parts.map((part) => part.type),
    ["text"],
  );
  assert.deepEqual(message.parts[0], {
    type: "text",
    text: "The developer asked twice; nothing was sent.",
    state: "done",
  });
});

test("a summary with no words, or metadata the schema refuses, builds no row", () => {
  const sound = { firstKeptMessageId: "m-0", tokensBefore: 12 };
  assert.equal(compactionSummaryMessage("m-1", { ...sound, text: "" }), undefined);
  assert.equal(compactionSummaryMessage("m-1", { ...sound, text: " \n\t " }), undefined);
  assert.equal(
    compactionSummaryMessage("m-1", { ...sound, text: "words", tokensBefore: -1 }),
    undefined,
  );
  assert.equal(
    compactionSummaryMessage("m-1", { ...sound, text: "words", tokensBefore: 1.5 }),
    undefined,
  );
  assert.equal(
    compactionSummaryMessage("m-1", { ...sound, text: "words", firstKeptMessageId: "" }),
    undefined,
  );
  assert.equal(
    compactionSummaryMessage("m-1", {
      ...sound,
      text: "words",
      firstKeptMessageId: "k".repeat(129),
    }),
    undefined,
  );
});

test("a compaction row is told from an ordinary reply and from a user row by its metadata alone", async () => {
  const compaction = compactionSummaryMessage(FIXTURE_ID, FIXTURE_SUMMARY);
  assert.ok(compaction);
  const read = await readStoredUIMessages(
    [
      await fixture("spoken-ask.json"),
      await fixture("reply-with-tool-part.json"),
      stored(compaction),
    ],
    TOOLS,
  );
  assert.ok(read.ok);
  const rows: StoredUIMessage[] = read.value;
  assert.deepEqual(rows.map(isCompactionMessage), [false, false, true]);
  const [, reply] = rows;
  assert.equal(reply?.role, MESSAGE_ROLE.ASSISTANT);
});
