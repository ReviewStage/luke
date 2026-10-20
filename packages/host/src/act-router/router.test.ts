import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS, type Act } from "../acts.js";
import { createActRouter } from "./router.js";

/**
 * `app:act` as it stands once every act rides the window's act port: its
 * table holds no row, and an act of any kind, one the port answers among
 * them, is answered as unknown rather than carried.
 */

const PANEL = { sender: Symbol("window"), panel: true, voice: false, call: false };

it("app:act carries no kind any longer", () => {
  assert.deepEqual(Object.keys(ACT), []);
});

it.effect("an act the port answers is unknown to app:act, whatever it carries", () =>
  Effect.gen(function* () {
    const router = createActRouter({});
    const sent = [
      { kind: ACT_KIND.WINDOW_FOCUS_PANEL },
      { kind: ACT_KIND.WINDOW_COPY_TEXT, payload: { words: "copied" } },
      { kind: ACT_KIND.UPDATE_CHECK },
    ];
    for (const act of sent) {
      // SAFETY: a forged act, as a window that kept the old channel would send it; `Act` describes none.
      const outcome = yield* router.performAct(act as unknown as Act, PANEL);
      assert.deepEqual(outcome, { status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
    }
  }),
);
