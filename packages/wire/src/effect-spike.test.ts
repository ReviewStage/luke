import assert from "node:assert/strict";
import { Context, Effect, Layer, Result, Schema } from "effect";
import { test } from "vitest";

const SESSION_STATE = {
  WORKING: "working",
  WAITING: "waiting",
} as const;

const SessionRow = Schema.Struct({
  id: Schema.String,
  state: Schema.Literals([SESSION_STATE.WORKING, SESSION_STATE.WAITING]),
  turns: Schema.Int,
  branch: Schema.optionalKey(Schema.String),
});

const readSessionRow = Schema.decodeUnknownResult(SessionRow);

test("Schema.Struct decodes a well-formed record to the declared shape", () => {
  const decoded = readSessionRow({ id: "session-1", state: "working", turns: 3 });

  assert.deepEqual(Result.getOrThrow(decoded), {
    id: "session-1",
    state: SESSION_STATE.WORKING,
    turns: 3,
  });
});

test("Schema.Struct refuses a record whose field misses its refinement", () => {
  const refused = readSessionRow({ id: "session-1", state: "working", turns: 2.5 });

  assert.equal(Result.isFailure(refused), true);
});

test("Schema.Struct refuses a literal outside the declared set", () => {
  const refused = readSessionRow({ id: "session-1", state: "settled", turns: 1 });

  assert.equal(Result.isFailure(refused), true);
});

class Clock extends Context.Service<Clock, { readonly now: () => number }>()(
  "@sidecar/wire/effect-spike/Clock",
) {}

class Roster extends Context.Service<
  Roster,
  { readonly stamp: (id: string) => Effect.Effect<{ readonly id: string; readonly at: number }> }
>()("@sidecar/wire/effect-spike/Roster") {}

const FIXED_INSTANT = 1_700_000_000_000;

const clockLayer = Layer.succeed(Clock, { now: () => FIXED_INSTANT });

const rosterLayer = Layer.effect(
  Roster,
  Effect.gen(function* () {
    const clock = yield* Clock;
    return {
      stamp: (id: string) => Effect.succeed({ id, at: clock.now() }),
    };
  }),
);

const stampBoth = Effect.gen(function* () {
  const roster = yield* Roster;
  const first = yield* roster.stamp("session-1");
  const second = yield* roster.stamp("session-2");
  return [first, second];
});

test("Layer resolves a Context.Service through the layer it depends on", () => {
  const stamped = Effect.runSync(Effect.provide(stampBoth, Layer.provide(rosterLayer, clockLayer)));

  assert.deepEqual(stamped, [
    { id: "session-1", at: FIXED_INSTANT },
    { id: "session-2", at: FIXED_INSTANT },
  ]);
});

test("Effect.gen carries a typed failure to the caller as an Either", async () => {
  class Refused extends Schema.TaggedError<Refused>()("Refused", {
    id: Schema.String,
  }) {}

  const refuse = (id: string) =>
    Effect.gen(function* () {
      if (id.length === 0) {
        return yield* new Refused({ id });
      }
      return id;
    });

  const [accepted, refused] = await Effect.runPromise(
    Effect.all([Effect.result(refuse("session-1")), Effect.result(refuse(""))]),
  );

  assert.deepEqual(accepted, Result.succeed("session-1"));
  assert.equal(Result.isFailure(refused), true);
  assert.equal(Result.isFailure(refused) ? refused.failure._tag : null, "Refused");
});

test("two tags with different identifiers are different services", () => {
  assert.notEqual(Clock.key, Roster.key);
  assert.equal(Clock.key, "@sidecar/wire/effect-spike/Clock");
});
