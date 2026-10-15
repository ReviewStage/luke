import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { ACT_KIND, type Act, type ActKind, type ActOutcome } from "@luke/host/acts";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { type ActRouter, type ActRows, type ActSender, createActRouter } from "./act-router";

// SAFETY: the router reads the sender by identity alone; one inert object is one window.
const SENDER = {} as WebContents;

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };

const KINDS: readonly ActKind[] = Object.values(ACT_KIND);

/** The router answers an Effect; every test here runs it to the outcome it settles. */
function perform(router: ActRouter, act: Act, sender: ActSender): Effect.Effect<ActOutcome> {
  return router.performAct(act, sender);
}

/**
 * A table whose every row records that it ran and answers nothing, over which
 * each test replaces the one row it is about. Total by `ActRows`, so what is
 * exercised is the real dispatch rather than a hand-picked subset.
 */
function rowsRecording(ran: ActKind[], overrides: Partial<ActRows> = {}): ActRows {
  const rows = new Map<ActKind, () => undefined>();
  for (const kind of KINDS) {
    rows.set(kind, () => {
      ran.push(kind);
      return undefined;
    });
  }
  // SAFETY: KINDS enumerates every kind exactly once, so the table is total;
  // a row answering nothing is what every kind's own guard admits, because
  // the structured-clone shape a guard checks admits absence.
  const table = Object.fromEntries(rows) as unknown as ActRows;
  return { ...table, ...overrides };
}
it.effect("a row is handed the sender's standing, which no payload can claim", () =>
  Effect.gen(function* () {
    const seen: ActSender[] = [];
    const router = createActRouter(
      rowsRecording([], {
        [ACT_KIND.WINDOW_FOCUS_PANEL]: (_payload, sender) => {
          seen.push(sender);
        },
      }),
    );
    const voice: ActSender = { sender: SENDER, panel: false, voice: true, call: false };
    yield* perform(router, { kind: ACT_KIND.WINDOW_FOCUS_PANEL }, PANEL);
    yield* perform(router, { kind: ACT_KIND.WINDOW_FOCUS_PANEL }, voice);
    assert.deepEqual(seen, [PANEL, voice]);
  }),
);
