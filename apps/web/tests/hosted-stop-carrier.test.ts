import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Result } from "effect";
import { EVE_CANCEL_OUTCOME } from "../server/hosted/brain-host/eve-sessions";
import { carryStop, type StopCarrierSeams } from "../server/hosted/brain-host/stop-carrier";
import { STORE_WRITE_EFFECT } from "../server/hosted/store";
import { noDatabase } from "./support/no-database";

const NOW = 1_800_000_000_000;
const target = { userId: "user-1", conversationId: "conversation-1" };

/** A writer that records the stamps asked of it and a report that records what was said; no stamp reaches a connection, so the suite opens no database. */
function harness(outcome: Effect.Success<ReturnType<StopCarrierSeams["eve"]["cancel"]>>) {
  const cancels: (readonly [string, string | undefined])[] = [];
  const stamps: (readonly [string, number])[] = [];
  const reports: string[] = [];
  const seams: StopCarrierSeams = {
    eve: {
      cancel: (sessionId, eveTurnId) =>
        Effect.sync(() => {
          cancels.push([sessionId, eveTurnId]);
          return outcome;
        }),
    },
    writer: {
      requestTurnCancel: (_target, cancel) =>
        Effect.sync(() => {
          stamps.push([cancel.turnId, cancel.at.getTime()]);
          return Result.succeed(STORE_WRITE_EFFECT.WRITTEN);
        }),
    },
    now: () => NOW,
    report: (message) => {
      reports.push(message);
    },
  };
  return { seams, cancels, stamps, reports };
}

it.layer(noDatabase)("the Stop an ask took, carried at the start of its turn", (it) => {
  it.effect(
    "a cancel eve took, or found no active turn for, stamps the row; the cancel names eve's turn",
    () =>
      Effect.gen(function* () {
        for (const outcome of [
          { outcome: EVE_CANCEL_OUTCOME.ACCEPTED },
          { outcome: EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN },
        ] as const) {
          const h = harness(outcome);
          yield* carryStop(h.seams, target, "wrun_1", "turn_1", "host-turn-1");
          assert.deepEqual(h.cancels, [["wrun_1", "turn_1"]]);
          assert.deepEqual(h.stamps, [["host-turn-1", NOW]]);
          assert.deepEqual(h.reports, []);
        }
      }),
  );

  it.effect(
    "a cancel eve refused stamps nothing and is reported once, so the ask's own stamp stands for the route's Stop to carry",
    () =>
      Effect.gen(function* () {
        const h = harness({ outcome: EVE_CANCEL_OUTCOME.FAILED, status: 403 });
        yield* carryStop(h.seams, target, "wrun_1", "turn_1", "host-turn-1");
        assert.deepEqual(h.cancels, [["wrun_1", "turn_1"]]);
        assert.deepEqual(h.stamps, []);
        assert.equal(h.reports.length, 1);
      }),
  );
});
