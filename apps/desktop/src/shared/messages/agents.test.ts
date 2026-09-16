import assert from "node:assert/strict";
import { CHILD_STATUS } from "@sidecar/hosted/reads-wire";
import { CONVERSATION_VIEW_SOURCE } from "@sidecar/session";
import { EXCESS_KEYS, TRANSCRIPT_KIND } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Result } from "effect";
import { test } from "vitest";
import { agentsSnapshotSchema, childrenSnapshotSchema, transcriptSnapshotSchema } from "./agents";

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

const AGENT = {
  id: "6f000000-0000-4000-8000-000000000001",
  providerId: "conductor",
  providerSessionId: "session-a",
  status: CHILD_STATUS.RUNNING,
  acceptedAt: 1_757_505_600_000,
  queuedAt: 1_757_505_650_000,
  startedAt: 1_757_505_660_000,
};

test("an agents snapshot reads under the wire's own agent schema, and an agent the wire would refuse refuses the snapshot", () => {
  const read = readEither(agentsSnapshotSchema, { excess: EXCESS_KEYS.DROP });
  assert.deepEqual(Result.getOrUndefined(read({ settled: true, agents: [AGENT] })), {
    settled: true,
    agents: [AGENT],
  });
  assert.equal(
    Result.isFailure(read({ settled: true, agents: [{ ...AGENT, providerSessionId: "" }] })),
    true,
  );
  assert.equal(Result.isFailure(read({ agents: [] })), true);
});

test("a transcript is the conversation and its kind, whether a read landed, its groups as records, and the row it could not read", () => {
  const read = readEither(transcriptSnapshotSchema, { excess: EXCESS_KEYS.DROP });
  const child = { conversationId: CHILD.id, kind: TRANSCRIPT_KIND.CHILD };
  assert.ok(Result.isSuccess(read({ ...child, groups: [], settled: false })));
  assert.ok(
    Result.isSuccess(
      read({
        conversationId: AGENT.id,
        kind: TRANSCRIPT_KIND.OBSERVED,
        groups: [{ turnId: "t", messages: [] }],
        settled: true,
        unreadable: { conversationId: AGENT.id, seq: 3 },
      }),
    ),
  );
  assert.equal(Result.isFailure(read({})), true);
  assert.equal(Result.isFailure(read({ ...child, settled: true })), true);
  assert.equal(Result.isFailure(read({ ...child, groups: ["row"], settled: true })), true);
  assert.equal(
    Result.isFailure(read({ conversationId: CHILD.id, kind: "main", groups: [], settled: true })),
    true,
  );
});
