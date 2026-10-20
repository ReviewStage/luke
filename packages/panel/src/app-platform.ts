/**
 * app-platform.ts -- what this window can do that only its platform can: installed by its root before anything reads it.
 *
 * The bridge (`app-bridge.ts`) reaches the host; this reaches what stands
 * beside it. Copying, saving a file, bringing the panel forward, the address
 * an agent's page is drawn from, the folder the panel's static files are
 * served from, the menu bar, a shortcut being recorded, a counted surface
 * event, and a link opened outside the window are each
 * answered by whatever shell holds the window, the desktop through main and
 * a browser through its own APIs, so the panel names the capability here and
 * never the act or the event a shell answers it with. Note that this is a
 * module-level door, as the bridge's is, because its callers read it outside
 * a render, at the moment they call, and never at module load.
 */

import type { ProductEventPropertiesFor, ProductSurfaceEventName } from "@luke/features/analytics";
import type { FramedPage } from "@luke/features/page-frame";
import type { SessionReplayBootstrap } from "@luke/gateway/window-session";
import type { AppCommand } from "@luke/settings/shortcuts";
import type { NotificationsGrantor } from "@luke/voice/settings-controls";

/** The capabilities a window's shell answers, each as the panel asks for it. */
export interface AppPlatform {
  /** Puts the words on the system clipboard; rejects where the clipboard refused them. */
  copyText(words: string): Promise<void>;
  /** Saves the text as a file of the name given, where the person chooses; answers whether it was saved rather than declined. */
  saveFile(file: { readonly name: string; readonly text: string }): Promise<boolean>;
  /** Brings the panel forward, where the shell can. */
  focusPanel(): void;
  /** The address one version of an agent's page is drawn from, in a sandboxed frame. */
  pageFrameUrl(page: FramedPage): string;
  /**
   * The folder the panel's static files are served from (Excalidraw's fonts,
   * the harness marks), as an absolute address ending in `/`: the shell's to
   * name, because the document's own address need not be that folder.
   */
  assetBase(): string;
  /** Hears each command chosen from the shell's menu, until the returned function is called. */
  onMenuCommand(listener: (command: AppCommand) => void): () => void;
  /** Says whether a shortcut is being recorded, during which the shell's own keys hold off. */
  setShortcutCapturing(capturing: boolean): void;
  /** Counts one surface event. */
  recordSurfaceEvent<Name extends ProductSurfaceEventName>(
    name: Name,
    properties: ProductEventPropertiesFor<Name>,
  ): void;
  /** Opens a GitHub page outside the window. */
  openGitHub(url: string): void;
  /** Opens a web page outside the window. */
  openWeb(url: string): void;
  /**
   * Brings the shell's session recording into line with what the run allows,
   * in either direction; the panel calls it at bootstrap and on every account
   * transition. A shell that records nothing does nothing.
   */
  applySessionReplay(bootstrap: SessionReplayBootstrap): void;
  /**
   * The link that opens the Mac app on where this window stands, which the
   * sign-in offers beside its ways in: a shell that is not the Mac app
   * answers one, and the Mac app, which needs none, leaves this out.
   */
  macAppLink?(): string;
  /**
   * Who grants this window notifications where it is not macOS, such as a
   * browser's permission for the site: a shell whose grant is macOS's, the
   * Mac app, leaves this out.
   */
  notificationsGrantor?(): NotificationsGrantor;
  /**
   * Asks the shell's grantor for permission where it was never answered,
   * called in the press's own handler before Settings' test leaves for the
   * host, because a browser such as Safari prompts only for an ask made
   * inside the press. A shell whose grant is macOS's, the Mac app, leaves
   * this out.
   */
  askNotificationsPermission?(): void;
}

let installed: AppPlatform | undefined;

/** Installs what this window's shell can do; its root does this once, before anything is drawn, and calls what it answers as it closes. */
export function installAppPlatform(platform: AppPlatform): () => void {
  installed = platform;
  return () => {
    if (installed === platform) installed = undefined;
  };
}

/** What this window's root installed. */
export function appPlatform(): AppPlatform {
  if (installed === undefined) throw new Error("No app platform is installed in this window.");
  return installed;
}

/** The absolute address of one of the panel's static files, named by its path under the shell's asset base. */
export function assetUrl(path: string): string {
  return new URL(path, appPlatform().assetBase()).href;
}
