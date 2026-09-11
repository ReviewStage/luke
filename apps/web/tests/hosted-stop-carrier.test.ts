import assert from "node:assert/strict";
import { test } from "vitest";
import { EVE_CANCEL_OUTCOME } from "../server/hosted/brain-host/eve-sessions";
import { carryStop } from "../server/hosted/brain-host/stop-carrier";
import { STORE_WRITE_EFFECT } from "../server/hosted/store";

const NOW = 1_800_000_000_000;
const target = { userId: "user-1", conversationId: "conversation-1" };

/** A writer that records the stamps asked of it and a report that records what was said. */
function harness(outcome: Awaited<ReturnType<Parameters<typeof carryStop>[0]["eve"]["cancel"]>>) {
  const cancels: (readonly [string, string | undefined])[] = [];
  const stamps: (readonly [string, number])[] = [];
  const reports: string[] = [];
  const seams = {
    eve: {
      async cancel(sessionId: string, eveTurnId?: string) {
        cancels.push([sessionId, eveTurnId]);
        return outcome;
      },
    },
    writer: {
      async requestTurnCancel(_target: typeof target, cancel: { turnId: string; at: Date }) {
        stamps.push([cancel.turnId, cancel.at.getTime()]);
        return { ok: true as const, effect: STORE_WRITE_EFFECT.WRITTEN };
      },
    },
    now: () => NOW,
    report: (message: string) => {
      reports.push(message);
    },
  };
  return { seams, cancels, stamps, reports };
}

test("a cancel eve took, or found no active turn for, stamps the row; the cancel names eve's turn", async () => {
  for (const outcome of [
    { outcome: EVE_CANCEL_OUTCOME.ACCEPTED },
    { outcome: EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN },
  ] as const) {
    const h = harness(outcome);
    await carryStop(h.seams, target, "wrun_1", "turn_1", "host-turn-1");
    assert.deepEqual(h.cancels, [["wrun_1", "turn_1"]]);
    assert.deepEqual(h.stamps, [["host-turn-1", NOW]]);
    assert.deepEqual(h.reports, []);
  }
});

test("a cancel eve refused stamps nothing and is reported once, so the ask's own stamp stands for the route's Stop to carry", async () => {
  const h = harness({ outcome: EVE_CANCEL_OUTCOME.FAILED, status: 403 });
  await carryStop(h.seams, target, "wrun_1", "turn_1", "host-turn-1");
  assert.deepEqual(h.cancels, [["wrun_1", "turn_1"]]);
  assert.deepEqual(h.stamps, []);
  assert.equal(h.reports.length, 1);
});
