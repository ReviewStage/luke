import {
  SETTING_SIDE_EFFECT,
  type SettingSideEffectId,
  type StoredAppSettings,
} from "@repo/settings";
import { Effect } from "effect";

interface HostSettingSideEffectContext {
  readonly settings: StoredAppSettings;
}

type HostSettingSideEffect = (context: HostSettingSideEffectContext) => Effect.Effect<void>;

type HostSettingSideEffects = Readonly<Record<SettingSideEffectId, HostSettingSideEffect>>;

const noHostSettingSideEffect: HostSettingSideEffect = () => Effect.void;

export interface HostSettingSideEffectDependencies {
  shareUsageData: (on: boolean) => Effect.Effect<void>;
}

export function hostSettingSideEffects(dependencies: HostSettingSideEffectDependencies) {
  return {
    [SETTING_SIDE_EFFECT.NONE]: noHostSettingSideEffect,
    [SETTING_SIDE_EFFECT.LOGIN_ITEM]: noHostSettingSideEffect,
    [SETTING_SIDE_EFFECT.USAGE_DATA]: ({ settings }) =>
      dependencies.shareUsageData(settings.usageData === true),
  } satisfies HostSettingSideEffects;
}
