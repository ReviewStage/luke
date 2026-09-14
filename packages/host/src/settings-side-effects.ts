import {
  SETTING_SIDE_EFFECT,
  type SettingSideEffectId,
  type StoredAppSettings,
} from "@sidecar/settings";
import { Effect } from "effect";

/**
 * Where a write came from, which two settings read and the rest ignore. The
 * same field reaches this table from three hands — the developer's own write
 * in this app, a reset, and the account's preferences arriving from another
 * device — and an effect that speaks must know which, or a voice chosen on a
 * phone would have this Mac talk at the launch that synced it.
 */
export const SETTING_WRITE_ORIGIN = {
  /** The developer changed this setting here, just now. */
  CHOSEN: "chosen",
  /** A reset restored this setting's default along with its scope's others. */
  RESET: "reset",
  /** The account's stored preferences arrived and this setting differed. */
  SYNCED: "synced",
} as const;

export type SettingWriteOrigin = (typeof SETTING_WRITE_ORIGIN)[keyof typeof SETTING_WRITE_ORIGIN];

/** What one host-side effect is handed: the snapshot the write just stored, and whose write it was. */
interface HostSettingSideEffectContext {
  readonly settings: StoredAppSettings;
  readonly origin: SettingWriteOrigin;
}

type HostSettingSideEffect = (context: HostSettingSideEffectContext) => Effect.Effect<void>;

/**
 * Every side effect a setting can have, over the whole of the id set. Total on
 * purpose: a new effect does not build until this table and the client's both
 * say what it does, where the `switch` this replaces ended in a `default` that
 * silently did nothing.
 */
type HostSettingSideEffects = Readonly<Record<SettingSideEffectId, HostSettingSideEffect>>;

/** An effect this side has nothing to do about, whichever side owns it. */
const noHostSettingSideEffect: HostSettingSideEffect = () => Effect.void;

/** What the host's own side effects reach in the concerns around them. */
export interface HostSettingSideEffectDependencies {
  setVoice: (voice: StoredAppSettings["voice"]) => Effect.Effect<void>;
  /**
   * The voice just chosen, auditioned so the developer hears it: a session of
   * its own under the stored voice, saying the build's one line. Only a
   * choice made here auditions — a reset moves a scope's worth of settings at
   * once, and a preference syncing from another device is news rather than a
   * request to be spoken to.
   */
  readonly previewVoice: Effect.Effect<void>;
  /** The hold read again for the panel, which draws it; nothing on this side queues speech to hold since E5-3. */
  readonly refreshAnnouncementHold: Effect.Effect<void>;
  /** The device heartbeat sent now, carrying the quiet instant as it stands after the write. */
  readonly reportPresence: Effect.Effect<void>;
}

/**
 * The side effects a setting has in the host. The client applies its own — the
 * login item, the Dock, the displays, the form factor, the keys, the duck —
 * from the same answered snapshot; nothing here reaches a window.
 */
export function hostSettingSideEffects(dependencies: HostSettingSideEffectDependencies) {
  return {
    [SETTING_SIDE_EFFECT.NONE]: noHostSettingSideEffect,
    [SETTING_SIDE_EFFECT.DOCK]: noHostSettingSideEffect,
    [SETTING_SIDE_EFFECT.LOGIN_ITEM]: noHostSettingSideEffect,
    [SETTING_SIDE_EFFECT.DISPLAYS]: noHostSettingSideEffect,
    [SETTING_SIDE_EFFECT.FORM_FACTOR]: noHostSettingSideEffect,
    [SETTING_SIDE_EFFECT.TALK_HOTKEY]: noHostSettingSideEffect,
    [SETTING_SIDE_EFFECT.STOP_HOTKEY]: noHostSettingSideEffect,
    [SETTING_SIDE_EFFECT.MEDIA_DUCK]: noHostSettingSideEffect,
    // The stored voice reaches the source first, because the audition is
    // heard in a session created under it: a session opened before the source
    // had the new voice would speak in the old one.
    [SETTING_SIDE_EFFECT.VOICE]: ({ settings, origin }) =>
      Effect.andThen(
        dependencies.setVoice(settings.voice),
        origin === SETTING_WRITE_ORIGIN.CHOSEN ? dependencies.previewVoice : Effect.void,
      ),
    // The hold is the service's to apply since E5-3: a briefing is spoken by
    // the service's own exchange against the quiet instant this device's
    // heartbeat reports, which folds the pause and the meeting hold both. So
    // the toggle moves two things: the hold the panel draws, and the row on
    // the service, by a heartbeat sent now rather than at the next scheduled
    // beat, so a pause released frees the account's briefings at once.
    [SETTING_SIDE_EFFECT.ANNOUNCEMENT_HOLD]: () =>
      Effect.andThen(dependencies.refreshAnnouncementHold, dependencies.reportPresence),
  } satisfies HostSettingSideEffects;
}
