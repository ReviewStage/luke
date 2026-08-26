import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ATTENTION_TRIGGER } from "@sidecar/attention";
import { ATTENTION_DISPOSITION, SESSION_STATUS } from "@sidecar/session";
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
  writer.recordAttention({
    update: {
      providerId: "claude-code",
      providerSessionId: "abc",
      trigger: ATTENTION_TRIGGER.OBSERVED,
      providerName: "Claude Code",
      title: "checkout-service",
      status: SESSION_STATUS.WAITING,
      observedAt: 1_800_000_000_000,
    },
    decision: {
      disposition: ATTENTION_DISPOSITION.SILENT,
      decidedAt: 1_800_000_000_500,
    },
    elapsedMs: 250,
  });
  await writer.settled();
  const lines = (await readFile(writer.file, "utf8")).split("\n").filter((line) => line.length > 0);
  const entries = lines.map(recordFromJsonLine);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.kind, TRACE_ENTRY_KIND.WIRE);
  assert.equal(entries[0]?.direction, TRACE_DIRECTION.CLIENT);
  assert.equal(entries[1]?.kind, TRACE_ENTRY_KIND.ATTENTION);
  assert.equal(entries[1]?.elapsedMs, 250);
  assert.ok(isRecord(entries[1]?.decision));
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
