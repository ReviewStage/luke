import {
  APP_SETTING_DEFAULTS,
  SETTING_SIDE_EFFECT,
  type SettingSideEffectId,
} from "@sidecar/settings";
import type { AppSettings } from "@sidecar/settings/wire";
import type { WebContents } from "electron";
import type { MediaDuckController } from "../native/media-duck";
import type { DockPresence } from "../window/dock-presence";
import { HOTKEY_RANK, type HotkeyRegistrar } from "../window/hotkey-registrar";
import type { PanelManager } from "../window/panel-manager";

/** What one client-side effect is handed: the snapshot, and who asked for it. */
interface ClientSettingSideEffectContext {
  readonly settings: AppSettings;
  readonly sender: WebContents;
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
  dock: DockPresence;
  applyLoginItem: (openAtLogin: boolean) => void;
  panels: PanelManager;
  mediaDuck: MediaDuckController;
}

/**
 * The side effects this process has hands on; the host applied its own before
 * answering. The stop key may be deferred: a single write does not wait on a
 * reapply, and a reset does.
 */
export function clientSettingSideEffects(dependencies: ClientSettingSideEffectDependencies) {
  const { hotkeys, dock, applyLoginItem, panels, mediaDuck } = dependencies;
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
    [SETTING_SIDE_EFFECT.ANNOUNCEMENT_HOLD]: noClientSettingSideEffect,
    [SETTING_SIDE_EFFECT.LOGIN_ITEM]: ({ settings }) => applyLoginItem(settings.stored.openAtLogin),
    [SETTING_SIDE_EFFECT.DOCK]: ({ settings, sender }) =>
      dock.apply(settings.stored.showInDock, panels.displayIdFor(sender)),
    [SETTING_SIDE_EFFECT.DISPLAYS]: ({ settings }) => {
      panels.setShowOnAllDisplays(settings.stored.showOnAllDisplays);
      panels.reconcile();
    },
    [SETTING_SIDE_EFFECT.FORM_FACTOR]: ({ settings }) => {
      panels.setFormFactor(settings.stored.formFactor ?? APP_SETTING_DEFAULTS.formFactor);
      panels.positionAll();
    },
    [SETTING_SIDE_EFFECT.TALK_HOTKEY]: async ({ settings }) => {
      hotkeys.setChosen(HOTKEY_RANK.TALK, settings.stored.voiceHotkey);
      await hotkeys.reapply(HOTKEY_RANK.TALK);
    },
    [SETTING_SIDE_EFFECT.STOP_HOTKEY]: ({ settings, waitForDeferredEffects }) =>
      reapply(HOTKEY_RANK.STOP, settings.stored.stopHotkey, waitForDeferredEffects),
    [SETTING_SIDE_EFFECT.MEDIA_DUCK]: ({ settings }) =>
      mediaDuck.setEnabled(settings.stored.duckOtherMedia),
    // The host rebuilt the voice; the key follows what it now has.
    [SETTING_SIDE_EFFECT.VOICE_SOURCE]: async () => {
      await hotkeys.reapply(HOTKEY_RANK.TALK);
    },
  } satisfies ClientSettingSideEffects;
}
