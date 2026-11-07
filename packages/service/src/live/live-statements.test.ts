import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { ownFailedRunsLiveStatement } from "@repo/database/models/automation-store";
import { pullRequestChaptersLiveStatement } from "@repo/database/models/pull-request-chapters-store";
import { getTestDB, mutableFunctionsOf } from "@repo/database/testing";
import { LIVE_PARAM } from "@repo/features/live-read";
import { Effect, Option } from "effect";
import { agentFollowedBy, transcriptLiveStatements } from "../agents/coder-host/transcript-live.js";
import {
  accountInboxLiveStatements,
  memberAgentInboxLiveStatements,
  taskInboxLiveStatements,
} from "../inbox/inbox-store.js";
import { BOUND_READS } from "../sync/live-queries.js";

/**
 * Every statement the live endpoints answer calls only functions Postgres
 * marks immutable, so the same rows always read alike: a statement that read
 * the clock or the session would digest anew on every look, and a held read
 * would answer at once rather than hold.
 */

const USER_ID = "user-live-statements";

/** Every bound read's statements (`../live-read-binding.ts`), by its read and part, each param the reader or a fresh id. */
function boundStatements() {
  return Object.fromEntries(
    BOUND_READS.flatMap((query) => {
      const params = Object.fromEntries(
        Object.entries(query.declaration.params).map(([key, param]) => [
          key,
          param === LIVE_PARAM.USER ? USER_ID : randomUUID(),
        ]),
      );
      return Object.entries(Option.getOrThrow(query.statements(params))).map(
        ([part, statement]) => [`${query.name}.${part}`, statement],
      );
    }),
  );
}

/** Every live statement the endpoints answer, by the part it answers. */
function liveStatements() {
  const parent = randomUUID();
  const transcript = Option.getOrThrow(
    transcriptLiveStatements(
      { userId: USER_ID, conversationId: parent },
      parent,
      agentFollowedBy(USER_ID, parent, USER_ID),
    ),
  );
  const account = Option.getOrThrow(accountInboxLiveStatements(USER_ID, true));
  const task = Option.getOrThrow(taskInboxLiveStatements(USER_ID, randomUUID()));
  const agent = Option.getOrThrow(memberAgentInboxLiveStatements(USER_ID, randomUUID()));
  return {
    ...Object.fromEntries(
      Object.entries(account).map(([part, query]) => [`account.${part}`, query]),
    ),
    "account.failedRuns": Option.getOrThrow(ownFailedRunsLiveStatement(USER_ID)),
    "agent.pullRequestChapters": Option.getOrThrow(
      pullRequestChaptersLiveStatement(USER_ID, randomUUID(), 7),
    ),
    ...Object.fromEntries(
      Object.entries(transcript).map(([part, query]) => [`transcript.${part}`, query]),
    ),
    ...Object.fromEntries(Object.entries(task).map(([part, query]) => [`task.${part}`, query])),
    ...Object.fromEntries(Object.entries(agent).map(([part, query]) => [`agent.${part}`, query])),
    ...boundStatements(),
  };
}

it.layer(getTestDB())("the live statements", (it) => {
  it.effect(
    "every statement a live endpoint answers calls only immutable functions, so its rows digest alike on every look",
    () =>
      Effect.gen(function* () {
        const mutable = yield* Effect.forEach(
          Object.entries(liveStatements()),
          ([part, statement]) =>
            Effect.map(mutableFunctionsOf(statement), (called) => [part, called] as const),
        );
        assert.deepEqual(
          mutable.filter(([, called]) => called.length > 0),
          [],
        );
      }),
  );
});
