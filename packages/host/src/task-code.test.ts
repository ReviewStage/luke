import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import { taskCodeColouring } from "./task-code.js";

const LINE = "const answer = 42;";

it.effect(
  "after a highlighter that could not be loaded, code is drawn plain without loading again for a minute, and coloured once a later load succeeds",
  () =>
    Effect.gen(function* () {
      // A chunk that fails to download once, then arrives, as a flaky network serves it.
      let downloads = 0;
      const { highlightSnippet: colour } = taskCodeColouring(
        Effect.suspend(() => {
          downloads += 1;
          return downloads === 1
            ? Effect.fail(new Error("the chunk did not download"))
            : Effect.map(
                Effect.promise(() => import("./task-code-highlighter.js")),
                (module) => module.createTaskCodeHighlighter(),
              );
        }),
      );
      const plain = [[{ text: LINE }]];

      assert.deepEqual(yield* colour("ts", LINE), plain);
      yield* TestClock.adjust(Duration.seconds(59));
      assert.deepEqual(yield* colour("ts", LINE), plain);
      yield* TestClock.adjust(Duration.seconds(1));
      const coloured = (yield* colour("ts", LINE))[0] ?? [];

      assert.ok(
        coloured.length > 1,
        "a TypeScript block is coloured in runs once the load succeeds",
      );
    }),
);
