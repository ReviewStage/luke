import type { ProductEventSender } from "@sidecar/analytics";
import { Context, Layer } from "effect";

export interface DesktopAnalytics {
  readonly sender: ProductEventSender;
}

export class DesktopAnalyticsTag extends Context.Tag("@luke/desktop/DesktopAnalytics")<
  DesktopAnalyticsTag,
  DesktopAnalytics
>() {}

export function desktopAnalyticsLayer(
  analytics: DesktopAnalytics,
): Layer.Layer<DesktopAnalyticsTag> {
  return Layer.succeed(DesktopAnalyticsTag, analytics);
}
