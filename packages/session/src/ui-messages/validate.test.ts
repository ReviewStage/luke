import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  MESSAGE_AUTHOR,
  MESSAGE_ROLE,
  OBSERVATION_SOURCE,
  type ObservationSource,
  SCHEMA_REFUSAL,
  type SchemaPath,
  type SchemaRead,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
  type WireRecord,
  wireRecord,
} from "@sidecar/wire";
import { type ToolSet, tool } from "ai";
import { z } from "zod";
import { isStoredToolPart, TOOL_PART_STATE } from "./tool-parts.js";
import { readStoredUIMessages, type StoredUIMessage } from "./validate.js";

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
  OBSERVATION_ROSTER_LOOK: "observation-roster-look.json",
  HOLD_RELEASE: "hold-release.json",
  CHILD_TASK: "child-task.json",
  CHILD_COMPLETION: "child-completion.json",
  RECALLED_NOTES: "recalled-notes.json",
  ACTIVITY_NOTICES: "activity-notices.json",
} as const;

/** The fixture that carries each source the brain writes a user row under, one per member of the set. */
const BRAIN_SOURCE_FIXTURES = {
  [OBSERVATION_SOURCE.HOOK]: FIXTURE.OBSERVATION_HOOK,
  [OBSERVATION_SOURCE.ROSTER_LOOK]: FIXTURE.OBSERVATION_ROSTER_LOOK,
  [OBSERVATION_SOURCE.HOLD_RELEASE]: FIXTURE.HOLD_RELEASE,
  [OBSERVATION_SOURCE.CHILD]: FIXTURE.CHILD_TASK,
  [OBSERVATION_SOURCE.CHILD_COMPLETION]: FIXTURE.CHILD_COMPLETION,
  [OBSERVATION_SOURCE.RECALLED_NOTES]: FIXTURE.RECALLED_NOTES,
  [OBSERVATION_SOURCE.ACTIVITY_NOTICES]: FIXTURE.ACTIVITY_NOTICES,
} as const satisfies Record<ObservationSource, (typeof FIXTURE)[keyof typeof FIXTURE]>;

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

const TOOL_INPUT = { providerId: "conductor", providerSessionId: "s" };

function refusalOf(read: SchemaRead<StoredUIMessage[]>): string {
  return read.ok ? "admitted" : read.refusal;
}

function pathOf(read: SchemaRead<StoredUIMessage[]>): SchemaPath {
  return read.ok ? [] : read.path;
}

function withMetadata(message: WireRecord, metadata: UnparsedWireValue): WireRecord {
  const { metadata: _replaced, ...rest } = message;
  return metadata === undefined ? rest : { ...rest, metadata };
}

/** The reply fixture carrying one tool part in place of its own. */
async function replyWithToolPart(part: WireRecord): Promise<WireRecord> {
  return { ...(await fixture(FIXTURE.REPLY_WITH_TOOL_PART)), parts: [part] };
}

test("no rows read back as no messages", async () => {
  assert.deepEqual(await readStoredUIMessages([], TOOLS), { ok: true, value: [] });
});

test("each fixture round-trips through the wrapper unchanged", async () => {
  for (const name of Object.values(FIXTURE)) {
    const message = await fixture(name);
    assert.deepEqual(await readStoredUIMessages([message], TOOLS), { ok: true, value: [message] });
  }
});

test("a row is typed by its role, and its tool parts are told by their state", async () => {
  const read = await readStoredUIMessages(
    [await fixture(FIXTURE.SPOKEN_ASK), await fixture(FIXTURE.REPLY_WITH_TOOL_PART)],
    TOOLS,
  );
  assert.equal(read.ok, true);
  if (!read.ok) return;
  const [ask, reply] = read.value;
  assert.equal(ask?.role, MESSAGE_ROLE.USER);
  if (ask?.role !== MESSAGE_ROLE.USER) return;
  assert.equal(ask.metadata.author, MESSAGE_AUTHOR.DEVELOPER);
  assert.equal(reply?.role, MESSAGE_ROLE.ASSISTANT);
  if (reply?.role !== MESSAGE_ROLE.ASSISTANT) return;
  assert.equal(reply.metadata.author, MESSAGE_AUTHOR.BRAIN);
  assert.deepEqual(
    reply.parts.map((part) => (isStoredToolPart(part) ? part.state : undefined)),
    [undefined, undefined, TOOL_PART_STATE.OUTPUT_AVAILABLE, undefined],
  );
});

test("a brain-authored user row reads back under each source the vocabulary names, and a source it does not name is refused", async () => {
  for (const [source, name] of Object.entries(BRAIN_SOURCE_FIXTURES)) {
    const message = await fixture(name);
    const read = await readStoredUIMessages([message], TOOLS);
    assert.ok(read.ok);
    const [stored] = read.value;
    assert.equal(stored?.role, MESSAGE_ROLE.USER);
    assert.deepEqual(stored?.metadata, { author: MESSAGE_AUTHOR.BRAIN, source });
  }
  const unnamed = withMetadata(await fixture(FIXTURE.HOLD_RELEASE), {
    author: MESSAGE_AUTHOR.BRAIN,
    source: "bulletin",
  });
  const read = await readStoredUIMessages([unnamed], TOOLS);
  assert.equal(refusalOf(read), SCHEMA_REFUSAL.MALFORMED);
  assert.deepEqual(pathOf(read), [0, "metadata"]);
});

test("a message with metadata the vocabulary does not name is refused at the metadata", async () => {
  const spokenAsk = await fixture(FIXTURE.SPOKEN_ASK);
  const extra = withMetadata(spokenAsk, { ...wireRecord(spokenAsk.metadata), mood: "cheerful" });
  const read = await readStoredUIMessages([extra], TOOLS);
  assert.equal(refusalOf(read), SCHEMA_REFUSAL.MALFORMED);
  assert.deepEqual(pathOf(read), [0, "metadata"]);
  const compaction = await fixture(FIXTURE.COMPACTION);
  const decorated = withMetadata(compaction, { author: MESSAGE_AUTHOR.BRAIN, mood: "cheerful" });
  assert.deepEqual(pathOf(await readStoredUIMessages([decorated], TOOLS)), [0, "metadata", "mood"]);
});

test("a role's metadata is held to that role's schema", async () => {
  const spokenAsk = await fixture(FIXTURE.SPOKEN_ASK);
  const compaction = await fixture(FIXTURE.COMPACTION);
  const childAsUser = withMetadata(spokenAsk, { author: MESSAGE_AUTHOR.CHILD, channel: "typed" });
  assert.deepEqual(pathOf(await readStoredUIMessages([childAsUser], TOOLS)), [0, "metadata"]);
  const developerAsAssistant = withMetadata(compaction, { author: MESSAGE_AUTHOR.DEVELOPER });
  assert.deepEqual(pathOf(await readStoredUIMessages([spokenAsk, developerAsAssistant], TOOLS)), [
    1,
    "metadata",
    "author",
  ]);
  const unwritten = withMetadata(compaction, undefined);
  assert.deepEqual(pathOf(await readStoredUIMessages([unwritten], TOOLS)), [0, "metadata"]);
});

test("a system message carries no metadata", async () => {
  const bare: WireRecord = {
    id: "sys_1",
    role: MESSAGE_ROLE.SYSTEM,
    parts: [{ type: "text", text: "Be brief." }],
  };
  assert.deepEqual(await readStoredUIMessages([bare], TOOLS), { ok: true, value: [bare] });
  const decorated = withMetadata(bare, { author: MESSAGE_AUTHOR.BRAIN });
  assert.deepEqual(pathOf(await readStoredUIMessages([decorated], TOOLS)), [0, "metadata"]);
});

test("a tool part naming a tool the registry does not hold is refused, whatever its state", async () => {
  const reply = await fixture(FIXTURE.REPLY_WITH_TOOL_PART);
  const readAnswered = await readStoredUIMessages([reply], {});
  assert.equal(refusalOf(readAnswered), SCHEMA_REFUSAL.NOT_REGISTERED);
  assert.deepEqual(pathOf(readAnswered), [0, "parts", 2, "type"]);
  const pending = await replyWithToolPart({
    type: "tool-list_sessions",
    toolCallId: "call_2",
    state: TOOL_PART_STATE.INPUT_AVAILABLE,
    input: {},
  });
  const readPending = await readStoredUIMessages([pending], TOOLS);
  assert.equal(refusalOf(readPending), SCHEMA_REFUSAL.NOT_REGISTERED);
  assert.deepEqual(pathOf(readPending), [0, "parts", 0, "type"]);
});

test("a dynamic tool part is refused: a stored row names a registered tool or none", async () => {
  const dynamic = await replyWithToolPart({
    type: "dynamic-tool",
    toolName: "read_transcript",
    toolCallId: "call_3",
    state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
    input: {},
    output: {},
  });
  const read = await readStoredUIMessages([dynamic], TOOLS);
  assert.equal(refusalOf(read), SCHEMA_REFUSAL.NOT_REGISTERED);
  assert.deepEqual(pathOf(read), [0, "parts", 0, "type"]);
});

test("a registered tool's input is held to its schema in every state, including the ones the SDK would convert", async () => {
  const wrongInput = await replyWithToolPart({
    type: "tool-read_transcript",
    toolCallId: "call_4",
    state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
    input: { providerId: 7 },
    output: { lines: [] },
  });
  assert.equal(
    refusalOf(await readStoredUIMessages([wrongInput], TOOLS)),
    SCHEMA_REFUSAL.MALFORMED,
  );
  const emptyInput = await replyWithToolPart({
    type: "tool-read_transcript",
    toolCallId: "call_5",
    state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
    input: {},
    output: { lines: [] },
  });
  const readEmpty = await readStoredUIMessages([emptyInput], TOOLS);
  assert.equal(refusalOf(readEmpty), SCHEMA_REFUSAL.MALFORMED);
  assert.deepEqual(pathOf(readEmpty), [0, "parts", 0, "input"]);
  const failedWithRefusedInput = await replyWithToolPart({
    type: "tool-read_transcript",
    toolCallId: "call_6",
    state: TOOL_PART_STATE.OUTPUT_ERROR,
    input: { providerId: 7 },
    errorText: "refused",
  });
  const readFailed = await readStoredUIMessages([failedWithRefusedInput], TOOLS);
  assert.equal(refusalOf(readFailed), SCHEMA_REFUSAL.MALFORMED);
  assert.deepEqual(pathOf(readFailed), [0, "parts", 0, "input"]);
});

test("a tool part in an SDK state the store never writes is refused at its state", async () => {
  const awaitingApproval = await replyWithToolPart({
    type: "tool-read_transcript",
    toolCallId: "call_7",
    state: "approval-requested",
    input: TOOL_INPUT,
    approval: { id: "approval_1" },
  });
  const readAwaiting = await readStoredUIMessages([awaitingApproval], TOOLS);
  assert.equal(refusalOf(readAwaiting), SCHEMA_REFUSAL.MALFORMED);
  assert.deepEqual(pathOf(readAwaiting), [0, "parts", 0, "state"]);
  const denied = await replyWithToolPart({
    type: "tool-read_transcript",
    toolCallId: "call_8",
    state: "output-denied",
    input: TOOL_INPUT,
    approval: { id: "approval_2", approved: false },
  });
  const readDenied = await readStoredUIMessages([denied], TOOLS);
  assert.equal(refusalOf(readDenied), SCHEMA_REFUSAL.MALFORMED);
  assert.deepEqual(pathOf(readDenied), [0, "parts", 0, "state"]);
});

test("the pending and failed journal states are admitted", async () => {
  const pending = await replyWithToolPart({
    type: "tool-read_transcript",
    toolCallId: "call_9",
    state: TOOL_PART_STATE.INPUT_AVAILABLE,
    input: TOOL_INPUT,
  });
  const failed = {
    ...(await replyWithToolPart({
      type: "tool-read_transcript",
      toolCallId: "call_10",
      state: TOOL_PART_STATE.OUTPUT_ERROR,
      input: TOOL_INPUT,
      errorText: "refused: the session is not in the roster",
    })),
    id: "failed_1",
  };
  const read = await readStoredUIMessages([pending, failed], TOOLS);
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.deepEqual(
    read.value.map((message) =>
      message.parts.map((part) => (isStoredToolPart(part) ? part.state : undefined)),
    ),
    [[TOOL_PART_STATE.INPUT_AVAILABLE], [TOOL_PART_STATE.OUTPUT_ERROR]],
  );
});

test("what is not a list of rows, or not a row, is malformed", async () => {
  assert.equal(refusalOf(await readStoredUIMessages({ id: "x" }, TOOLS)), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(refusalOf(await readStoredUIMessages(undefined, TOOLS)), SCHEMA_REFUSAL.MALFORMED);
  assert.equal(
    refusalOf(await readStoredUIMessages(["not a row"], TOOLS)),
    SCHEMA_REFUSAL.MALFORMED,
  );
  assert.equal(
    refusalOf(await readStoredUIMessages([{ id: "x", role: "tool", parts: [] }], TOOLS)),
    SCHEMA_REFUSAL.MALFORMED,
  );
  assert.equal(
    refusalOf(
      await readStoredUIMessages(
        [{ id: "x", role: MESSAGE_ROLE.USER, parts: [{ type: "text" }] }],
        TOOLS,
      ),
    ),
    SCHEMA_REFUSAL.MALFORMED,
  );
});
