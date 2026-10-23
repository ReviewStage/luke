import type { ClientSettingSideEffects } from "@luke/host/act-port";
import { SETTING_SIDE_EFFECT } from "@luke/settings";
import type { MediaDuckController } from "../native/media-duck";

/** An effect this side has nothing to do about, whichever side owns it. */
const noClientSettingSideEffect = () => {};

/** What the client's own side effects have hands on. */
export interface ClientSettingSideEffectDependencies {
  applyLoginItem: (openAtLogin: boolean) => void;
  mediaDuck: MediaDuckController;
}

/** The side effects this process has hands on; the host applied its own before answering. */
export function clientSettingSideEffects(dependencies: ClientSettingSideEffectDependencies) {
  const { applyLoginItem, mediaDuck } = dependencies;
  return {
    [SETTING_SIDE_EFFECT.NONE]: noClientSettingSideEffect,
    [SETTING_SIDE_EFFECT.VOICE]: noClientSettingSideEffect,
    [SETTING_SIDE_EFFECT.USAGE_DATA]: noClientSettingSideEffect,
    [SETTING_SIDE_EFFECT.LOGIN_ITEM]: ({ settings }) => applyLoginItem(settings.stored.openAtLogin),
    [SETTING_SIDE_EFFECT.MEDIA_DUCK]: ({ settings }) =>
      mediaDuck.setEnabled(settings.stored.duckOtherMedia),
  } satisfies ClientSettingSideEffects;
}
