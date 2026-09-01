import { Context, Layer } from "effect";
import type { RunMode } from "../run-mode";

/** Build identity and launch constraints fixed before the runtime starts. */
export interface DesktopPlatform {
  readonly runMode: RunMode;
  readonly appVersion: string;
  readonly isPackaged: boolean;
  readonly platform: NodeJS.Platform;
  readonly accountBaseUrl: string;
  readonly hostedServiceBaseUrl: string;
  readonly accountClientId: string;
}

export class DesktopPlatformTag extends Context.Tag("@luke/desktop/DesktopPlatform")<
  DesktopPlatformTag,
  DesktopPlatform
>() {}

export function desktopPlatformLayer(platform: DesktopPlatform): Layer.Layer<DesktopPlatformTag> {
  return Layer.succeed(DesktopPlatformTag, platform);
}
