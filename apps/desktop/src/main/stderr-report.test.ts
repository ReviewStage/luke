import assert from "node:assert/strict";
import { test } from "vitest";
import { reportToStderr } from "./stderr-report";

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
