import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { MAIN_SESSION_KEY, RUN_ORIGIN } from "@sidecar/runtime/vocabulary";
import type { SessionIdentity } from "@sidecar/session";
import { ACTION_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { Effect } from "effect";
import { BRAIN_TOOL } from "./names.js";
import { READ_TOOLS, type ReadToolContext, type ReadToolModule } from "./read-tools.js";
import { REFUSAL_REASON } from "./refusals.js";

const ABC: SessionIdentity = { providerId: "claude-code", providerSessionId: "abc" };

function readToolNamed(name: string): ReadToolModule | undefined {
  return READ_TOOLS.find((tool) => tool.name === name);
}

/** A turn's standing over a roster of one session, whose transcript reads are recorded. */
function context() {
  const reads: SessionIdentity[] = [];
  const ctx: ReadToolContext = {
    conversationId: MAIN_SESSION_KEY,
    turnId: "run-1",
    runId: "run-1",
    origin: RUN_ORIGIN.OBSERVATION,
    isRevoked: () => false,
    signal: new AbortController().signal,
    roster: { text: "Currently observed sessions:\n- abc", identities: [ABC] },
    readTranscript: (identity) =>
      Effect.sync(() => {
        reads.push(identity);
        return { status: ACTION_RESULT_STATUS.ACCEPTED, transcript: "whole" };
      }),
  };
  return { ctx, reads };
}

it.effect(
  "list_sessions answers the roster as the host renders it now, and reads nothing else",
  () =>
    Effect.gen(function* () {
      const { ctx, reads } = context();
      const tool = readToolNamed(BRAIN_TOOL.LIST_SESSIONS);
      assert.ok(tool);
      assert.deepEqual(yield* tool.execute({}, ctx), { roster: ctx.roster.text });
      assert.deepEqual(reads, []);
    }),
);

it.effect(
  "read_transcript reads only a session the roster holds, and refuses every other identity before the host is asked",
  () =>
    Effect.gen(function* () {
      const { ctx, reads } = context();
      const tool = readToolNamed(BRAIN_TOOL.READ_TRANSCRIPT);
      assert.ok(tool);
      const read = yield* tool.execute(
        { provider_id: ABC.providerId, provider_session_id: ABC.providerSessionId },
        ctx,
      );
      assert.equal(read.status, ACTION_RESULT_STATUS.ACCEPTED);
      assert.deepEqual(reads, [ABC]);
      const refused: WireRecord[] = [
        { provider_id: ABC.providerId, provider_session_id: "ghost" },
        { provider_id: ABC.providerId },
        {},
        { provider_id: 7, provider_session_id: "abc" },
      ];
      for (const input of refused) {
        const answer: WireRecord = yield* tool.execute(input, ctx);
        assert.equal(answer.status, ACTION_RESULT_STATUS.REJECTED);
        assert.equal(answer.reason, REFUSAL_REASON.UNOBSERVED_SESSION);
      }
      assert.equal(reads.length, 1);
    }),
);
