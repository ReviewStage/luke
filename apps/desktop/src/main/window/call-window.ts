/**
 * call-window.ts -- the floating call card's window: on top, on every Space, never bringing Luke forward, and the one window the avatar's room is handed to.
 */

import fs from "node:fs";
import type { RunMode } from "@sidecar/host";
import { Option, Schema } from "effect";
import { BrowserWindow, screen, type WebContents } from "electron";
import { channels } from "#shared/bridge";
import type { CallAvatarRoom } from "#shared/messages/avatar-room";
import {
  CALL_WINDOW_BOUNDS,
  CALL_WINDOW_SHAPE,
  type CallWindowPoint,
  type CallWindowShape,
  type CallWindowSurface,
  callWindowPosition,
  callWindowReshaped,
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
 * has the keyboard. It loads the same renderer bundle as the panels from a
 * document of its own (`call.html`, which may reach LiveKit Cloud alone, where
 * LiveAvatar's room for the avatar stands), under the same
 * hardening, and mounts the call card by the role main answers it. It is
 * transparent and frameless, so the card is the whole of what is seen; a non-activating
 * panel, so pressing a control leaves the developer's editor in front; and it
 * floats over every Space and full-screen app, out of Mission Control.
 *
 * It is opened the first time it is wanted and kept, hidden, after: a card
 * that comes and goes with every switch of app would reload its renderer
 * each time. A renderer that dies is let go of, and the next show opens a fresh
 * one. Like the voice window it never counts toward the app's lifetime.
 *
 * It grows into the 16:9 video tile while the call has Luke's face, and is
 * the one window the face's room is handed to: the room's address and its
 * viewer token are held here and sent on this window's own channel, never in
 * the document, when the room changes and whenever its renderer asks.
 */
export class CallWindow implements CallWindowSurface {
  readonly #options: CallWindowOptions;
  #window: BrowserWindow | undefined;
  /** Whether the renderer has drawn its first frame, before which a show would flash an empty window. */
  #ready = false;
  #wanted = false;
  #closedForGood = false;
  #shape: CallWindowShape = CALL_WINDOW_SHAPE.CARD;
  /** The face's room while one stands, which a fresh renderer asks for. */
  #room: CallAvatarRoom | undefined;

  constructor(options: CallWindowOptions) {
    this.#options = options;
  }

  show(shape: CallWindowShape): void {
    if (this.#closedForGood) return;
    this.#wanted = true;
    const window = this.current() ?? this.#open();
    this.#reshape(window, shape);
    if (this.#ready) window.showInactive();
  }

  hide(): void {
    this.#wanted = false;
    this.current()?.hide();
  }

  /**
   * The room the call window joins, or none once the face is down: held for a
   * renderer that asks later, and sent to the one standing now.
   */
  showAvatarRoom(room: CallAvatarRoom | undefined): void {
    this.#room = room;
    const window = this.current();
    if (window) this.sendAvatarRoomTo(window.webContents);
  }

  /** The room standing now, to the call window's renderer that asked; any other asks for nothing. */
  sendAvatarRoomTo(webContents: WebContents): void {
    if (!this.owns(webContents)) return;
    webContents.send(channels.onAvatarRoom, this.#room);
  }

  /** Sets the window's size once per change of shape, never animated. */
  #reshape(window: BrowserWindow, shape: CallWindowShape): void {
    if (shape === this.#shape) return;
    this.#shape = shape;
    const bounds = window.getBounds();
    window.setBounds(
      callWindowReshaped({ bounds, shape, workArea: screen.getDisplayMatching(bounds).workArea }),
    );
  }

  #open(): BrowserWindow {
    const { x, y } = callWindowPosition({
      saved: readPlacement(this.#options.placementPath),
      workAreas: screen.getAllDisplays().map((display) => display.workArea),
      primary: screen.getPrimaryDisplay().workArea,
    });
    const window = new BrowserWindow({
      title: "Luke call",
      show: false,
      x,
      y,
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
    this.#shape = CALL_WINDOW_SHAPE.CARD;
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
      if (!window.isDestroyed()) window.webContents.send(channels.onCallWindowMoved);
    });
    // The place is kept as the card's, whichever shape was dragged, so the
    // card opens next where the tile's foot was left.
    window.on("moved", () => {
      const { x, y, height } = window.getBounds();
      const top = y + height - CALL_WINDOW_BOUNDS.HEIGHT;
      try {
        fs.writeFileSync(this.#options.placementPath, JSON.stringify({ x, y: top }));
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
      const shape = this.#shape;
      this.close();
      if (reopen) this.show(shape);
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
    this.#room = undefined;
    this.close();
  }
}
