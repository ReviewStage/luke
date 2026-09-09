import assert from "node:assert/strict";
import test from "node:test";
import { observeAnswerSchema } from "./observe-wire.js";

const SESSION = {
  providerId: "conductor",
  sessionId: "session-1",
  title: "Fix the roster test",
  status: "working",
};

test("a row a field could not be read from keeps every field that could", () => {
  const answer = observeAnswerSchema.parse({
    sessions: [{ ...SESSION, branch: 7, workspace: "luke", controls: "none" }],
  });
  assert.deepEqual(answer, { sessions: [{ ...SESSION, workspace: "luke" }] });
});

test("a row whose own identity does not read is skipped, and the roster still answers", () => {
  const answer = observeAnswerSchema.parse({
    sessions: [SESSION, { providerId: "conductor" }, { ...SESSION, status: "pondering" }],
  });
  assert.deepEqual(answer, { sessions: [SESSION] });
});

test("the instant travels under its new name, whichever name the service wrote", () => {
  const renamed = observeAnswerSchema.parse({ sessions: [{ ...SESSION, lastActivityAt: 5 }] });
  assert.deepEqual(renamed, { sessions: [{ ...SESSION, lastActivityAt: 5 }] });

  // An installed service still writing only the old name is read, once, under
  // the new one; the old name never travels past this reader.
  const legacy = observeAnswerSchema.parse({ sessions: [{ ...SESSION, observedAt: 5 }] });
  assert.deepEqual(legacy, { sessions: [{ ...SESSION, lastActivityAt: 5 }] });

  const both = observeAnswerSchema.parse({
    sessions: [{ ...SESSION, lastActivityAt: 9, observedAt: 5 }],
  });
  assert.deepEqual(both, { sessions: [{ ...SESSION, lastActivityAt: 9 }] });
});
