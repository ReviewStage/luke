import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@sidecar/runtime/testing";
import type { WireRecord } from "@sidecar/wire";
import { Effect } from "effect";
import { readRecordsSince, TranscriptPathCache } from "./jsonl-transcript.js";

const WINDOW_BYTES = 256;

function line(sequence: number): string {
  return `${JSON.stringify({ type: "user", n: sequence })}\n`;
}

function writeLines(filePath: string, sequences: readonly number[]): Effect.Effect<number> {
  const content = sequences.map(line).join("");
  return Effect.promise(async () => {
    await fs.writeFile(filePath, content);
    return Buffer.byteLength(content);
  });
}

function appendText(filePath: string, content: string): Effect.Effect<void> {
  return Effect.promise(() => fs.appendFile(filePath, content));
}

function fileSize(filePath: string): Effect.Effect<number> {
  return Effect.promise(async () => (await fs.stat(filePath)).size);
}

/** The fixture's own sequence number, `NaN` for a record that carries none. */
function sequenceOf(record: WireRecord | undefined): number {
  return Number(record?.n);
}

function sequences(records: readonly WireRecord[]): number[] {
  return records.map(sequenceOf);
}

/** A session file inside a directory this test's own scope removes. */
const sessionFile = (name = "session.jsonl") =>
  Effect.map(temporaryDirectoryScoped(), (directory) => path.join(directory, name));

it.effect(
  "without a cursor, a file inside the window is read whole and the cursor lands at its end",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const filePath = yield* sessionFile();
        const size = yield* writeLines(filePath, [1, 2, 3]);

        const read = yield* readRecordsSince(filePath, undefined, WINDOW_BYTES);

        assert.deepEqual(sequences(read.records), [1, 2, 3]);
        assert.equal(read.cursor, String(size));
        assert.equal(read.truncated, false);
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("a cursor read answers only the records appended since, and moves the cursor on", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const filePath = yield* sessionFile();
      yield* writeLines(filePath, [1, 2]);
      const first = yield* readRecordsSince(filePath, undefined, WINDOW_BYTES);
      yield* appendText(filePath, `${line(3)}${line(4)}`);

      const second = yield* readRecordsSince(filePath, first.cursor, WINDOW_BYTES);
      const third = yield* readRecordsSince(filePath, second.cursor, WINDOW_BYTES);

      assert.deepEqual(sequences(second.records), [3, 4]);
      assert.equal(second.truncated, false);
      assert.equal(second.cursor, String(yield* fileSize(filePath)));
      // Nothing new: the cursor stands where it was and the read says so honestly.
      assert.deepEqual(third.records, []);
      assert.equal(third.cursor, second.cursor);
      assert.equal(third.truncated, false);
    }),
  ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("a record still being appended is left for the next read to find whole", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const filePath = yield* sessionFile();
      const terminated = yield* writeLines(filePath, [1]);
      yield* appendText(filePath, '{"type":"user","n":2');

      const first = yield* readRecordsSince(filePath, undefined, WINDOW_BYTES);
      yield* appendText(filePath, "}\n");
      const second = yield* readRecordsSince(filePath, first.cursor, WINDOW_BYTES);

      assert.deepEqual(sequences(first.records), [1]);
      assert.equal(first.cursor, String(terminated));
      assert.deepEqual(sequences(second.records), [2]);
    }),
  ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect(
  "a tail that begins mid-file drops its leading partial line and says it is truncated",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const filePath = yield* sessionFile();
        const size = yield* writeLines(
          filePath,
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        );
        assert.ok(size > WINDOW_BYTES);

        const read = yield* readRecordsSince(filePath, undefined, WINDOW_BYTES);

        assert.ok(sequenceOf(read.records[0]) > 1);
        assert.equal(sequenceOf(read.records.at(-1)), 15);
        assert.equal(read.cursor, String(size));
        assert.equal(read.truncated, true);
      }),
    ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("a cursor the file no longer reaches falls back to the tail", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const filePath = yield* sessionFile();
      yield* writeLines(filePath, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
      const first = yield* readRecordsSince(filePath, undefined, WINDOW_BYTES);
      // The provider rotated the file: what stands now is shorter than the cursor.
      const rewrittenSize = yield* writeLines(filePath, [21, 22]);

      const read = yield* readRecordsSince(filePath, first.cursor, WINDOW_BYTES);

      assert.deepEqual(sequences(read.records), [21, 22]);
      assert.equal(read.cursor, String(rewrittenSize));
      // The whole rewritten file fit the window, so nothing before it was skipped.
      assert.equal(read.truncated, false);
    }),
  ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("a cursor that is not one this reader minted is read as no cursor", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const filePath = yield* sessionFile();
      const size = yield* writeLines(filePath, [1, 2]);

      for (const cursor of ["-1", "1.5", "abc", "", "01"]) {
        const read = yield* readRecordsSince(filePath, cursor, WINDOW_BYTES);
        assert.deepEqual(sequences(read.records), [1, 2], cursor);
        assert.equal(read.cursor, String(size), cursor);
      }
    }),
  ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("a window that falls short of the end stops at a line and reports itself truncated", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const filePath = yield* sessionFile();
      yield* writeLines(filePath, [1]);
      const first = yield* readRecordsSince(filePath, undefined, WINDOW_BYTES);
      yield* appendText(
        filePath,
        [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map(line).join(""),
      );

      const second = yield* readRecordsSince(filePath, first.cursor, WINDOW_BYTES);
      const third = yield* readRecordsSince(filePath, second.cursor, WINDOW_BYTES * 4);

      assert.equal(sequenceOf(second.records[0]), 2);
      assert.ok(second.records.length < 19);
      assert.equal(second.truncated, true);
      // The window ended mid-record; the next read begins exactly at that record.
      assert.equal(sequenceOf(third.records[0]), sequenceOf(second.records.at(-1)) + 1);
      assert.equal(sequenceOf(third.records.at(-1)), 20);
      assert.equal(third.truncated, false);
    }),
  ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("a line wider than the window is skipped rather than stalled on", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const filePath = yield* sessionFile();
      yield* writeLines(filePath, [1]);
      const first = yield* readRecordsSince(filePath, undefined, WINDOW_BYTES);
      const wide = `${JSON.stringify({ type: "user", n: 2, pad: "x".repeat(WINDOW_BYTES * 2) })}\n`;
      yield* appendText(filePath, `${wide}${line(3)}`);

      const second = yield* readRecordsSince(filePath, first.cursor, WINDOW_BYTES);
      const third = yield* readRecordsSince(filePath, second.cursor, WINDOW_BYTES);
      const fourth = yield* readRecordsSince(filePath, third.cursor, WINDOW_BYTES);

      assert.deepEqual(second.records, []);
      assert.equal(second.truncated, true);
      assert.equal(Number(second.cursor), Number(first.cursor) + WINDOW_BYTES);
      assert.deepEqual(third.records, []);
      assert.deepEqual(sequences(fourth.records), [3]);
      assert.equal(fourth.truncated, false);
    }),
  ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("an empty or missing file answers no records and a cursor at its start", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped();
      const emptyPath = path.join(directory, "empty.jsonl");
      yield* Effect.promise(() => fs.writeFile(emptyPath, ""));

      const empty = yield* readRecordsSince(emptyPath, undefined, WINDOW_BYTES);
      const missing = yield* readRecordsSince(
        path.join(directory, "missing.jsonl"),
        "42",
        WINDOW_BYTES,
      );

      assert.deepEqual(empty, { records: [], cursor: "0", truncated: false });
      assert.deepEqual(missing, { records: [], cursor: "0", truncated: false });
    }),
  ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("the path cache remembers a file while it stands and looks again once it is gone", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped();
      const firstPath = path.join(directory, "first.jsonl");
      const secondPath = path.join(directory, "second.jsonl");
      yield* Effect.promise(() => fs.writeFile(firstPath, ""));
      const cache = new TranscriptPathCache();
      const lookups: string[] = [];
      let located: string | undefined = firstPath;
      const locate = () =>
        Effect.sync(() => {
          lookups.push("lookup");
          return located;
        });

      assert.equal(yield* cache.resolve("session", locate), firstPath);
      assert.equal(yield* cache.resolve("session", locate), firstPath);
      assert.equal(lookups.length, 1);

      yield* Effect.promise(() => fs.rm(firstPath));
      yield* Effect.promise(() => fs.writeFile(secondPath, ""));
      located = secondPath;
      assert.equal(yield* cache.resolve("session", locate), secondPath);
      assert.equal(lookups.length, 2);

      located = undefined;
      assert.equal(yield* cache.resolve("other", locate), undefined);
      assert.equal(yield* cache.resolve("other", locate), undefined);
      assert.equal(lookups.length, 4);
    }),
  ).pipe(Effect.provide(NodeFileSystem.layer)),
);

it.effect("the path cache forgets its oldest entry past the cap", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped();
      const cache = new TranscriptPathCache();
      const filePath = path.join(directory, "shared.jsonl");
      yield* Effect.promise(() => fs.writeFile(filePath, ""));
      let lookups = 0;
      const locate = () =>
        Effect.sync(() => {
          lookups += 1;
          return filePath;
        });

      for (let index = 0; index <= TranscriptPathCache.MAXIMUM_ENTRIES; index += 1) {
        yield* cache.resolve(`session-${index}`, locate);
      }
      const before = lookups;
      yield* cache.resolve(`session-${TranscriptPathCache.MAXIMUM_ENTRIES}`, locate);
      assert.equal(lookups, before);
      yield* cache.resolve("session-0", locate);
      assert.equal(lookups, before + 1);
    }),
  ).pipe(Effect.provide(NodeFileSystem.layer)),
);
