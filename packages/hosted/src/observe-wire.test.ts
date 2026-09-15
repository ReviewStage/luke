import assert from "node:assert/strict";
import { EXCESS_KEYS, type UnparsedWireValue } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { type Schema as EffectSchema, Result } from "effect";
import { test } from "vitest";
import { observeAnswerSchema } from "./observe-wire.js";

/** An answer read: a key a newer service added is dropped rather than refused. */
function parse<S extends EffectSchema.ConstraintDecoder<unknown>>(
  schema: S,
  value: UnparsedWireValue,
): S["Type"] | undefined {
  return Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(value));
}

const SESSION = {
  providerId: "conductor",
  sessionId: "session-1",
  title: "Fix the roster test",
  status: "working",
};

test("a row a field could not be read from keeps every field that could", () => {
  const answer = parse(observeAnswerSchema, {
    sessions: [{ ...SESSION, branch: 7, workspace: "luke", controls: "none" }],
  });
  assert.deepEqual(answer, { sessions: [{ ...SESSION, workspace: "luke" }] });
});

test("a row whose own identity does not read is skipped, and the roster still answers", () => {
  const answer = parse(observeAnswerSchema, {
    sessions: [SESSION, { providerId: "conductor" }, { ...SESSION, status: "pondering" }],
  });
  assert.deepEqual(answer, { sessions: [SESSION] });
});

test("the instant travels under its new name, whichever name the service wrote", () => {
  const renamed = parse(observeAnswerSchema, { sessions: [{ ...SESSION, lastActivityAt: 5 }] });
  assert.deepEqual(renamed, { sessions: [{ ...SESSION, lastActivityAt: 5 }] });

  // An installed service still writing only the old name is read, once, under
  // the new one; the old name never travels past this reader.
  const legacy = parse(observeAnswerSchema, { sessions: [{ ...SESSION, observedAt: 5 }] });
  assert.deepEqual(legacy, { sessions: [{ ...SESSION, lastActivityAt: 5 }] });

  const both = parse(observeAnswerSchema, {
    sessions: [{ ...SESSION, lastActivityAt: 9, observedAt: 5 }],
  });
  assert.deepEqual(both, { sessions: [{ ...SESSION, lastActivityAt: 9 }] });
});
