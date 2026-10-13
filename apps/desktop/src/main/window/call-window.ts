/**
 * call-window.ts -- the floating call card's window: on top, on every Space, and never bringing Luke forward.
 */

import fs from "node:fs";
import type { RunMode } from "@sidecar/host";
import { Option, Schema } from "effect";
import { BrowserWindow, screen, type WebContents } from "electron";
import { channels } from "#shared/bridge";
import type { AvatarFeed, AvatarGrant } from "#shared/messages/avatar";
import { CallAvatarRelay } from "./call-window-avatar";
import {
  CALL_WINDOW_BOUNDS,
  type CallWindowArea,
  type CallWindowPoint,
  type CallWindowSurface,
  callWindowFrame,
  callWindowPosition,
} from "./call-window-presence";
import { hardenedWebPreferences, refuseForeignNavigation } from "./hardened-window";

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

/**
 * The one floating window that draws the standing call while no Luke window
 * has the keyboard, and Luke's avatar while it is up. It loads the same
 * renderer bundle as the panels from a document of its own (`call.html`,
 * whose one host is the LiveKit server Keyframe's grant names, for the
 * avatar's session), under the same hardening, and mounts the call card by
 * the role main answers it. It is the one window the grant is sent to. It is
 * transparent and frameless, so the card is the whole of what is seen; a non-activating
 * panel, so pressing a control leaves the developer's editor in front; and it
 * floats over every Space and full-screen app, out of Mission Control.
 *
 * It is opened the first time it is wanted and kept, hidden, after: a card
 * that comes and goes with every switch of app would reload its renderer
 * each time. A renderer that dies is let go of, and the next show opens a fresh
 * one. Like the voice window it never counts toward the app's lifetime.
 */
export class CallWindow implements CallWindowSurface {
  readonly #options: CallWindowOptions;
  #window: BrowserWindow | undefined;
  /** Whether the renderer has drawn its first frame, before which a show would flash an empty window. */
  #ready = false;
  #wanted = false;
  /** Whether the frame is the video tile's rather than the card's. */
  #video = false;
  /** Where the card stands, which the tile grows from and the card returns to. */
  #card: CallWindowPoint | undefined;
  /** The frame this window last set, so the move it causes is not read as a drag. */
  #set: CallWindowArea | undefined;
  #closedForGood = false;
  readonly #avatar = new CallAvatarRelay(() =>
    this.#ready ? this.current()?.webContents : undefined,
  );

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
    if (window && this.#card) this.#refit(window, this.#card);
  }

  /** Keyframe's grant for the call's avatar, or nothing once its session is to close. */
  showAvatarSession(grant: AvatarGrant | undefined): void {
    this.#avatar.showAvatarSession(grant);
  }

  /** One message of Luke's voice feed, for the avatar to lip-sync. */
  feedAvatar(feed: AvatarFeed): void {
    this.#avatar.feedAvatar(feed);
  }

  /** The frame resized to what is drawn, from the card's place on the display it stands on. */
  #refit(window: BrowserWindow, card: CallWindowPoint): void {
    const cardFrame = {
      ...card,
      width: CALL_WINDOW_BOUNDS.WIDTH,
      height: CALL_WINDOW_BOUNDS.HEIGHT,
    };
    const workArea = screen.getDisplayMatching(cardFrame).workArea;
    this.#set = callWindowFrame({ card, video: this.#video, workArea });
    window.setBounds(this.#set);
  }

  #open(): BrowserWindow {
    const card = callWindowPosition({
      saved: readPlacement(this.#options.placementPath),
      workAreas: screen.getAllDisplays().map((display) => display.workArea),
      primary: screen.getPrimaryDisplay().workArea,
    });
    const window = new BrowserWindow({
      title: "Luke call",
      show: false,
      x: card.x,
      y: card.y,
      width: CALL_WINDOW_BOUNDS.WIDTH,
      height: CALL_WINDOW_BOUNDS.HEIGHT,
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
    this.#card = card;
    this.#set = undefined;
    if (this.#video) this.#refit(window, card);
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
      this.#avatar.pageDrew();
      if (this.#wanted) window.showInactive();
    });
    // The page is told the window is moving under the pointer, so a hover
    // the drag left on a button is not drawn.
    window.on("move", () => {
      if (!window.isDestroyed()) window.webContents.send(channels.onCallWindowMoved);
    });
    window.on("moved", () => {
      // Note that a move this window made itself is not kept, because a tile
      // pulled back onto the screen is not where the developer left the card.
      const frame = window.getBounds();
      const set = this.#set;
      if (set && set.x === frame.x && set.y === frame.y) return;
      // A drag is kept as the card's own corner whichever size is drawn,
      // since the tile is anchored at the card's bottom-left.
      const place = { x: frame.x, y: frame.y + frame.height - CALL_WINDOW_BOUNDS.HEIGHT };
      this.#card = place;
      this.#set = undefined;
      try {
        fs.writeFileSync(this.#options.placementPath, JSON.stringify(place));
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
