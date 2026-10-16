import type { AppLinkInbox } from "@luke/features/app-links";
import type { RunMode } from "@luke/host";
import type { BuildCommit } from "@luke/settings/update";
import type { MenuBarChange } from "../app-menu";

/**
 * What the launch's own arguments said, parsed once in `main` and never read
 * from `process.argv` again. The capture and fixture flags travel as one
 * record because the bootstrap reads them as a block.
 */
interface DesktopLaunch {
  /** Where an evidence run writes its PNG, and the sign that this is one. */
  readonly captureOutput: string | undefined;
  readonly profile: string;
  readonly captureMode: boolean;
  readonly fixtureMode: boolean;
}

/**
 * Everything the desktop's services are told about this process, given
 * explicitly so nothing below reads Electron's own globals for a fact the
 * launch already established. Every `app` read the composition needs is here,
 * which is what lets the composition construct before `app` is ready — and
 * what makes the order in `main` the whole of the launch's order.
 */
export interface DesktopConfig {
  /** Luke's own application-state root: the directory Electron's userData was moved to. */
  readonly stateRoot: string;
  /**
   * The named development instance this run is (`run.sh --instance`), absent
   * for the plain one and always for a packaged build. A named instance runs
   * beside the plain one, so it leaves to it what only one Luke may hold: the
   * system-wide talk and stop keys.
   */
  readonly instance?: string;
  readonly runMode: RunMode;
  readonly appVersion: string;
  /** The commit the bundle was built from, absent where the build could not tell. */
  readonly commit?: BuildCommit;
  readonly packaged: boolean;
  readonly environment: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  /** Where this build's own files sit: the preload, the renderer, the icons. */
  readonly resourceDirectory: string;
  readonly hostedServiceBaseUrl: string;
  readonly launch: DesktopLaunch;
  readonly report: (message: string) => void;
  /**
   * An address handed to the operating system. The client performs its own
   * opens with it — the releases page, a privacy pane, a provider's keys
   * page — and it is what the native node serves the host's own open
   * capability with, which is how the open a host-owned flow asks for
   * reaches this machine.
   */
  readonly openExternal: (url: string) => Promise<void>;
  readonly quit: () => void;
  /**
   * Draws the menu bar from what it was last told, moved by one change: the
   * update item (or none), or the account's experiments, which decide whether
   * a gated feature's items stand. Called with nothing, it draws what it holds.
   */
  readonly showMenuBar: (change?: MenuBarChange) => void;
  /** The Luke links the system hands the app, heard from before the launch (`@luke/features/app-links`). */
  readonly appLinks: AppLinkInbox;
}
