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
  /**
   * The standing live session ended gracefully, where one stands. GPT Live
   * fixes a session's voice when the session is created and documents no way
   * to change it after, so a conversation left standing would keep the old
   * voice for as long as it idled, which reads as the choice not taking.
   */
  readonly endLiveSession: Effect.Effect<void>;
}

/**
 * The side effects a setting has in the host. The client applies its own — the
 * login item, the Dock, the keys, the duck —
 * from the same answered snapshot; nothing here reaches a window.
 */
export function hostSettingSideEffects(dependencies: HostSettingSideEffectDependencies) {
  return {
    [SETTING_SIDE_EFFECT.NONE]: noHostSettingSideEffect,
    [SETTING_SIDE_EFFECT.DOCK]: noHostSettingSideEffect,
    [SETTING_SIDE_EFFECT.LOGIN_ITEM]: noHostSettingSideEffect,
    [SETTING_SIDE_EFFECT.TALK_HOTKEY]: noHostSettingSideEffect,
    [SETTING_SIDE_EFFECT.STOP_HOTKEY]: noHostSettingSideEffect,
    [SETTING_SIDE_EFFECT.MEDIA_DUCK]: noHostSettingSideEffect,
    // The stored voice reaches the source first, so the session the peer
    // opens next is created under it; only then is the standing session
    // ended, since its own voice cannot move and the developer is listening
    // for the one they chose. A sign-in's reconcile runs this too, when no
    // session can stand, so the end is a no-op there.
    [SETTING_SIDE_EFFECT.VOICE]: ({ settings }) =>
      Effect.andThen(dependencies.setVoice(settings.voice), dependencies.endLiveSession),
  } satisfies HostSettingSideEffects;
}
