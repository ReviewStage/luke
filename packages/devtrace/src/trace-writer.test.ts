import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { BRAIN_CLIENT_OUTCOME, BRAIN_TURN_TRIGGER, DIGEST_STOP_STATE } from "@sidecar/brain";
import { isRecord, isWireString, recordFromJsonLine } from "@sidecar/wire";
import { AgentTraceWriter, TRACE_ENTRY_KIND } from "./trace-writer.js";
import { TRACE_DIRECTION } from "./vocabulary.js";

function fixedClock(): () => Date {
  let tick = 0;
  return () => {
    tick += 1_000;
    return new Date(1_800_000_000_000 + tick);
  };
}

test("lines land in the named file, stamped, in the order they were recorded", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "devtrace-"));
  const writer = new AgentTraceWriter({ directory, now: fixedClock() });
  writer.recordWire({
    direction: TRACE_DIRECTION.CLIENT,
    event: { type: "response.create" },
  });
  writer.recordBrainRequest({
    inputItems: 3,
    inputChars: 2_048,
    outcome: BRAIN_CLIENT_OUTCOME.ANSWERED,
    elapsedMs: 900,
    outputItemKinds: ["reasoning", "message"],
    inputTokens: 1_500,
    outputTokens: 60,
  });
  writer.recordBrainTurn({
    trigger: BRAIN_TURN_TRIGGER.WAKE,
    inputItemKinds: ["message", "message"],
    inputTokens: 1_500,
    transcriptBytes: 4_096,
    digests: [
      {
        source: "model",
        outcome: BRAIN_CLIENT_OUTCOME.ANSWERED,
        stopState: DIGEST_STOP_STATE.FINISHED,
        elapsedMs: 700,
        digestChars: 180,
        transcriptChars: 4_096,
      },
    ],
    toolCalls: [{ name: "announce", argumentsChars: 120, outcomeStatus: "accepted" }],
    deliveries: [{ briefingChars: 96 }],
    elapsedMs: 1_250,
    iterations: 1,
    compacted: false,
  });
  writer.recordSpeechDecision({ kind: "briefing", decision: "offered", pendingCount: 2 });
  await writer.settled();
  const lines = (await readFile(writer.file, "utf8")).split("\n").filter((line) => line.length > 0);
  const entries = lines.map(recordFromJsonLine);
  assert.equal(entries.length, 4);
  assert.equal(entries[0]?.kind, TRACE_ENTRY_KIND.WIRE);
  assert.equal(entries[0]?.direction, TRACE_DIRECTION.CLIENT);
  assert.equal(entries[1]?.kind, TRACE_ENTRY_KIND.BRAIN_REQUEST);
  assert.equal(entries[1]?.outcome, BRAIN_CLIENT_OUTCOME.ANSWERED);
  assert.equal(entries[1]?.inputChars, 2_048);
  assert.ok(entries[1] && !("model" in entries[1]));
  assert.equal(entries[2]?.kind, TRACE_ENTRY_KIND.BRAIN);
  assert.equal(entries[2]?.trigger, BRAIN_TURN_TRIGGER.WAKE);
  assert.equal(entries[2]?.elapsedMs, 1_250);
  assert.ok(Array.isArray(entries[2]?.digests) && isRecord(entries[2]?.digests[0]));
  const toolCalls = entries[2]?.toolCalls;
  assert.ok(Array.isArray(toolCalls) && isRecord(toolCalls[0]));
  assert.equal(entries[3]?.kind, TRACE_ENTRY_KIND.SPEECH);
  assert.deepEqual(entries[3]?.speech, { kind: "briefing", decision: "offered", pendingCount: 2 });
  for (const entry of entries) {
    assert.ok(isWireString(entry?.at));
  }
});

test("raw audio handed straight to the writer still never reaches the file", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "devtrace-"));
  const writer = new AgentTraceWriter({ directory });
  writer.recordWire({
    direction: TRACE_DIRECTION.CLIENT,
    event: { type: "input_audio_buffer.append", audio: "AAAAAAA=" },
  });
  await writer.settled();
  const [line] = (await readFile(writer.file, "utf8")).split("\n");
  const entry = recordFromJsonLine(line ?? "");
  assert.ok(isRecord(entry?.event));
  assert.deepEqual(entry?.event, { type: "input_audio_buffer.append", audioBytes: 5 });
});

test("a writer that cannot write reports once and stays quiet after", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "devtrace-"));
  // A file where the trace directory should be makes every mkdir fail.
  const blocked = path.join(directory, "blocked");
  await writeFile(blocked, "");
  const reports: string[] = [];
  const writer = new AgentTraceWriter({
    directory: blocked,
    report: (message) => reports.push(message),
  });
  writer.recordWire({ direction: TRACE_DIRECTION.CLIENT, event: { type: "one" } });
  writer.recordWire({ direction: TRACE_DIRECTION.CLIENT, event: { type: "two" } });
  await writer.settled();
  assert.equal(reports.length, 1);
  assert.match(reports[0] ?? "", /Agent trace could not be written/u);
});
