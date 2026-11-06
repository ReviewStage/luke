import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { TOPIC } from "@repo/database/sync/notification";
import { Duration, Effect, Option } from "effect";
import { Sync, type SyncShape } from "../sync/watch.js";
import { heldUntil } from "./held-read.js";

it.effect(
  "a held read answers when the write that woke the look that moved was heard, not an earlier wake that moved nothing",
  () =>
    Effect.gen(function* () {
      const heard = [Option.some(100), Option.some(900)];
      let wakes = 0;
      const hub: SyncShape = {
        watch: () =>
          Effect.succeed({
            next: Effect.sync(() => {
              wakes += 1;
              return [`tx-${wakes}`];
            }),
            heardAt: Effect.sync(() => heard[wakes - 1] ?? Option.none()),
          }),
      };
      const reads = [false, false, true];
      let looks = 0;

      const held = yield* heldUntil(
        Effect.sync(() => reads[looks++] ?? true),
        (moved) => moved,
        [[TOPIC.TASK, "a-task"]],
        Duration.seconds(1),
        Duration.hours(1),
      ).pipe(Effect.provideService(Sync, hub));

      assert.deepEqual(
        held,
        Option.some({ read: true, txids: ["tx-1", "tx-2"], heardAt: Option.some(900) }),
      );
    }),
);
