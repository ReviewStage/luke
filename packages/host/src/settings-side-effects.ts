import {
  SETTING_SIDE_EFFECT,
  type SettingSideEffectId,
  type StoredAppSettings,
} from "@sidecar/settings";

/** What one host-side effect is handed: the snapshot the write just stored. */
interface HostSettingSideEffectContext {
  readonly settings: StoredAppSettings;
}

type HostSettingSideEffect = (context: HostSettingSideEffectContext) => Promise<void> | void;

/**
 * Every side effect a setting can have, over the whole of the id set. Total on
 * purpose: a new effect does not build until this table and the client's both
 * say what it does, where the `switch` this replaces ended in a `default` that
 * silently did nothing.
 */
type HostSettingSideEffects = Readonly<Record<SettingSideEffectId, HostSettingSideEffect>>;

/** An effect this side has nothing to do about, whichever side owns it. */
const noHostSettingSideEffect: HostSettingSideEffect = () => {};

/** What the host's own side effects reach in the concerns around them. */
export interface HostSettingSideEffectDependencies {
  setVoice: (voice: StoredAppSettings["voice"]) => void;
  applyVoiceCredential: () => Promise<void>;
  reconcileSpeech: () => void;
  emitSettings: () => Promise<void>;
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
    [SETTING_SIDE_EFFECT.VOICE_SOURCE]: async () => {
      await dependencies.applyVoiceCredential();
      await dependencies.emitSettings();
    },
    [SETTING_SIDE_EFFECT.ANNOUNCEMENT_HOLD]: () => dependencies.reconcileSpeech(),
  } satisfies HostSettingSideEffects;
}
