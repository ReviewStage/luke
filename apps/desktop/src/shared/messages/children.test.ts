import assert from "node:assert/strict";
import { CHILD_STATUS } from "@sidecar/hosted/reads-wire";
import { CONVERSATION_VIEW_SOURCE } from "@sidecar/session";
import { EXCESS_KEYS } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Result } from "effect";
import { test } from "vitest";
import { childrenSnapshotSchema, isChildTranscriptSnapshot } from "./children";

const CHILD = {
  id: "5e000000-0000-4000-8000-000000000001",
  parentConversationId: "3c000000-0000-4000-8000-000000000001",
  parentKind: CONVERSATION_VIEW_SOURCE.MAIN,
  task: "Add a test for the retry.",
  status: CHILD_STATUS.SETTLED,
  acceptedAt: 1_757_505_600_000,
  settledAt: 1_757_505_660_000,
};

test("a children snapshot reads under the wire's own child schema, and a child the wire would refuse refuses the snapshot", () => {
  const read = readEither(childrenSnapshotSchema, { excess: EXCESS_KEYS.DROP });
  assert.deepEqual(Result.getOrUndefined(read({ settled: true, children: [CHILD] })), {
    settled: true,
    children: [CHILD],
  });
  assert.equal(
    Result.isFailure(read({ settled: true, children: [{ ...CHILD, status: "sideways" }] })),
    true,
  );
  assert.equal(Result.isFailure(read({ children: [] })), true);
});

test("a transcript is the child, its groups, and whether a read landed; an empty record is none", () => {
  assert.equal(isChildTranscriptSnapshot({ childId: CHILD.id, groups: [], settled: false }), true);
  assert.equal(isChildTranscriptSnapshot({}), false);
  assert.equal(isChildTranscriptSnapshot({ childId: CHILD.id, settled: true }), false);
});
