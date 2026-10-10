import { SETTING_SIDE_EFFECT, type SettingSideEffectId } from "@sidecar/settings";
import type { AppSettings } from "@sidecar/settings/wire";
import type { MediaDuckController } from "../native/media-duck";
import { HOTKEY_RANK, type HotkeyRegistrar } from "../window/hotkey-registrar";

/** What one client-side effect is handed: the snapshot, and whether to wait. */
interface ClientSettingSideEffectContext {
  readonly settings: AppSettings;
  /**
   * Whether an effect that may be deferred must be waited on. A reset applies
   * every field in its scope and must not answer before the keys are back.
   */
  readonly waitForDeferredEffects: boolean;
}

type ClientSettingSideEffect = (context: ClientSettingSideEffectContext) => Promise<void> | void;

/**
 * Every side effect a setting can have, over the whole of the id set. Total on
 * purpose: a new effect does not build until this table and the host's both say
 * what it does, where the `switch` this replaces ended in a `default` that
 * silently did nothing.
 */
type ClientSettingSideEffects = Readonly<Record<SettingSideEffectId, ClientSettingSideEffect>>;

/** An effect this side has nothing to do about, whichever side owns it. */
const noClientSettingSideEffect: ClientSettingSideEffect = () => {};

/** What the client's own side effects have hands on. */
export interface ClientSettingSideEffectDependencies {
  hotkeys: HotkeyRegistrar;
  applyLoginItem: (openAtLogin: boolean) => void;
  mediaDuck: MediaDuckController;
}

/**
 * The side effects this process has hands on; the host applied its own before
 * answering. The stop key may be deferred: a single write does not wait on a
 * reapply, and a reset does.
 */
export function clientSettingSideEffects(dependencies: ClientSettingSideEffectDependencies) {
  const { hotkeys, applyLoginItem, mediaDuck } = dependencies;
  const reapply = async (
    rank: typeof HOTKEY_RANK.STOP,
    chosen: string | undefined,
    waitForDeferredEffects: boolean,
  ): Promise<void> => {
    hotkeys.setChosen(rank, chosen);
    if (waitForDeferredEffects) await hotkeys.reapply(rank);
    else void hotkeys.reapply(rank);
  };
  return {
    [SETTING_SIDE_EFFECT.NONE]: noClientSettingSideEffect,
    [SETTING_SIDE_EFFECT.VOICE]: noClientSettingSideEffect,
    [SETTING_SIDE_EFFECT.LOGIN_ITEM]: ({ settings }) => applyLoginItem(settings.stored.openAtLogin),
    [SETTING_SIDE_EFFECT.TALK_HOTKEY]: async ({ settings }) => {
      hotkeys.setChosen(HOTKEY_RANK.TALK, settings.stored.voiceHotkey);
      await hotkeys.reapply(HOTKEY_RANK.TALK);
    },
    [SETTING_SIDE_EFFECT.STOP_HOTKEY]: ({ settings, waitForDeferredEffects }) =>
      reapply(HOTKEY_RANK.STOP, settings.stored.stopHotkey, waitForDeferredEffects),
    [SETTING_SIDE_EFFECT.MEDIA_DUCK]: ({ settings }) =>
      mediaDuck.setEnabled(settings.stored.duckOtherMedia),
  } satisfies ClientSettingSideEffects;
}
