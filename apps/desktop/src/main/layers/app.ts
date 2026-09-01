import type { ProductEventSender } from "@sidecar/analytics";
import { Layer } from "effect";
import { type DesktopAnalyticsTag, desktopAnalyticsLayer } from "./analytics";
import type { DesktopPlatform } from "./platform";
import { type DesktopPlatformTag, desktopPlatformLayer } from "./platform";
import type { DesktopStorage } from "./storage";
import { type DesktopStorageTag, desktopStorageLayer } from "./storage";
import { type UpdatesOptions, type UpdatesTag, updatesLayer } from "./updates";

export interface DesktopLiveInput {
  readonly platform: DesktopPlatform;
  readonly storage: DesktopStorage;
  readonly analytics: { readonly sender: ProductEventSender };
  readonly updates: UpdatesOptions;
}

export type DesktopServices =
  | DesktopPlatformTag
  | DesktopStorageTag
  | DesktopAnalyticsTag
  | UpdatesTag;

export function desktopLive(input: DesktopLiveInput): Layer.Layer<DesktopServices, never, never> {
  return Layer.mergeAll(
    desktopPlatformLayer(input.platform),
    desktopStorageLayer(input.storage),
    desktopAnalyticsLayer(input.analytics),
    updatesLayer(input.updates),
  ).pipe(Layer.provideMerge(Layer.scope));
}
