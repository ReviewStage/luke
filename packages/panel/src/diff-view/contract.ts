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
 * contract.ts -- what the Files changed view and the diff bundle say to each other: a mount for one patch and one for a list of files, and the handles the view redraws them through.
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

/** Whether two looks draw a diff alike: every setting the same, each appearance's theme among them. */
export function sameLook(a: DiffLook, b: DiffLook): boolean {
  return (
    a.layout === b.layout &&
    a.indicators === b.indicators &&
    a.inlineDiff === b.inlineDiff &&
    a.backgrounds === b.backgrounds &&
    a.lineNumbers === b.lineNumbers &&
    a.wrap === b.wrap &&
    a.themes.dark === b.themes.dark &&
    a.themes.light === b.themes.light &&
    a.font === b.font &&
    a.fontSize === b.fontSize &&
    a.lineHeight === b.lineHeight &&
    a.ligatures === b.ligatures
  );
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

/** Whether two runs of notes stand under the same lines by the same keys. */
export function sameNotes(a: readonly DiffAnnotation[], b: readonly DiffAnnotation[]): boolean {
  return (
    a.length === b.length &&
    a.every((note, at) => {
      const other = b[at];
      return (
        other !== undefined &&
        note.key === other.key &&
        note.side === other.side &&
        note.line === other.line
      );
    })
  );
}

/** What the view hands the bundle: one file's patch, headed as git writes one, how to draw it, the lines lit in it, if any, and whether it is an excerpt. */
export interface DiffViewProps {
  readonly patch: string;
  readonly look: DiffLook;
  readonly selected?: DiffSelection | undefined;
  /** Whether the patch is an excerpt, a few lines of a file as a review thread's, drawn with nothing said of the lines around them. */
  readonly excerpt?: boolean | undefined;
}

/**
 * The line a note stands on to stand above a file's first hunk rather than
 * under a line: Pierre's own place for a note on the whole file, which is
 * drawn under the file's header whether or not the file has any hunks.
 */
export const FILE_NOTE_LINE = 0;

/** One file of a list: its path, which keys it; its patch, headed as git writes one, with no hunks where it has none to draw; whether only its header is drawn; its notes; and whether those notes stand in the place of its lines. */
export interface DiffListFile {
  readonly path: string;
  readonly patch: string;
  readonly collapsed: boolean;
  readonly annotations: readonly DiffAnnotation[];
  /**
   * Whether the file draws no lines of its own, only what stands in their
   * place: its notes on the whole file (`FILE_NOTE_LINE`), drawn across the
   * whole of its width, which say why it has no lines or show what it is.
   */
  readonly lead: boolean;
  /** Whether the lines between the file's hunks may be opened, its text read whole the first time one is (`DiffListProps.readTexts`). */
  readonly expandable: boolean;
  /** The file's whole text before and after, where it is drawn whole, every unchanged line among its changes; none draws its hunks. */
  readonly whole?: DiffFileTexts | undefined;
}

/** Lines lit in one file of a list: the file, by its path, and the lines. */
export interface DiffListSelection {
  readonly path: string;
  readonly selection: DiffSelection;
}

/**
 * What the view hands the bundle for a list of files: the files in order,
 * how to draw them, the element each file's header is drawn in and each
 * note, both kept by the view and filled by it, and the door told which file
 * stands at the top of the list as it scrolls. Where lines may be commented
 * on, `onComment` is told the lines a press of the gutter's + picked, on a
 * file that draws lines of its own, and `selected` lights the lines being
 * commented on; with no `onComment` the gutter offers nothing.
 */
export interface DiffListProps {
  readonly files: readonly DiffListFile[];
  readonly look: DiffLook;
  readonly renderHeader: (path: string) => HTMLElement;
  readonly renderAnnotation: (path: string, key: string) => HTMLElement;
  readonly onTopFile: (path: string) => void;
  readonly onComment?: ((picked: DiffListSelection) => void) | undefined;
  readonly selected?: DiffListSelection | undefined;
  /** Reads a file's whole text on both sides, the first time the lines between its hunks are asked for; none offers no such lines. */
  readonly readTexts?: ((path: string) => Promise<DiffFileTexts | undefined>) | undefined;
}

/** How many unchanged lines one press of a gap's arrow opens, as GitHub's diff opens them. */
export const GAP_LINES = 20;

/** A changed file's whole text before and after, which the lines between its hunks are drawn from; none where it could not be read whole. */
export interface DiffFileTexts {
  readonly before: string;
  readonly after: string;
}

/** Whether two lists light the same lines of the same file, or both none. */
export function sameListSelection(
  a: DiffListSelection | undefined,
  b: DiffListSelection | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.path === b.path &&
    a.selection.start === b.selection.start &&
    a.selection.side === b.selection.side &&
    a.selection.end === b.selection.end &&
    a.selection.endSide === b.selection.endSide
  );
}

/** The list as mounted: drawn again for new props, scrolled to a file's header, and taken down. */
export interface DiffListHandle {
  readonly update: (props: DiffListProps) => void;
  readonly reveal: (path: string) => void;
  readonly unmount: () => void;
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
  /**
   * Draws the files under `host`, which is the list's scroller, each in a
   * shadow root of its own the tab's find reads, only those near the view
   * drawn at all.
   */
  readonly mountList: (host: HTMLElement, props: DiffListProps) => DiffListHandle;
}
