import {
  SETTING_SIDE_EFFECT,
  type SettingSideEffectId,
  type StoredAppSettings,
} from "@sidecar/settings";
import { Effect } from "effect";

/** What one host-side effect is handed: the snapshot the write just stored. */
interface HostSettingSideEffectContext {
  readonly settings: StoredAppSettings;
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
  applyVoiceCredential: Effect.Effect<void>;
  /** The hold read again for the panel, which draws it; nothing on this side queues speech to hold since E5-3. */
  readonly refreshAnnouncementHold: Effect.Effect<void>;
  /** The device heartbeat sent now, carrying the quiet instant as it stands after the write. */
  readonly reportPresence: Effect.Effect<void>;
  emitSettings: () => Effect.Effect<void>;
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
    [SETTING_SIDE_EFFECT.VOICE]: ({ settings }) => dependencies.setVoice(settings.voice),
    [SETTING_SIDE_EFFECT.VOICE_SOURCE]: () =>
      Effect.andThen(dependencies.applyVoiceCredential, dependencies.emitSettings()),
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
