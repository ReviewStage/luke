import type { AppLinkInbox } from "@repo/features/app-links";
import type { RunMode } from "@repo/host";
import type { BuildCommit } from "@repo/settings/update";
import type { MenuBarChange } from "../app-menu";

interface DesktopLaunch {
  readonly captureOutput: string | undefined;
  readonly profile: string;
  readonly captureMode: boolean;
  readonly fixtureMode: boolean;
}

export interface DesktopConfig {
  readonly stateRoot: string;
  readonly instance?: string;
  readonly runMode: RunMode;
  readonly appVersion: string;
  readonly commit?: BuildCommit;
  readonly packaged: boolean;
  readonly environment: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly resourceDirectory: string;
  readonly hostedServiceBaseUrl: string;
  readonly launch: DesktopLaunch;
  readonly report: (message: string) => void;
  readonly openExternal: (url: string) => Promise<void>;
  readonly quit: () => void;
  readonly showMenuBar: (change?: MenuBarChange) => void;
  readonly appLinks: AppLinkInbox;
}
