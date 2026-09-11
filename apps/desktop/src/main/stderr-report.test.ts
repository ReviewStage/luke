import assert from "node:assert/strict";
import { Effect, Logger } from "effect";
import { test } from "vitest";
import { reportToStderr, stderrLogger } from "./stderr-report";

test("a report to a stderr that throws on write is dropped, not raised", () => {
  const original = process.stderr.write;
  const closed = Object.assign(new Error("write EIO"), { code: "EIO" });
  // SAFETY: the reporter only ever calls write with one string, and a closed
  // pipe's write throws before it would read any other argument.
  process.stderr.write = (() => {
    throw closed;
  }) as typeof process.stderr.write;
  try {
    assert.doesNotThrow(() => reportToStderr("the service did not stop cleanly"));
  } finally {
    process.stderr.write = original;
  }
});

test("the reporter and the Logger sink write the same line", async () => {
  const written: string[] = [];
  const original = process.stderr.write;
  // SAFETY: both faces under test call write with one string and nothing else.
  process.stderr.write = ((chunk: string) => {
    written.push(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    reportToStderr("the service did not stop cleanly");
    await Effect.runPromise(
      Effect.log("the service did not stop cleanly").pipe(
        Effect.provide(Logger.replace(Logger.defaultLogger, stderrLogger)),
      ),
    );
  } finally {
    process.stderr.write = original;
  }
  assert.deepEqual(written, [
    "the service did not stop cleanly\n",
    "the service did not stop cleanly\n",
  ]);
});
