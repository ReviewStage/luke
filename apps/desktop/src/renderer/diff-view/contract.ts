/**
 * contract.ts -- what the Files changed view and the diff bundle say to each other: the one mount call, and the handle the view redraws the diff through.
 *
 * A changed file's patch is drawn by Pierre's diffs (`@pierre/diffs`), with
 * Shiki colouring it, which is too large for the bundle every window parses,
 * so it ships as a bundle of its own (`diff-view.js`, built from
 * `./index.ts`) that the view loads the first time a diff is shown, as a File
 * tab loads its tree. That bundle sets one global, `window.lukeDiffView`, and
 * this file is the whole of what the two share: no Pierre type crosses, only
 * the patch as git writes it and how to draw it, and nothing here imports
 * anything, so the bundle carries none of the panel's libraries.
 */

/** How a diff is laid out: one column of lines, or the old side beside the new. */
export const DIFF_LAYOUT = {
  UNIFIED: "unified",
  SPLIT: "split",
} as const;

type DiffLayout = (typeof DIFF_LAYOUT)[keyof typeof DIFF_LAYOUT];

/** How a diff is drawn: its layout, whether a changed line marks the words it changed, and the File tabs' numbers and wrap. */
export interface DiffLook {
  readonly layout: DiffLayout;
  readonly changedWords: boolean;
  readonly lineNumbers: boolean;
  readonly wrap: boolean;
}

/** Which side of a diff a selected line is counted on: the old side's, a removed line's, or the new side's. */
export const DIFF_SELECTION_SIDE = {
  DELETIONS: "deletions",
  ADDITIONS: "additions",
} as const;

/** The lines lit in a diff, from a line on one side to a line on either, as a review thread's are. */
export interface DiffSelection {
  readonly start: number;
  readonly side: (typeof DIFF_SELECTION_SIDE)[keyof typeof DIFF_SELECTION_SIDE];
  readonly end: number;
  readonly endSide: (typeof DIFF_SELECTION_SIDE)[keyof typeof DIFF_SELECTION_SIDE];
}

/** What the view hands the bundle: one file's patch, headed as git writes one, how to draw it, the lines lit in it, if any, and whether it is an excerpt. */
export interface DiffViewProps {
  readonly patch: string;
  readonly look: DiffLook;
  readonly selected?: DiffSelection | undefined;
  /** Whether the patch is an excerpt, a few lines of a file as a review thread's, drawn with nothing said of the lines around them. */
  readonly excerpt?: boolean | undefined;
}

/** The diff as mounted: drawn again for new props, and taken down. */
export interface DiffViewHandle {
  readonly update: (props: DiffViewProps) => void;
  readonly unmount: () => void;
}

/** What the diff bundle sets on `window` once it has loaded. */
export interface DiffViewModule {
  /**
   * Draws the patch under `host`, in a shadow root whose words the tab's
   * find reads (`../find-matches.ts`'s `FIND_SHADOW_ATTRIBUTE`).
   */
  readonly mount: (host: HTMLElement, props: DiffViewProps) => DiffViewHandle;
}

declare global {
  interface Window {
    lukeDiffView?: DiffViewModule;
  }
}

/** The file the diff bundle is, beside `index.html`: an ES module, whose chunks (a language's grammar, a theme) it imports as it needs them. */
export const DIFF_VIEW_ASSET = { SCRIPT: "diff-view.js" } as const;
