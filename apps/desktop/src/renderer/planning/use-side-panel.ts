import { Option, Schema } from "effect";
import { useCallback, useEffect, useState } from "react";

/**
 * use-side-panel.ts -- the open plan's side panel: whether it is shown, which of its tabs, and how wide, kept across launches.
 *
 * The plan's document is always the page's main content; what supports it
 * (the whiteboard, the code Luke has on screen) stands in a panel at the
 * window's right that the developer opens and closes, as every devtool
 * window's secondary sidebar does. Nothing opens it on its own. Not to be
 * confused with "the panel", which in this renderer is Luke's whole surface.
 *
 * The three facts are this window's preference rather than anything main
 * holds, so they are kept in the renderer's own storage and read once at
 * mount. A fixture run neither reads nor writes them: what it draws is
 * staged, and a capture must not depend on how the last run left the panel.
 */

/** The panel's tabs. A tab is one entry here, one label below, and one case where the panel draws it. */
export const SIDE_PANEL_TAB = {
  BOARD: "board",
  CODE: "code",
} as const;

export type SidePanelTab = (typeof SIDE_PANEL_TAB)[keyof typeof SIDE_PANEL_TAB];

/** The tab strip, in order. */
export const SIDE_PANEL_TABS = [
  { tab: SIDE_PANEL_TAB.BOARD, label: "Board" },
  { tab: SIDE_PANEL_TAB.CODE, label: "Code" },
] as const satisfies readonly { tab: SidePanelTab; label: string }[];

/** How wide the panel may be dragged, in CSS pixels, and where it starts. */
export const SIDE_PANEL_WIDTH = {
  MIN: 280,
  MAX: 720,
  DEFAULT: 400,
} as const;

/** The chord that shows and hides the panel, as its hover says it: VS Code's secondary sidebar's. */
export const SIDE_PANEL_SHORTCUT_LABEL = "⌥⌘B";

/** Where the preference is kept in the renderer's storage. */
const STORAGE_KEY = "luke.sidePanel";

const sidePanelStateSchema = Schema.Struct({
  open: Schema.Boolean,
  tab: Schema.Literals(Object.values(SIDE_PANEL_TAB)),
  width: Schema.Number,
});

export type SidePanelState = typeof sidePanelStateSchema.Type;

const storedSidePanel = Schema.fromJsonString(sidePanelStateSchema);
const decodeStored = Schema.decodeUnknownOption(storedSidePanel);
const encodeStored = Schema.encodeSync(storedSidePanel);

/** A first launch: closed, on the board, at the default width. */
const FIRST_LAUNCH: SidePanelState = {
  open: false,
  tab: SIDE_PANEL_TAB.BOARD,
  width: SIDE_PANEL_WIDTH.DEFAULT,
};

/** What the panel and its toggle draw, and their presses. */
export interface SidePanelControl {
  open: boolean;
  tab: SidePanelTab;
  /** The panel's width in CSS pixels, always within {@link SIDE_PANEL_WIDTH}. */
  width: number;
  onToggle: () => void;
  onChoose: (tab: SidePanelTab) => void;
  /** Asks for a width; it is clamped to the bounds before it is kept. */
  onResize: (width: number) => void;
}

function clampWidth(width: number): number {
  return Math.min(SIDE_PANEL_WIDTH.MAX, Math.max(SIDE_PANEL_WIDTH.MIN, Math.round(width)));
}

/** The kept preference, or the first launch's where none was kept or it no longer reads. */
function readStored(): SidePanelState {
  const stored = Option.getOrElse(
    decodeStored(window.localStorage.getItem(STORAGE_KEY)),
    () => FIRST_LAUNCH,
  );
  return { ...stored, width: clampWidth(stored.width) };
}

/**
 * Whether a key press is the panel's chord. The physical key is read rather
 * than the character, because Option turns B into "∫" on a Mac keyboard.
 */
export function isSidePanelChord(event: KeyboardEvent): boolean {
  return (
    event.code === "KeyB" && event.altKey && (event.metaKey || event.ctrlKey) && !event.shiftKey
  );
}

/**
 * The side panel's state, starting from `staged` where a fixture run stages
 * one and from the kept preference otherwise, and kept again on every change
 * outside a fixture run.
 */
export function useSidePanel(staged: SidePanelState | undefined): SidePanelControl {
  const [state, setState] = useState<SidePanelState>(() => staged ?? readStored());

  // Note that a write that fails (storage full, or refused) costs only the
  // preference, so it is not worth a word on screen.
  useEffect(() => {
    if (staged !== undefined) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, encodeStored(state));
    } catch {
      // The panel keeps working on the state it holds.
    }
  }, [staged, state]);

  const onToggle = useCallback(() => setState((held) => ({ ...held, open: !held.open })), []);
  const onChoose = useCallback(
    (tab: SidePanelTab) => setState((held) => ({ ...held, open: true, tab })),
    [],
  );
  const onResize = useCallback(
    (width: number) => setState((held) => ({ ...held, width: clampWidth(width) })),
    [],
  );
  return { ...state, onToggle, onChoose, onResize };
}
