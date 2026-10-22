import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import { makeEventSink } from "./events.js";
import { RUNNER_EVENTS_MAX_BYTES, type RunnerMessage } from "./protocol.js";
import { makeFakeLuke } from "./testing/fake-luke.js";

/**
 * The runner's events reach Luke whatever their size: a batch heavier than
 * one post is split into posts each under Luke's bound, in order, and an
 * event that alone would top it is posted with its longest words cut on a
 * line, saying how much was left out, so neither it nor any event after it
 * is lost. Synthetic words throughout.
 */

const URL = "https://luke.test/api/agents/runner-events";
const BEARER = Redacted.make("bearer-fixture");
const SECRET = "secret-fixture-value";

/** A tool's answer as the SDK posts one, its words as given. */
function answered(words: string): RunnerMessage {
  return {
    type: "user",
    message: { role: "user", content: [{ type: "text", text: words }] },
    parent_tool_use_id: null,
    session_id: "session-fixture",
  };
}

/** Lines of words, as a command's output reads, weighing about the bytes given. */
function linesOf(bytes: number, tag: string): string {
  return Array.from({ length: Math.ceil(bytes / 64) }, (_, at) =>
    `${tag} line ${at} ${"x".repeat(48)}`.slice(0, 63),
  ).join("\n");
}

const sinkOver = (luke: ReturnType<typeof makeFakeLuke>) =>
  makeEventSink({ url: URL, bearer: BEARER, firstSequence: 1, secrets: [] }).pipe(
    Effect.provide(luke.layer),
  );

it.effect(
  "a batch heavier than one post is posted in several, each under Luke's bound, every event once and in order",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const luke = makeFakeLuke({ url: URL, firstSequence: 1 });
        const sink = yield* sinkOver(luke);

        for (let at = 0; at < 6; at += 1) yield* sink.emit(answered(linesOf(1_000_000, `e${at}`)));
        yield* sink.drain;

        assert.ok(luke.bodies.length > 1);
        for (const body of luke.bodies) {
          assert.ok(Buffer.byteLength(body, "utf8") <= RUNNER_EVENTS_MAX_BYTES);
        }
        assert.deepEqual(
          luke.applied.map((event) => event.sequence),
          [1, 2, 3, 4, 5, 6],
        );
        assert.ok(!luke.bodies.some((body) => body.includes("characters left out")));
      }),
    ),
);

it.effect(
  "an event that alone would top a post is posted cut on a line, both its secret and what follows it intact",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const luke = makeFakeLuke({ url: URL, firstSequence: 1 });
        const sink = yield* makeEventSink({
          url: URL,
          bearer: BEARER,
          firstSequence: 1,
          secrets: [Redacted.make(SECRET)],
        }).pipe(Effect.provide(luke.layer));

        yield* sink.emit(answered(`${SECRET}\n${linesOf(6 * 1024 * 1024, "big")}`));
        yield* sink.emit(answered("next"));
        yield* sink.drain;

        assert.deepEqual(
          luke.applied.map((event) => event.sequence),
          [1, 2],
        );
        const [big, next] = luke.applied.map((event) => JSON.stringify(event.message));
        assert.match(big ?? "", /characters left out/);
        assert.ok((big ?? "").includes("[redacted]"));
        assert.ok(!luke.bodies.some((body) => body.includes(SECRET)));
        assert.ok((next ?? "").includes("next"));
        for (const body of luke.bodies) {
          assert.ok(Buffer.byteLength(body, "utf8") <= RUNNER_EVENTS_MAX_BYTES);
        }
      }),
    ),
);
