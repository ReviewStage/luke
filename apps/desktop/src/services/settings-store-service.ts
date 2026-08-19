import { Context, Layer } from "effect";
import type { SettingsStore } from "../settings-store";

export class SettingsStoreService extends Context.Tag("SettingsStore")<
  SettingsStoreService,
  SettingsStore
>() {}

export const settingsStoreLive = (store: SettingsStore): Layer.Layer<SettingsStoreService> =>
  Layer.succeed(SettingsStoreService, store);
