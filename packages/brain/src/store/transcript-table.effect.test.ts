import assert from "node:assert/strict";
import * as Client from "@effect/sql/SqlClient";
import { describe, it } from "@effect/vitest";
import {
  COMPACTION_SOURCE,
  CONTEXT_INPUT_KIND,
  MAIN_SESSION_KEY,
  sessionKey,
  TRANSCRIPT_EVENT_KIND,
  type TranscriptEvent,
} from "@sidecar/runtime/vocabulary";
import { Cause, Effect, Exit } from "effect";
import { NOW, overStore } from "./testing.js";
import {
  appendTranscriptEffect,
  listCompactionBoundariesEffect,
  listTranscriptEffect,
  searchTranscriptEffect,
} from "./transcript-table.js";

const GENERATION = "gen-1";
const CHECKPOINT_FORMAT = "tool-loop@1:openai-responses-input/1";

function userText(text: string, recordedAt = NOW): TranscriptEvent {
  return {
    kind: TRANSCRIPT_EVENT_KIND.CONTEXT_INPUT,
    recordedAt,
    input: { kind: CONTEXT_INPUT_KIND.USER_TEXT, text },
  };
}

const FOLD: TranscriptEvent = {
  kind: TRANSCRIPT_EVENT_KIND.COMPACTION,
  recordedAt: NOW + 2,
  boundary: {
    source: COMPACTION_SOURCE.LOCAL_SUMMARY,
    dropped: 2,
    checkpointFormat: CHECKPOINT_FORMAT,
  },
};

describe("the retained transcript over the client", () => {
  it.effect("round-trips appended events in the order they were written", () =>
    overStore(
      Effect.gen(function* () {
        const appended = yield* appendTranscriptEffect(MAIN_SESSION_KEY, GENERATION, [
          userText("first", NOW),
          userText("second", NOW + 1),
        ]);

        const listed = yield* listTranscriptEffect(MAIN_SESSION_KEY);

        assert.equal(appended, 2);
        assert.deepEqual(
          listed.map((stored) => stored.sequence),
          [1, 2],
        );
        assert.deepEqual(
          listed.map((stored) => stored.sessionId),
          [GENERATION, GENERATION],
        );
        assert.deepEqual(
          listed.map((stored) => stored.event),
          [userText("first", NOW), userText("second", NOW + 1)],
        );
        assert.equal((yield* searchTranscriptEffect(MAIN_SESSION_KEY, "second")).length, 1);
      }),
    ),
  );

  it.effect("records a fold's boundary beside the event that carried it", () =>
    overStore(
      Effect.gen(function* () {
        yield* appendTranscriptEffect(MAIN_SESSION_KEY, GENERATION, [userText("first"), FOLD]);

        const boundaries = yield* listCompactionBoundariesEffect(MAIN_SESSION_KEY);

        assert.deepEqual(boundaries, [
          {
            transcriptSequence: 2,
            sessionId: GENERATION,
            source: COMPACTION_SOURCE.LOCAL_SUMMARY,
            dropped: 2,
            checkpointFormat: CHECKPOINT_FORMAT,
            createdAt: FOLD.recordedAt,
          },
        ]);
      }),
    ),
  );

  it.effect("appends nothing, and takes no sequence, for no events at all", () =>
    overStore(
      Effect.gen(function* () {
        assert.equal(yield* appendTranscriptEffect(MAIN_SESSION_KEY, GENERATION, []), 0);

        yield* appendTranscriptEffect(MAIN_SESSION_KEY, GENERATION, [userText("first")]);

        assert.deepEqual(
          (yield* listTranscriptEffect(MAIN_SESSION_KEY)).map((stored) => stored.sequence),
          [1],
        );
      }),
    ),
  );

  it.effect("refuses an append at a key no conversation stands at, leaving nothing written", () =>
    overStore(
      Effect.gen(function* () {
        const absent = sessionKey("agent:main:thread:nothing-here");

        const exit = yield* Effect.exit(
          appendTranscriptEffect(absent, GENERATION, [userText("first")]),
        );

        assert.ok(Exit.isFailure(exit));
        assert.ok(Exit.isFailure(exit) && Cause.isDie(exit.cause));
        assert.deepEqual(yield* listTranscriptEffect(absent), []);
      }),
    ),
  );

  it.effect("drops a row whose payload this build cannot vouch for, and keeps the rest", () =>
    overStore(
      Effect.gen(function* () {
        const sql = yield* Client.SqlClient;
        yield* appendTranscriptEffect(MAIN_SESSION_KEY, GENERATION, [userText("readable")]);
        yield* sql`INSERT INTO transcript_events
                     (session_key, sequence, session_id, kind, recorded_at, payload)
                   VALUES (${MAIN_SESSION_KEY}, ${99}, ${GENERATION},
                           ${TRANSCRIPT_EVENT_KIND.CONTEXT_INPUT}, ${NOW}, ${"{not json"})`;

        const listed = yield* listTranscriptEffect(MAIN_SESSION_KEY);

        assert.deepEqual(
          listed.map((stored) => stored.sequence),
          [1],
        );
      }),
    ),
  );
});
