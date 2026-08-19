import { type Effect, Layer, ManagedRuntime } from "effect";
import { type Cli, CliLive } from "./services/cli";
import { type Files, FilesLive } from "./services/files";
import { type Http, HttpLive } from "./services/http";
import { type SettingsStoreService, settingsStoreLive } from "./services/settings-store-service";
import type { SettingsStore } from "./settings-store";

export type DesktopServices = Http | Cli | Files | SettingsStoreService;

export type DesktopEffect<A, E = unknown> = Effect.Effect<A, E, DesktopServices>;

export function makeEffectRuntime(settingsStore: SettingsStore) {
  return ManagedRuntime.make(
    Layer.mergeAll(HttpLive, CliLive, FilesLive, settingsStoreLive(settingsStore)),
  );
}

export type DesktopEffectRuntime = ReturnType<typeof makeEffectRuntime>;

/** Set once at the composition root before any edge runs an Effect. */
export let effectRuntime: DesktopEffectRuntime;

export function initializeEffectRuntime(settingsStore: SettingsStore): DesktopEffectRuntime {
  effectRuntime = makeEffectRuntime(settingsStore);
  return effectRuntime;
}

/** Runs an effect at the composition root when adapter requirements are wider than the runtime type. */
export function runDesktopEffect<A, E>(effect: Effect.Effect<A, E, unknown>): Promise<A> {
  return effectRuntime.runPromise(effect as DesktopEffect<A, E>);
}
