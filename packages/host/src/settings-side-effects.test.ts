import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  SETTING_SIDE_EFFECT,
  type SettingSideEffectId,
  type StoredAppSettings,
} from "@sidecar/settings";
import { Effect } from "effect";
import { hostSettingSideEffects } from "./settings-side-effects.js";

// SAFETY: the write's snapshot is handed through and never read by the effects
// this test runs, which re-read the store through the links instead; an empty
// record stands in for it exactly as far as those effects look.
const SETTINGS = {} as StoredAppSettings;

/** Every effect read at the width the write path calls it, whatever each one's own signature declares it ignores. */
type SideEffects = Readonly<
  Record<SettingSideEffectId, (context: { settings: StoredAppSettings }) => Effect.Effect<void>>
>;

it.effect(
  "the announcement hold's side effect re-reads the hold for the panel and then sends the heartbeat, so a pause released reaches the service at once",
  () =>
    Effect.gen(function* () {
      const ran: string[] = [];
      const step = (name: string): Effect.Effect<void> =>
        Effect.sync(() => {
          ran.push(name);
        });
      const effects: SideEffects = hostSettingSideEffects({
        setVoice: () => step("setVoice"),
        applyVoiceCredential: step("applyVoiceCredential"),
        refreshAnnouncementHold: step("refreshAnnouncementHold"),
        reportPresence: step("reportPresence"),
        emitSettings: () => step("emitSettings"),
      });

      yield* effects[SETTING_SIDE_EFFECT.ANNOUNCEMENT_HOLD]({ settings: SETTINGS });
      assert.deepEqual(ran, ["refreshAnnouncementHold", "reportPresence"]);

      ran.length = 0;
      yield* effects[SETTING_SIDE_EFFECT.NONE]({ settings: SETTINGS });
      yield* effects[SETTING_SIDE_EFFECT.DOCK]({ settings: SETTINGS });
      assert.deepEqual(ran, [], "an effect the client owns sends no heartbeat");
    }),
);
