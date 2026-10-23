import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { skillAudits } from "./skill-audit.js";

/**
 * skills.sh's ratings as the preview asks for them, over an HTTP client
 * that answers as each test says: what it answers is read, and a skills.sh
 * that is slow, down, or answers something else is no ratings and never a
 * failure. Synthetic repositories and skills throughout.
 */

/** The ratings asked for over a skills.sh answering as given. */
const auditedBy = (answer: () => Response | Promise<Response>) => (names: readonly string[]) =>
  skillAudits("acme/kit", names).pipe(Effect.provide(fakeHttpClientLayer(answer)));

it.effect(
  "a skills.sh slower than three seconds is no ratings, and holds nothing up past them",
  () =>
    Effect.gen(function* () {
      const never = auditedBy(
        (): Promise<Response> =>
          new Promise(() => {
            // Note that skills.sh never answers.
          }),
      );
      const asked = yield* Effect.forkChild(never(["review"]));
      yield* TestClock.adjust("3 seconds");
      assert.deepEqual(yield* Fiber.join(asked), new Map());
    }),
);

it.effect("a skills.sh that refuses, or answers no ratings, is no ratings", () =>
  Effect.gen(function* () {
    const down = auditedBy(() => Response.json({ message: "down" }, { status: 503 }));
    assert.deepEqual(yield* down(["review"]), new Map());
    const garbled = auditedBy(() => new Response("<html>", { status: 200 }));
    assert.deepEqual(yield* garbled(["review"]), new Map());
    const listed = auditedBy(() => Response.json([{ review: { ath: { risk: "safe" } } }]));
    assert.deepEqual(yield* listed(["review"]), new Map());
  }),
);

it.effect("nothing to rate asks skills.sh nothing", () =>
  Effect.gen(function* () {
    const unasked = auditedBy(() => {
      throw new Error("skills.sh was asked");
    });
    assert.deepEqual(yield* unasked([]), new Map());
  }),
);
