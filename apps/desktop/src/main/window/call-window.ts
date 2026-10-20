/**
 * call-window.ts -- the floating call card's window: on top, on every Space, and never bringing Luke forward.
 */

import fs from "node:fs";
import type { RunMode } from "@luke/host";
import { PUSH } from "@luke/host/contract";
import type { AvatarViewSignal } from "@luke/voice/avatar-view";
import { Option, Schema } from "effect";
import { BrowserWindow, screen, type WebContents } from "electron";
import {
  type CallWindowArea,
  CallWindowPlace,
  type CallWindowPoint,
  type CallWindowSurface,
  callWindowPosition,
} from "./call-window-presence";
import { hardenedWebPreferences, refuseForeignNavigation } from "./hardened-window";
import { windowPushes } from "./window-pushes";

export interface CallWindowOptions {
  runMode: RunMode;
  preloadPath: string;
  rendererHtmlPath: string;
  rendererUrl: string;
  /** The file the place the developer last dragged the card to is kept in. */
  placementPath: string;
}

const decodePlacement = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ x: Schema.Finite, y: Schema.Finite })),
);

/** Where the card was last left, or nothing for a first run or a file that is not one. */
function readPlacement(file: string): CallWindowPoint | undefined {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  return Option.getOrUndefined(decodePlacement(text));
}

/** Every display's work area, the screen less the menu bar and the Dock. */
function workAreas(): readonly CallWindowArea[] {
  return screen.getAllDisplays().map((display) => display.workArea);
}

/**
 * The one floating window that draws the standing call while no Luke window
 * has the keyboard. It loads the renderer's call entry from a document of its
 * own (`call.html`, which may reach no host), under the same hardening as
 * the panels, and that entry mounts the call card alone. It is
 * transparent and frameless, so the card is the whole of what is seen; a non-activating
 * panel, so pressing a control leaves the developer's editor in front; and it
 * floats over every Space and full-screen app, out of Mission Control.
 *
 * It is opened the first time it is wanted and kept, hidden, after: a card
 * that comes and goes with every switch of app would reload its renderer
 * each time. A renderer that dies is let go of, and the next show opens a fresh
 * one. Like the voice window it never counts toward the app's lifetime.
 *
 * On a video call it grows upward by the avatar's tile while the avatar
 * stands and shrinks back once it is down (`callWindowFrame`), its card's
 * controls staying where the developer left them. The place kept, in the
 * window's life and between launches, is the card's alone (`CallWindowPlace`),
 * whatever the window's height when it moved.
 */
export class CallWindow implements CallWindowSurface {
  readonly #options: CallWindowOptions;
  #window: BrowserWindow | undefined;
  /** Whether the renderer has drawn its first frame, before which a show would flash an empty window. */
  #ready = false;
  #wanted = false;
  #closedForGood = false;
  /** Whether the window holds the avatar's tile above the card, as the presence last fitted it. */
  #video = false;
  /** Where the card is kept while the window stands, which only the developer's drag moves. */
  #place: CallWindowPlace | undefined;

  constructor(options: CallWindowOptions) {
    this.#options = options;
  }

  show(): void {
    if (this.#closedForGood) return;
    this.#wanted = true;
    const window = this.current() ?? this.#open();
    if (this.#ready) window.showInactive();
  }

  hide(): void {
    this.#wanted = false;
    this.current()?.hide();
  }

  fitVideo(video: boolean): void {
    this.#video = video;
    const window = this.current();
    if (!window) return;
    const place = this.#place;
    if (place !== undefined) window.setBounds(place.frame(video, workAreas()));
  }

  /** The panel's answer to the window's view of the avatar's video. */
  signalAvatarView(signal: AvatarViewSignal): void {
    const window = this.current();
    if (window) windowPushes.push(window.webContents, PUSH.AVATAR_VIEW_SIGNAL, signal);
  }

  #open(): BrowserWindow {
    const place = new CallWindowPlace(
      callWindowPosition({
        saved: readPlacement(this.#options.placementPath),
        workAreas: workAreas(),
        primary: screen.getPrimaryDisplay().workArea,
      }),
    );
    this.#place = place;
    const { x, y, width, height } = place.frame(this.#video, workAreas());
    const window = new BrowserWindow({
      title: "Luke call",
      show: false,
      x,
      y,
      width,
      height,
      type: "panel",
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      // Note that the panel may take the keyboard, because a non-activating
      // panel that cannot be key hands a press to the app instead: Luke
      // comes forward, its window takes the keyboard, and this one is hidden
      // under the very press that was meant for it. Being key here leaves
      // the app inactive and every other window where it was.
      focusable: true,
      acceptFirstMouse: true,
      skipTaskbar: true,
      hiddenInMissionControl: true,
      alwaysOnTop: true,
      webPreferences: hardenedWebPreferences({
        preloadPath: this.#options.preloadPath,
        runMode: this.#options.runMode,
      }),
    });
    this.#window = window;
    this.#ready = false;
    window.setAlwaysOnTop(true, "floating");
    // Kept out of the Window menu's list, where a window nobody chose to open
    // would read as one of Luke's own.
    window.excludedFromShownWindowsMenu = true;
    // Note that the process type is left alone, because transforming it is
    // what hides and re-shows the Dock icon each time the window is raised.
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    refuseForeignNavigation(window, this.#options.rendererUrl);
    window.once("ready-to-show", () => {
      if (window !== this.#window) return;
      this.#ready = true;
      if (this.#wanted) window.showInactive();
    });
    // The page is told the window is moving under the pointer, so a hover
    // the drag left on a button is not drawn.
    window.on("move", () => {
      if (!window.isDestroyed())
        windowPushes.push(window.webContents, PUSH.CALL_WINDOW_MOVED, undefined);
    });
    // Only the developer's own drag moves the card's kept place: a move to
    // the frame this side just set, which macOS reports as a move too, is
    // not one.
    window.on("moved", () => {
      const kept = place.moved(window.getBounds());
      if (kept === undefined) return;
      try {
        fs.writeFileSync(this.#options.placementPath, JSON.stringify(kept));
      } catch {
        // Note that a place that cannot be kept is let go of, because the
        // card opening at its corner next time costs nothing, and a throw
        // from this listener would take the process, and the call, with it.
      }
    });
    // A renderer that dies after it drew is stood back up at once while the
    // card is wanted, since the presence tells this window nothing more
    // until the call's standing moves. One that dies before it ever drew
    // waits for the next show, so a renderer that cannot load never loops.
    window.webContents.on("render-process-gone", () => {
      if (window !== this.#window) return;
      const reopen = this.#wanted && this.#ready;
      this.close();
      if (reopen) this.show();
    });
    void window.loadFile(this.#options.rendererHtmlPath);
    return window;
  }

  current(): BrowserWindow | undefined {
    return this.#window !== undefined && !this.#window.isDestroyed() ? this.#window : undefined;
  }

  owns(webContents: WebContents): boolean {
    const window = this.current();
    return window !== undefined && window.webContents === webContents;
  }

  /** A dead renderer's close: the next show, if any, opens a fresh one. */
  close(): void {
    const window = this.#window;
    this.#window = undefined;
    this.#ready = false;
    if (window && !window.isDestroyed()) window.destroy();
  }

  /** The quit's own close: nothing is opened after it, whatever the call does. */
  closeForGood(): void {
    this.#closedForGood = true;
    this.close();
  }
}
