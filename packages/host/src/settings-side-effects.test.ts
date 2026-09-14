import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  SETTING_SIDE_EFFECT,
  type SettingSideEffectId,
  type StoredAppSettings,
} from "@sidecar/settings";
import { Effect } from "effect";
import {
  hostSettingSideEffects,
  SETTING_WRITE_ORIGIN,
  type SettingWriteOrigin,
} from "./settings-side-effects.js";

// SAFETY: the write's snapshot is handed through and never read by the effects
// this test runs, which re-read the store through the links instead; an empty
// record stands in for it exactly as far as those effects look.
const SETTINGS = {} as StoredAppSettings;

/** Every effect read at the width the write path calls it, whatever each one's own signature declares it ignores. */
type SideEffects = Readonly<
  Record<
    SettingSideEffectId,
    (context: { settings: StoredAppSettings; origin: SettingWriteOrigin }) => Effect.Effect<void>
  >
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
        previewVoice: step("previewVoice"),
        refreshAnnouncementHold: step("refreshAnnouncementHold"),
        reportPresence: step("reportPresence"),
      });

      yield* effects[SETTING_SIDE_EFFECT.ANNOUNCEMENT_HOLD]({
        settings: SETTINGS,
        origin: SETTING_WRITE_ORIGIN.CHOSEN,
      });
      assert.deepEqual(ran, ["refreshAnnouncementHold", "reportPresence"]);

      ran.length = 0;
      yield* effects[SETTING_SIDE_EFFECT.NONE]({
        settings: SETTINGS,
        origin: SETTING_WRITE_ORIGIN.CHOSEN,
      });
      yield* effects[SETTING_SIDE_EFFECT.DOCK]({
        settings: SETTINGS,
        origin: SETTING_WRITE_ORIGIN.CHOSEN,
      });
      assert.deepEqual(ran, [], "an effect the client owns sends no heartbeat");
    }),
);

it.effect(
  "the voice a developer chose here is stored on the source and then auditioned, in that order, while a reset or a preference arriving from another device is stored and not spoken",
  () =>
    Effect.gen(function* () {
      const ran: string[] = [];
      const step = (name: string): Effect.Effect<void> =>
        Effect.sync(() => {
          ran.push(name);
        });
      const effects: SideEffects = hostSettingSideEffects({
        setVoice: () => step("setVoice"),
        previewVoice: step("previewVoice"),
        refreshAnnouncementHold: step("refreshAnnouncementHold"),
        reportPresence: step("reportPresence"),
      });

      yield* effects[SETTING_SIDE_EFFECT.VOICE]({
        settings: SETTINGS,
        origin: SETTING_WRITE_ORIGIN.CHOSEN,
      });
      // The source holds the voice before the audition asks for a session,
      // because the audition is heard in a session created under it.
      assert.deepEqual(ran, ["setVoice", "previewVoice"]);

      for (const origin of [SETTING_WRITE_ORIGIN.SYNCED, SETTING_WRITE_ORIGIN.RESET]) {
        ran.length = 0;
        yield* effects[SETTING_SIDE_EFFECT.VOICE]({ settings: SETTINGS, origin });
        assert.deepEqual(ran, ["setVoice"], `a ${origin} write speaks nothing`);
      }
    }),
);
