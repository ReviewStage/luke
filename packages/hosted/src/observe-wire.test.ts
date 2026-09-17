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

test("an observe answer drops a published-work address that is not HTTPS", () => {
  const answer = parse(observeAnswerSchema, {
    sessions: [
      {
        providerId: "conductor",
        sessionId: "sess-change",
        title: "Published work",
        status: "complete",
        change: "javascript:alert(1)",
      },
    ],
  });

  assert.equal(answer?.sessions[0]?.change, undefined);
});

test("an observe answer drops a session address outside the openable schemes", () => {
  const answer = parse(observeAnswerSchema, {
    sessions: [
      {
        providerId: "conductor",
        sessionId: "sess-link",
        title: "Deep-linked chat",
        status: "working",
        link: "javascript:alert(1)",
      },
    ],
  });

  assert.equal(answer?.sessions[0]?.link, undefined);
});

test("an observe answer skips malformed session entries rather than failing", () => {
  const raw = {
    sessions: [
      { providerId: "conductor", sessionId: "good", title: "OK", status: "complete" },
      { providerId: "conductor" }, // missing required fields
      null,
    ],
  };
  const answer = parse(observeAnswerSchema, JSON.parse(JSON.stringify(raw)));
  assert.ok(answer);
  // Only the well-formed entry survives.
  assert.equal(answer.sessions.length, 1);
  assert.equal(answer.sessions[0]?.sessionId, "good");
});

test("an observe answer rejects an unknown status value", () => {
  const raw = {
    sessions: [
      {
        providerId: "conductor",
        sessionId: "sess-2",
        title: "Conductor chat",
        status: "running", // not a known SessionStatus
      },
    ],
  };
  const answer = parse(observeAnswerSchema, JSON.parse(JSON.stringify(raw)));
  // The malformed entry is skipped; the answer still exists with zero sessions.
  assert.ok(answer);
  assert.equal(answer.sessions.length, 0);
});

test("an observe answer carries the action advertisements and bounds them", () => {
  const raw = {
    sessions: [
      {
        providerId: "conductor",
        sessionId: "sess-3",
        title: "Conductor chat",
        status: "waiting",
        canReceiveMessage: true,
        controls: [
          { id: "approve-plan", label: "Approve the plan" },
          { id: "cancel-turn", label: "Stop", kind: "stop" },
          { id: "", label: "nameless" }, // malformed: skipped
          { id: "no-label" }, // malformed: skipped
        ],
        spawnableAgents: ["claude", "codex", ""],
        canRename: true,
        canRenameWorkspace: "yes", // not a boolean: dropped
      },
    ],
  };
  const answer = parse(observeAnswerSchema, JSON.parse(JSON.stringify(raw)));
  assert.ok(answer);
  const session = answer.sessions[0];
  assert.ok(session);
  assert.equal(session.canReceiveMessage, true);
  assert.deepEqual(session.controls, [
    { id: "approve-plan", label: "Approve the plan" },
    { id: "cancel-turn", label: "Stop", kind: "stop" },
  ]);
  assert.deepEqual(session.spawnableAgents, ["claude", "codex"]);
  assert.equal(session.canRename, true);
  assert.equal(session.canRenameWorkspace, undefined);
});

test("an observe answer returns undefined for a non-object", () => {
  assert.equal(parse(observeAnswerSchema, "not an object"), undefined);
  assert.equal(parse(observeAnswerSchema, null), undefined);
  assert.equal(parse(observeAnswerSchema, 42), undefined);
});

test("an observe answer returns undefined when sessions is not an array", () => {
  assert.equal(
    parse(observeAnswerSchema, JSON.parse(JSON.stringify({ sessions: "wrong" }))),
    undefined,
  );
  assert.equal(parse(observeAnswerSchema, JSON.parse(JSON.stringify({}))), undefined);
});
