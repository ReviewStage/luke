import type {
  DIFF_FONT,
  DIFF_FONT_SIZES,
  DIFF_INDICATORS,
  DIFF_LINE_HEIGHT,
  DIFF_THEMES,
  DiffLayout,
  INLINE_DIFF,
} from "@luke/settings/diff-view";

/**
 * contract.ts -- what the Files changed view and the diff bundle say to each other: the one mount call, and the handle the view redraws the diff through.
 *
 * A changed file's patch is drawn by Pierre's diffs (`@pierre/diffs`), with
 * Shiki colouring it, which is too large for the bundle every window parses,
 * so it ships as a bundle of its own (`diff-view.js`, built from
 * `./index.ts`) that the view loads the first time a diff is shown, as a File
 * tab loads its tree. That bundle exports one module, `diffView`, and
 * this file is the whole of what the two share: no Pierre type crosses, only
 * the patch as git writes it and how to draw it, in the settings' own words
 * for a diff (`@luke/settings/diff-view`, which imports nothing), so the
 * bundle carries none of the panel's libraries.
 */

/**
 * How a diff is drawn, every setting of a review tool's diff: its layout,
 * how a changed line is marked and what of it, whether changed lines are
 * tinted, the File tabs' numbers and wrap, the theme each appearance is
 * coloured in, and its type.
 */
export interface DiffLook {
  readonly layout: DiffLayout;
  readonly indicators: (typeof DIFF_INDICATORS)[keyof typeof DIFF_INDICATORS];
  readonly inlineDiff: (typeof INLINE_DIFF)[keyof typeof INLINE_DIFF];
  readonly backgrounds: boolean;
  readonly lineNumbers: boolean;
  readonly wrap: boolean;
  readonly themes: {
    readonly dark: (typeof DIFF_THEMES.DARK)[number]["id"];
    readonly light: (typeof DIFF_THEMES.LIGHT)[number]["id"];
  };
  readonly font: (typeof DIFF_FONT)[keyof typeof DIFF_FONT];
  readonly fontSize: (typeof DIFF_FONT_SIZES)[number];
  readonly lineHeight: (typeof DIFF_LINE_HEIGHT)[keyof typeof DIFF_LINE_HEIGHT];
  readonly ligatures: boolean;
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

/** A note drawn under a line of the diff, a review thread's: its key, and the line it stands under on the side it counts on. */
export interface DiffAnnotation {
  readonly key: string;
  readonly side: DiffSelection["side"];
  readonly line: number;
}

/** What the view hands the bundle: one file's patch, headed as git writes one, how to draw it, the lines lit in it, if any, and whether it is an excerpt. */
export interface DiffViewProps {
  readonly patch: string;
  readonly look: DiffLook;
  readonly selected?: DiffSelection | undefined;
  /** Whether the patch is an excerpt, a few lines of a file as a review thread's, drawn with nothing said of the lines around them. */
  readonly excerpt?: boolean | undefined;
  /** The notes drawn under lines, each by its key, whose element `renderAnnotation` hands over; none for none. */
  readonly annotations?: readonly DiffAnnotation[] | undefined;
  /** The element a note's key is drawn in, kept by the view and filled by it, which the bundle stands under its line. */
  readonly renderAnnotation?: ((key: string) => HTMLElement) | undefined;
}

/** The diff as mounted: drawn again for new props, and taken down. */
export interface DiffViewHandle {
  readonly update: (props: DiffViewProps) => void;
  readonly unmount: () => void;
}

/** What the diff bundle's entry exports, which the panel imports the first time it is needed (`../bundle-loader.ts`). */
export interface DiffViewModule {
  /**
   * Draws the patch under `host`, in a shadow root whose words the tab's
   * find reads (`../find-matches.ts`'s `FIND_SHADOW_ATTRIBUTE`).
   */
  readonly mount: (host: HTMLElement, props: DiffViewProps) => DiffViewHandle;
}
