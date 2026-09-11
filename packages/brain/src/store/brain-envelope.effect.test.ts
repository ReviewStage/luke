import assert from "node:assert/strict";
import * as Client from "@effect/sql/SqlClient";
import { describe, it } from "@effect/vitest";
import {
  CONTEXT_INPUT_KIND,
  MAIN_SESSION_KEY,
  TRANSCRIPT_EVENT_KIND,
} from "@sidecar/runtime/vocabulary";
import { Effect } from "effect";
import {
  BRAIN_GENERATION_LIFETIME_MS,
  type BrainPersistedState,
  freshBrainState,
} from "../envelope.js";
import {
  loadBrainEnvelopeEffect,
  saveBrainEnvelopeEffect,
  standingGenerationEffect,
} from "./brain-envelope.js";
import { SAVE_KIND } from "./envelope.js";
import { NOW, overStore, populatedState } from "./testing.js";
import { listTranscriptEffect } from "./transcript-table.js";

const replace = (state: BrainPersistedState, expectGeneration?: string) =>
  saveBrainEnvelopeEffect(MAIN_SESSION_KEY, {
    kind: SAVE_KIND.REPLACE,
    ...(expectGeneration !== undefined ? { expectGeneration } : undefined),
    state,
  });

describe("the envelope and its generation over the client", () => {
  it.effect("round-trips a whole envelope through the tables it is spread across", () =>
    overStore(
      Effect.gen(function* () {
        const state = populatedState("gen-1");

        assert.equal(yield* replace(state), true);

        assert.deepEqual(yield* loadBrainEnvelopeEffect(MAIN_SESSION_KEY), {
          state,
          generation: "gen-1",
        });
        const standing = yield* standingGenerationEffect(MAIN_SESSION_KEY);
        assert.deepEqual(standing, {
          sessionId: "gen-1",
          checkpointFormat: state.checkpointFormat,
          createdAt: NOW,
          expiresAt: NOW + BRAIN_GENERATION_LIFETIME_MS,
          resetClearedAt: undefined,
          resetGenerationId: undefined,
          compactionCount: 0,
        });
      }),
    ),
  );

  it.effect("refuses a writer whose picture of the standing generation is stale", () =>
    overStore(
      Effect.gen(function* () {
        yield* replace(populatedState("gen-1"));
        yield* replace(freshBrainState("gen-2", NOW + 1), "gen-1");

        assert.equal(yield* replace(freshBrainState("gen-intruder", NOW + 2), "gen-1"), false);
        assert.equal(yield* replace(freshBrainState("gen-intruder", NOW + 2)), false);
        assert.equal(
          yield* saveBrainEnvelopeEffect(MAIN_SESSION_KEY, {
            kind: SAVE_KIND.AMEND,
            generationId: "gen-1",
            delta: { compactionCount: 9 },
          }),
          false,
        );

        const loaded = yield* loadBrainEnvelopeEffect(MAIN_SESSION_KEY);
        assert.equal(loaded.generation, "gen-2");
        assert.equal(loaded.state?.compactionCount, 0);
      }),
    ),
  );

  it.effect("carries nothing of a refused save into the tables, its transcript included", () =>
    overStore(
      Effect.gen(function* () {
        yield* replace(freshBrainState("gen-1", NOW));

        assert.equal(
          yield* saveBrainEnvelopeEffect(MAIN_SESSION_KEY, {
            kind: SAVE_KIND.AMEND,
            generationId: "gen-elsewhere",
            delta: {
              items: { keepPrefix: 0, append: [{ type: "message", role: "user", content: "no" }] },
            },
            transcript: [
              {
                kind: TRANSCRIPT_EVENT_KIND.CONTEXT_INPUT,
                recordedAt: NOW,
                input: { kind: CONTEXT_INPUT_KIND.USER_TEXT, text: "no" },
              },
            ],
          }),
          false,
        );

        assert.deepEqual(yield* listTranscriptEffect(MAIN_SESSION_KEY), []);
        assert.deepEqual((yield* loadBrainEnvelopeEffect(MAIN_SESSION_KEY)).state?.items, []);
      }),
    ),
  );

  it.effect("keeps the deadline the generation was stamped with across every amendment", () =>
    overStore(
      Effect.gen(function* () {
        yield* replace(freshBrainState("gen-1", NOW));

        assert.equal(
          yield* saveBrainEnvelopeEffect(MAIN_SESSION_KEY, {
            kind: SAVE_KIND.AMEND,
            generationId: "gen-1",
            delta: {
              compactionCount: 3,
              checkpointFormat: { stamp: "tool-loop@1:openai-responses-input/1" },
              items: { keepPrefix: 0, append: [{ type: "message", role: "user", content: "one" }] },
              cursors: { codex: { "session-a": "cursor-1" } },
            },
          }),
          true,
        );

        const standing = yield* standingGenerationEffect(MAIN_SESSION_KEY);
        assert.equal(standing?.createdAt, NOW);
        assert.equal(standing?.expiresAt, NOW + BRAIN_GENERATION_LIFETIME_MS);
        assert.equal(standing?.compactionCount, 3);
      }),
    ),
  );

  it.effect(
    "reads a generation stamped with any other span as nothing, its id still standing",
    () =>
      overStore(
        Effect.gen(function* () {
          const sql = yield* Client.SqlClient;
          yield* replace(freshBrainState("gen-1", NOW));
          yield* sql`UPDATE conversation_sessions SET expires_at = ${NOW + 5} WHERE session_id = 'gen-1'`;

          assert.deepEqual(yield* loadBrainEnvelopeEffect(MAIN_SESSION_KEY), {
            unreadable: true,
            generation: "gen-1",
          });
        }),
      ),
  );

  it.effect(
    "lets the store that observed an unreadable generation replace it, and no other writer",
    () =>
      overStore(
        Effect.gen(function* () {
          const sql = yield* Client.SqlClient;
          yield* replace(populatedState("gen-1"));
          yield* sql`UPDATE runtime_checkpoints SET item = '{not json' WHERE sequence = 1`;

          const loaded = yield* loadBrainEnvelopeEffect(MAIN_SESSION_KEY);
          assert.deepEqual(loaded, { unreadable: true, generation: "gen-1" });

          assert.equal(yield* replace(freshBrainState("gen-intruder", NOW + 1)), false);
          assert.equal(
            yield* replace(freshBrainState("gen-repaired", NOW + 1), loaded.generation),
            true,
          );
          assert.equal(
            (yield* loadBrainEnvelopeEffect(MAIN_SESSION_KEY)).state?.generationId,
            "gen-repaired",
          );
        }),
      ),
  );

  it.effect("answers no generation at all for a conversation that has never held one", () =>
    overStore(
      Effect.gen(function* () {
        assert.deepEqual(yield* loadBrainEnvelopeEffect(MAIN_SESSION_KEY), {});
        assert.equal(yield* standingGenerationEffect(MAIN_SESSION_KEY), undefined);
      }),
    ),
  );
});
