import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { SETTING_SIDE_EFFECT, SETTINGS_RESET_SCOPE } from "@luke/settings";
import { appSettingsWire, settingsView } from "@luke/settings/testing";
import type { AppSettings, SettingsUpdateResult } from "@luke/settings/wire";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { Effect, Fiber, Option } from "effect";
import { ACT_KIND, ACT_OUTCOME_STATUS } from "../acts.js";
import { type ActRows, type ActSender, createActRouter } from "./router.js";
import {
  type ClientSettingSideEffects,
  type SettingsActsDependencies,
  settingsActRows,
} from "./settings-acts.js";

// The platform's handle on the window that asked, which no row here reads.
const PANEL: ActSender = { sender: Symbol("window"), panel: true, voice: false, call: false };

/** The chord the talk key holds, which the stop key may not claim. */
const TALK_CHORD = "Control+Alt+P";

const NO_SIDE_EFFECTS: ClientSettingSideEffects = {
  [SETTING_SIDE_EFFECT.NONE]: () => {},
  [SETTING_SIDE_EFFECT.LOGIN_ITEM]: () => {},
  [SETTING_SIDE_EFFECT.VOICE]: () => {},
  [SETTING_SIDE_EFFECT.TALK_HOTKEY]: () => {},
  [SETTING_SIDE_EFFECT.STOP_HOTKEY]: () => {},
  [SETTING_SIDE_EFFECT.MEDIA_DUCK]: () => {},
};

/**
 * The settings rows over a host that holds one settings document and answers
 * every write accepted, with the client's side effects the test hands in.
 */
function settingsRouter(sideEffects: ClientSettingSideEffects = NO_SIDE_EFFECTS) {
  let held: AppSettings = appSettingsWire(settingsView());
  const accepted = (): SettingsUpdateResult => ({
    status: ACTION_RESULT_STATUS.ACCEPTED,
    settings: held,
  });
  const host: SettingsActsDependencies<unknown>["host"] = {
    settingsSnapshot: () => Effect.sync(() => Option.some(held)),
    updateSetting: (field, value) =>
      Effect.sync(() => {
        held = { ...held, stored: { ...held.stored, [field]: value } };
        return accepted();
      }),
    resetSettings: () => Effect.sync(accepted),
    setExperiment: () => Effect.sync(accepted),
  };
  const rows = settingsActRows({
    host,
    reporterOf: () => "panel",
    lastSettings: () => held,
    sideEffects,
    stopChordHolder: (chord) => (chord === TALK_CHORD ? "talk" : undefined),
  });
  // SAFETY: the router dispatches on the kind alone; the rows under test are the only ones reached.
  const router = createActRouter(rows as ActRows);
  return { router, stored: () => held.stored };
}

it.effect(
  "a stop-key chord the talk key holds is refused over the settings as they stand, and a free one is saved",
  () =>
    Effect.gen(function* () {
      const { router, stored } = settingsRouter();
      const before = stored().stopHotkey;
      const taken = yield* router.performAct(
        { kind: ACT_KIND.SETTING_UPDATE, payload: { field: "stopHotkey", value: TALK_CHORD } },
        PANEL,
      );
      assert.ok(taken.status === ACT_OUTCOME_STATUS.DONE);
      assert.equal(taken.value.status, ACTION_RESULT_STATUS.REJECTED);
      assert.equal(taken.value.reason, "That chord is reserved for the talk key.");
      assert.equal(stored().stopHotkey, before);

      const free = yield* router.performAct(
        { kind: ACT_KIND.SETTING_UPDATE, payload: { field: "stopHotkey", value: "Control+Alt+S" } },
        PANEL,
      );
      assert.ok(free.status === ACT_OUTCOME_STATUS.DONE);
      assert.equal(free.value.status, ACTION_RESULT_STATUS.ACCEPTED);
      assert.equal(stored().stopHotkey, "Control+Alt+S");
    }),
);

it.effect(
  "a reset answers only once the stop key's deferred reapply is back, which a single write does not wait for",
  () =>
    Effect.gen(function* () {
      const waited: boolean[] = [];
      let reapplied = () => {};
      const reapply = new Promise<void>((resolve) => {
        reapplied = resolve;
      });
      const { router } = settingsRouter({
        ...NO_SIDE_EFFECTS,
        [SETTING_SIDE_EFFECT.STOP_HOTKEY]: ({ waitForDeferredEffects }) => {
          waited.push(waitForDeferredEffects);
          return waitForDeferredEffects ? reapply : undefined;
        },
      });

      const write = yield* router.performAct(
        { kind: ACT_KIND.SETTING_UPDATE, payload: { field: "stopHotkey", value: "Control+Alt+S" } },
        PANEL,
      );
      assert.equal(write.status, ACT_OUTCOME_STATUS.DONE);

      const reset = yield* Effect.forkChild(
        router.performAct(
          { kind: ACT_KIND.SETTINGS_RESET, payload: { scope: SETTINGS_RESET_SCOPE.VOICE } },
          PANEL,
        ),
      );
      yield* Effect.yieldNow;
      assert.equal(reset.pollUnsafe(), undefined);

      reapplied();
      const answered = yield* Fiber.join(reset);
      assert.equal(answered.status, ACT_OUTCOME_STATUS.DONE);
      assert.deepEqual(waited, [false, true]);
    }),
);
