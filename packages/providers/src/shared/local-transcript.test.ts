import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import type { WireRecord } from "@sidecar/wire";
import { readRecordsSince, TranscriptPathCache } from "./local-transcript.js";

const WINDOW_BYTES = 256;

async function temporaryDirectory(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-transcript-since-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function line(sequence: number): string {
  return `${JSON.stringify({ type: "user", n: sequence })}\n`;
}

async function writeLines(filePath: string, sequences: readonly number[]): Promise<number> {
  const content = sequences.map(line).join("");
  await fs.writeFile(filePath, content);
  return Buffer.byteLength(content);
}

async function appendText(filePath: string, content: string): Promise<void> {
  await fs.appendFile(filePath, content);
}

/** The fixture's own sequence number, `NaN` for a record that carries none. */
function sequenceOf(record: WireRecord | undefined): number {
  return Number(record?.n);
}

function sequences(records: readonly WireRecord[]): number[] {
  return records.map(sequenceOf);
}

test("without a cursor, a file inside the window is read whole and the cursor lands at its end", async (t) => {
  const filePath = path.join(await temporaryDirectory(t), "session.jsonl");
  const size = await writeLines(filePath, [1, 2, 3]);

  const read = await readRecordsSince(filePath, undefined, WINDOW_BYTES);

  assert.deepEqual(sequences(read.records), [1, 2, 3]);
  assert.equal(read.cursor, String(size));
  assert.equal(read.truncated, false);
});

test("a cursor read answers only the records appended since, and moves the cursor on", async (t) => {
  const filePath = path.join(await temporaryDirectory(t), "session.jsonl");
  await writeLines(filePath, [1, 2]);
  const first = await readRecordsSince(filePath, undefined, WINDOW_BYTES);
  await appendText(filePath, `${line(3)}${line(4)}`);

  const second = await readRecordsSince(filePath, first.cursor, WINDOW_BYTES);
  const third = await readRecordsSince(filePath, second.cursor, WINDOW_BYTES);

  assert.deepEqual(sequences(second.records), [3, 4]);
  assert.equal(second.truncated, false);
  assert.equal(second.cursor, String((await fs.stat(filePath)).size));
  // Nothing new: the cursor stands where it was and the read says so honestly.
  assert.deepEqual(third.records, []);
  assert.equal(third.cursor, second.cursor);
  assert.equal(third.truncated, false);
});

test("a record still being appended is left for the next read to find whole", async (t) => {
  const filePath = path.join(await temporaryDirectory(t), "session.jsonl");
  const terminated = await writeLines(filePath, [1]);
  const partial = '{"type":"user","n":2';
  await appendText(filePath, partial);

  const first = await readRecordsSince(filePath, undefined, WINDOW_BYTES);
  await appendText(filePath, "}\n");
  const second = await readRecordsSince(filePath, first.cursor, WINDOW_BYTES);

  assert.deepEqual(sequences(first.records), [1]);
  assert.equal(first.cursor, String(terminated));
  assert.deepEqual(sequences(second.records), [2]);
});

test("a tail that begins mid-file drops its leading partial line and says it is truncated", async (t) => {
  const filePath = path.join(await temporaryDirectory(t), "session.jsonl");
  const size = await writeLines(filePath, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.ok(size > WINDOW_BYTES);

  const read = await readRecordsSince(filePath, undefined, WINDOW_BYTES);

  assert.ok(sequenceOf(read.records[0]) > 1);
  assert.equal(sequenceOf(read.records.at(-1)), 15);
  assert.equal(read.cursor, String(size));
  assert.equal(read.truncated, true);
});

test("a cursor the file no longer reaches falls back to the tail", async (t) => {
  const filePath = path.join(await temporaryDirectory(t), "session.jsonl");
  await writeLines(filePath, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  const first = await readRecordsSince(filePath, undefined, WINDOW_BYTES);
  // The provider rotated the file: what stands now is shorter than the cursor.
  const rewrittenSize = await writeLines(filePath, [21, 22]);

  const read = await readRecordsSince(filePath, first.cursor, WINDOW_BYTES);

  assert.deepEqual(sequences(read.records), [21, 22]);
  assert.equal(read.cursor, String(rewrittenSize));
  // The whole rewritten file fit the window, so nothing before it was skipped.
  assert.equal(read.truncated, false);
});

test("a cursor that is not one this reader minted is read as no cursor", async (t) => {
  const filePath = path.join(await temporaryDirectory(t), "session.jsonl");
  const size = await writeLines(filePath, [1, 2]);

  for (const cursor of ["-1", "1.5", "abc", "", "01"]) {
    const read = await readRecordsSince(filePath, cursor, WINDOW_BYTES);
    assert.deepEqual(sequences(read.records), [1, 2], cursor);
    assert.equal(read.cursor, String(size), cursor);
  }
});

test("a window that falls short of the end stops at a line and reports itself truncated", async (t) => {
  const filePath = path.join(await temporaryDirectory(t), "session.jsonl");
  await writeLines(filePath, [1]);
  const first = await readRecordsSince(filePath, undefined, WINDOW_BYTES);
  await appendText(
    filePath,
    [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map(line).join(""),
  );

  const second = await readRecordsSince(filePath, first.cursor, WINDOW_BYTES);
  const third = await readRecordsSince(filePath, second.cursor, WINDOW_BYTES * 4);

  assert.equal(sequenceOf(second.records[0]), 2);
  assert.ok(second.records.length < 19);
  assert.equal(second.truncated, true);
  // The window ended mid-record; the next read begins exactly at that record.
  assert.equal(sequenceOf(third.records[0]), sequenceOf(second.records.at(-1)) + 1);
  assert.equal(sequenceOf(third.records.at(-1)), 20);
  assert.equal(third.truncated, false);
});

test("a line wider than the window is skipped rather than stalled on", async (t) => {
  const filePath = path.join(await temporaryDirectory(t), "session.jsonl");
  await writeLines(filePath, [1]);
  const first = await readRecordsSince(filePath, undefined, WINDOW_BYTES);
  const wide = `${JSON.stringify({ type: "user", n: 2, pad: "x".repeat(WINDOW_BYTES * 2) })}\n`;
  await appendText(filePath, `${wide}${line(3)}`);

  const second = await readRecordsSince(filePath, first.cursor, WINDOW_BYTES);
  const third = await readRecordsSince(filePath, second.cursor, WINDOW_BYTES);
  const fourth = await readRecordsSince(filePath, third.cursor, WINDOW_BYTES);

  assert.deepEqual(second.records, []);
  assert.equal(second.truncated, true);
  assert.equal(Number(second.cursor), Number(first.cursor) + WINDOW_BYTES);
  assert.deepEqual(third.records, []);
  assert.deepEqual(sequences(fourth.records), [3]);
  assert.equal(fourth.truncated, false);
});

test("an empty or missing file answers no records and a cursor at its start", async (t) => {
  const directory = await temporaryDirectory(t);
  const emptyPath = path.join(directory, "empty.jsonl");
  await fs.writeFile(emptyPath, "");

  const empty = await readRecordsSince(emptyPath, undefined, WINDOW_BYTES);
  const missing = await readRecordsSince(path.join(directory, "missing.jsonl"), "42", WINDOW_BYTES);

  assert.deepEqual(empty, { records: [], cursor: "0", truncated: false });
  assert.deepEqual(missing, { records: [], cursor: "0", truncated: false });
});

test("the path cache remembers a file while it stands and looks again once it is gone", async (t) => {
  const directory = await temporaryDirectory(t);
  const firstPath = path.join(directory, "first.jsonl");
  const secondPath = path.join(directory, "second.jsonl");
  await fs.writeFile(firstPath, "");
  const cache = new TranscriptPathCache();
  const lookups: string[] = [];
  let located: string | undefined = firstPath;
  const locate = async () => {
    lookups.push("lookup");
    return located;
  };

  assert.equal(await cache.resolve("session", locate), firstPath);
  assert.equal(await cache.resolve("session", locate), firstPath);
  assert.equal(lookups.length, 1);

  await fs.rm(firstPath);
  await fs.writeFile(secondPath, "");
  located = secondPath;
  assert.equal(await cache.resolve("session", locate), secondPath);
  assert.equal(lookups.length, 2);

  located = undefined;
  assert.equal(await cache.resolve("other", locate), undefined);
  assert.equal(await cache.resolve("other", locate), undefined);
  assert.equal(lookups.length, 4);
});

test("the path cache forgets its oldest entry past the cap", async (t) => {
  const directory = await temporaryDirectory(t);
  const cache = new TranscriptPathCache();
  const filePath = path.join(directory, "shared.jsonl");
  await fs.writeFile(filePath, "");
  let lookups = 0;
  const locate = async () => {
    lookups += 1;
    return filePath;
  };

  for (let index = 0; index <= TranscriptPathCache.MAXIMUM_ENTRIES; index += 1) {
    await cache.resolve(`session-${index}`, locate);
  }
  const before = lookups;
  await cache.resolve(`session-${TranscriptPathCache.MAXIMUM_ENTRIES}`, locate);
  assert.equal(lookups, before);
  await cache.resolve("session-0", locate);
  assert.equal(lookups, before + 1);
});
