/**
 * app-platform.ts -- what this window can do that only its platform can: installed by its root before anything reads it.
 *
 * The bridge (`app-bridge.ts`) reaches the host; this reaches what stands
 * beside it. Copying words or a picture, saving a file, bringing the panel forward, the address
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
import type { OpenBrowserLive } from "./tasks/cloud-browser-live.js";

export type { OpenBrowserLive } from "./tasks/cloud-browser-live.js";

/**
 * The way the sidebar's Admin row takes an admin to the dashboard: a link
 * to its address (`href`), where the window's own origin serves it, as a
 * browser tab's does, so a modified click opens it as any link does; or a
 * press (`open`), where the shell opens it outside the window, as the Mac
 * app does in the default browser, where the developer's session is.
 */
type AdminDashboardWay = { readonly href: string } | { readonly open: () => void };

/** The capabilities a window's shell answers, each as the panel asks for it. */
export interface AppPlatform {
  /** Puts the words on the system clipboard; rejects where the clipboard refused them. */
  copyText(words: string): Promise<void>;
  /**
   * Puts a picture on the system clipboard, given as the PNG's bytes in
   * base64 still being drawn; rejects where the clipboard refused it. Note
   * that the write is asked for at once and the bytes awaited inside it,
   * because a browser takes a picture only in the press's own task.
   */
  copyImage(png: Promise<string>): Promise<void>;
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
   * Opens a cloud Browser tab's live view socket: the desktop from its host
   * under the account's bearer, reached over a port main posts this window,
   * and a browser tab from its own page under the session cookie.
   */
  openBrowserLive: OpenBrowserLive;
  /** How the admin dashboard is reached from this window: a link to it, or a press the shell answers. */
  adminDashboard(): AdminDashboardWay;
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
  /**
   * Hears the ask standing each time a page comes to hold unsaved work, and
   * nothing once none does, so a shell that can leave the page by ways of its
   * own, a browser tab closed, reloaded, or sent elsewhere, asks first while
   * there is work to lose and only then. `ask` takes the way out once the
   * developer says to leave. The Mac app, whose window's close is main's,
   * leaves this out.
   */
  unsavedWork?(ask: ((leave: () => void) => void) | undefined): void;
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
