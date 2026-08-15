import path from "node:path";
import { app, nativeImage, nativeTheme } from "electron";

/**
 * The Dock tile per theme: the porcelain tile for a light desktop, the
 * space-black one for a dark. The bundle's `.icns` is cut from the dark tile
 * and cannot follow the theme, and an unpackaged run has only Electron's stock
 * icon, so the running app draws the Dock image itself from these.
 */
export const DOCK_ICON_FILES = {
  LIGHT: "luke-icon-light.png",
  DARK: "luke-icon-dark.png",
} as const;

/**
 * macOS ignores a `dock.hide()` within a second of the last Dock change, so a
 * switch pressed twice cannot be honoured call by call; the applier below
 * paces itself to this instead, which is Electron's documented floor.
 */
export const DOCK_SETTLE_MS = 1100;

/** Only the Dock surface this needs, so a test can supply one. */
export interface DockTile {
  isVisible(): boolean;
  show(): Promise<void>;
  hide(): void;
  setIcon(image: Electron.NativeImage): void;
}

export interface DockTheme {
  readonly shouldUseDarkColors: boolean;
  on(event: "updated", listener: () => void): void;
}

export interface DockPresenceOptions {
  /** The display whose panel held the switch is brought back forward. */
  focusExpanded: (displayId?: number) => void;
  /** Directory holding the two theme tiles. */
  iconDirectory: string;
  dock?: DockTile;
  theme?: DockTheme;
  loadIcon?: (file: string) => Electron.NativeImage;
  delay?: (ms: number) => Promise<void>;
  settleMs?: number;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Luke's Dock tile: the desired visibility, the settle loop that chases it
 * because macOS will ignore a hide too soon after a show, and the theme-matched
 * face redrawn after every `dock.show()` that forgets it.
 */
export class DockPresence {
  readonly #focusExpanded: (displayId?: number) => void;
  readonly #iconDirectory: string;
  readonly #dock: DockTile | undefined;
  readonly #theme: DockTheme;
  readonly #loadIcon: (file: string) => Electron.NativeImage;
  readonly #delay: (ms: number) => Promise<void>;
  readonly #settleMs: number;
  readonly #enforcePlatform: boolean;
  /** The Dock state last asked for, and whether the applier is chasing it. */
  #desired = false;
  #settling = false;
  /** The display whose panel asked for the last Dock change, when one did. */
  #askedFrom: number | undefined;

  constructor(options: DockPresenceOptions) {
    this.#focusExpanded = options.focusExpanded;
    this.#iconDirectory = options.iconDirectory;
    this.#dock = options.dock ?? app.dock;
    this.#theme = options.theme ?? nativeTheme;
    this.#loadIcon =
      options.loadIcon ??
      ((file) => nativeImage.createFromPath(path.join(this.#iconDirectory, file)));
    this.#delay = options.delay ?? defaultDelay;
    this.#settleMs = options.settleMs ?? DOCK_SETTLE_MS;
    this.#enforcePlatform = options.dock === undefined;
  }

  /**
   * Draws Luke's own face in the Dock, matched to the theme. Called at startup,
   * on every theme change, and after every `dock.show()` — showing the icon
   * transforms the process, and macOS draws the fresh tile from the bundle's
   * icon (in a dev run, Electron's stock one), forgetting any image set while
   * there was no tile to wear it. Artwork missing from a build draws nothing,
   * leaving the bundle icon (or the stock one) in place rather than an empty
   * tile.
   */
  applyIcon(): void {
    if (!this.#dock) return;
    const file = this.#theme.shouldUseDarkColors ? DOCK_ICON_FILES.DARK : DOCK_ICON_FILES.LIGHT;
    const image = this.#loadIcon(file);
    if (!image.isEmpty()) this.#dock.setIcon(image);
  }

  /** Keeps the tile matched as the desktop changes mode. */
  watchTheme(): void {
    this.#theme.on("updated", () => this.applyIcon());
  }

  /**
   * Puts Luke in the Dock or takes him back out, to match the setting. He ships
   * as an accessory app — the notch is his fixed point — so the icon is a second
   * door like the status item, losing nothing when it is hidden. `askedFrom` is
   * the display whose panel held the switch, so the caret goes back where the
   * press was made rather than to whichever panel stands first.
   */
  apply(show: boolean, askedFrom?: number): void {
    if (this.#enforcePlatform && process.platform !== "darwin") return;
    this.#desired = show;
    this.#askedFrom = askedFrom;
    void this.#settle();
  }

  /**
   * Chases the desired state rather than relaying each press: a hide within a
   * second of the last Dock change is silently ignored by macOS, so the icon is
   * re-checked after every change and asked again until it matches — the switch
   * and the file must not end a quick on-and-off disagreeing with the Dock.
   */
  async #settle(): Promise<void> {
    if (this.#settling || !this.#dock) return;
    this.#settling = true;
    try {
      while (this.#dock.isVisible() !== this.#desired) {
        if (this.#desired) {
          await this.#dock.show();
          // The show rebuilt the tile from the bundle icon; put Luke's face
          // back on it.
          this.applyIcon();
        } else {
          this.#dock.hide();
        }
        // Either direction transforms the process type, which can deactivate
        // the app; the panel the switch was pressed in is brought back forward
        // rather than left to lose its caret.
        this.#focusExpanded(this.#askedFrom);
        await this.#delay(this.#settleMs);
      }
    } finally {
      this.#settling = false;
    }
  }
}
