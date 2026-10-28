import {
  SETTING_SIDE_EFFECT,
  type SettingSideEffectId,
  type StoredAppSettings,
} from "@luke/settings";
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
  /** Product events armed or disarmed, as the usage data switch now stands. */
  shareUsageData: (on: boolean) => Effect.Effect<void>;
}

/**
 * The side effects a setting has in the host. The client applies its own, the
 * login item, from the same answered snapshot; nothing here reaches a window.
 */
export function hostSettingSideEffects(dependencies: HostSettingSideEffectDependencies) {
  return {
    [SETTING_SIDE_EFFECT.NONE]: noHostSettingSideEffect,
    [SETTING_SIDE_EFFECT.LOGIN_ITEM]: noHostSettingSideEffect,
    // The store answers the switch resolved by the build, so nothing stored
    // never reads as on here.
    [SETTING_SIDE_EFFECT.USAGE_DATA]: ({ settings }) =>
      dependencies.shareUsageData(settings.usageData === true),
  } satisfies HostSettingSideEffects;
}
