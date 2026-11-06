import type { ProductEventPropertiesFor, ProductSurfaceEventName } from "@repo/features/analytics";
import type { FramedPage } from "@repo/features/page-frame";
import {
  type AppCommand,
  COMMAND_KEY,
  type CommandKey,
  installCommandKey,
} from "@repo/settings/shortcuts";
import type { SessionReplayWord } from "./session-replay.js";
import type { OpenBrowserLive } from "./tasks/cloud-browser-live.js";

export type { OpenBrowserLive } from "./tasks/cloud-browser-live.js";

type AdminDashboardWay = { readonly href: string } | { readonly open: () => void };

export interface AppPlatform {
  copyText(words: string): Promise<void>;
  copyImage(png: Promise<string>): Promise<void>;
  saveFile(file: { readonly name: string; readonly text: string }): Promise<boolean>;
  focusPanel(): void;
  pageFrameUrl(page: FramedPage): string;
  assetBase(): string;
  commandKey?: CommandKey;
  onMenuCommand(listener: (command: AppCommand) => void): () => void;
  recordSurfaceEvent<Name extends ProductSurfaceEventName>(
    name: Name,
    properties: ProductEventPropertiesFor<Name>,
  ): void;
  openGitHub(url: string): void;
  openWeb(url: string): void;
  openBrowserLive: OpenBrowserLive;
  adminDashboard(): AdminDashboardWay;
  applySessionReplay(bootstrap: SessionReplayWord): void;
  macAppLink?(): string;
  unsavedWork?(ask: ((leave: () => void) => void) | undefined): void;
  unsavedDescriptionWords?(unsaved: boolean): void;
  menuOffers?(commands: readonly AppCommand[]): void;
  stopImpersonating?(memberId: string): Promise<string | undefined>;
}

let installed: AppPlatform | undefined;

export function installAppPlatform(platform: AppPlatform): () => void {
  installed = platform;
  const restoreCommandKey = installCommandKey(platform.commandKey ?? COMMAND_KEY.META);
  return () => {
    if (installed !== platform) return;
    installed = undefined;
    restoreCommandKey();
  };
}

export function appPlatform(): AppPlatform {
  if (installed === undefined) throw new Error("No app platform is installed in this window.");
  return installed;
}

export function assetUrl(path: string): string {
  return new URL(path, appPlatform().assetBase()).href;
}
