import type {
  DIFF_FONT,
  DIFF_FONT_SIZES,
  DIFF_INDICATORS,
  DIFF_LINE_HEIGHT,
  DIFF_THEMES,
  DiffLayout,
  INLINE_DIFF,
} from "@repo/settings/diff-view";

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

export const DIFF_SELECTION_SIDE = {
  DELETIONS: "deletions",
  ADDITIONS: "additions",
} as const;

export interface DiffSelection {
  readonly start: number;
  readonly side: (typeof DIFF_SELECTION_SIDE)[keyof typeof DIFF_SELECTION_SIDE];
  readonly end: number;
  readonly endSide: (typeof DIFF_SELECTION_SIDE)[keyof typeof DIFF_SELECTION_SIDE];
}

export interface DiffAnnotation {
  readonly key: string;
  readonly side: DiffSelection["side"];
  readonly line: number;
}

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

export interface DiffViewProps {
  readonly patch: string;
  readonly look: DiffLook;
  readonly selected?: DiffSelection | undefined;
  readonly excerpt?: boolean | undefined;
  readonly annotations?: readonly DiffAnnotation[] | undefined;
  readonly renderAnnotation?: ((key: string) => HTMLElement) | undefined;
  readonly pooled?: boolean | undefined;
}

export const FILE_NOTE_LINE = 0;

export interface DiffListFile {
  readonly path: string;
  readonly patch: string;
  readonly collapsed: boolean;
  readonly annotations: readonly DiffAnnotation[];
  readonly lead: boolean;
  readonly expandable: boolean;
  readonly whole?: DiffFileTexts | undefined;
  readonly hidden?: readonly number[] | undefined;
}

export interface DiffListSelection {
  readonly path: string;
  readonly selection: DiffSelection;
}

export interface DiffTextRect {
  readonly top: number;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
}

export interface DiffTextSelection {
  readonly picked: DiffListSelection;
  readonly rect: DiffTextRect;
}

export interface DiffListProps {
  readonly files: readonly DiffListFile[];
  readonly look: DiffLook;
  readonly renderHeader: (path: string) => HTMLElement;
  readonly renderAnnotation: (path: string, key: string) => HTMLElement;
  readonly onTopFile: (path: string) => void;
  readonly onComment?: ((picked: DiffListSelection) => void) | undefined;
  readonly selected?: DiffListSelection | undefined;
  readonly onSelectText?: ((selected: DiffTextSelection | undefined) => void) | undefined;
  readonly readTexts?: ((path: string) => Promise<DiffFileTexts | undefined>) | undefined;
  readonly onDrawn?: ((path: string, lines: readonly number[]) => void) | undefined;
  readonly topRoom?: number | undefined;
}

export interface FileLineRange {
  readonly startLine: number;
  readonly endLine: number;
}

export interface FileAnnotation {
  readonly key: string;
  readonly line: number;
}

export function sameFileNotes(a: readonly FileAnnotation[], b: readonly FileAnnotation[]): boolean {
  return (
    a.length === b.length &&
    a.every((note, at) => note.key === b[at]?.key && note.line === b[at]?.line)
  );
}

export function sameFileLines(a: FileLineRange | undefined, b: FileLineRange | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.startLine === b.startLine && a.endLine === b.endLine;
}

export interface FileViewProps {
  readonly name: string;
  readonly text: string;
  readonly revision: string;
  readonly look: DiffLook;
  readonly lit?: FileLineRange | undefined;
  readonly annotations: readonly FileAnnotation[];
  readonly renderAnnotation: (key: string) => HTMLElement;
  readonly onDrawn?: (() => void) | undefined;
}

export interface FileViewHandle {
  readonly update: (props: FileViewProps) => void;
  readonly revealLines: (range: FileLineRange) => void;
  readonly pickedLines: () => FileLineRange | undefined;
  readonly unmount: () => void;
}

export const GAP_LINES = 20;

export const GAP_CONTROL_ATTRIBUTE = "data-gap-control";

export const GAP_CONTROL = {
  ALL: "all",
  MORE: "more",
} as const;

export function sameLines(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((line, at) => line === b[at]);
}

export interface DiffFileTexts {
  readonly before: string;
  readonly after: string;
}

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

export interface DiffLineSpan {
  readonly side: DiffSelection["side"];
  readonly startLine: number;
  readonly endLine: number;
}

export interface DiffLineRange extends DiffLineSpan {
  readonly path: string;
}

export interface DiffListHandle {
  readonly update: (props: DiffListProps) => void;
  readonly reveal: (path: string) => void;
  readonly revealLine: (path: string, side: DiffSelection["side"], line: number) => void;
  readonly revealLines: (range: DiffLineRange) => void;
  readonly unmount: () => void;
}

export interface DiffViewHandle {
  readonly update: (props: DiffViewProps) => void;
  readonly unmount: () => void;
}

export interface DiffViewModule {
  readonly mount: (host: HTMLElement, props: DiffViewProps) => DiffViewHandle;
  readonly mountList: (host: HTMLElement, props: DiffListProps) => DiffListHandle;
  readonly mountFile: (host: HTMLElement, props: FileViewProps) => FileViewHandle;
}
