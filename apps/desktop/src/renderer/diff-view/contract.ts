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

/** How a changed line is marked at its edge: with git's `+` and `-`, with a bar, or not at all. */
export const DIFF_INDICATORS = {
  CLASSIC: "classic",
  BARS: "bars",
  NONE: "none",
} as const;

/** What a changed line marks of what it changed: whole words joined across spaces, words, characters, or nothing. */
export const INLINE_DIFF = {
  WORD_ALT: "word-alt",
  WORD: "word",
  CHAR: "char",
  NONE: "none",
} as const;

/** The type a diff is set in, each a font every Mac has, so none is fetched: the window's own code type first. */
export const DIFF_FONT = {
  SF_MONO: "sf-mono",
  MENLO: "menlo",
  MONACO: "monaco",
  COURIER_NEW: "courier-new",
  ANDALE_MONO: "andale-mono",
} as const;

/** The sizes a diff's type is offered at, in pixels, the File tab's own 11.5 among them. */
export const DIFF_FONT_SIZES = ["10", "11", "11.5", "12", "13", "14", "15"] as const;

/** How tall a diff's line stands for its type: tighter than the File tab's, as tall, or roomier. */
export const DIFF_LINE_HEIGHT = {
  COMPACT: "compact",
  NORMAL: "normal",
  SPACIOUS: "spacious",
} as const;

/**
 * The syntax themes a diff may be coloured in, by Shiki's name and its own,
 * each appearance's apart, as Shiki's bundled themes and Pierre's two are;
 * the bundle fetches the one chosen as a chunk of its own.
 */
export const DIFF_THEMES = {
  DARK: [
    { id: "andromeeda", label: "Andromeeda" },
    { id: "aurora-x", label: "Aurora X" },
    { id: "ayu-dark", label: "Ayu Dark" },
    { id: "ayu-mirage", label: "Ayu Mirage" },
    { id: "catppuccin-frappe", label: "Catppuccin Frappé" },
    { id: "catppuccin-macchiato", label: "Catppuccin Macchiato" },
    { id: "catppuccin-mocha", label: "Catppuccin Mocha" },
    { id: "dark-plus", label: "Dark Plus" },
    { id: "dracula", label: "Dracula Theme" },
    { id: "dracula-soft", label: "Dracula Theme Soft" },
    { id: "everforest-dark", label: "Everforest Dark" },
    { id: "github-dark", label: "GitHub Dark" },
    { id: "github-dark-default", label: "GitHub Dark Default" },
    { id: "github-dark-dimmed", label: "GitHub Dark Dimmed" },
    { id: "github-dark-high-contrast", label: "GitHub Dark High Contrast" },
    { id: "gruvbox-dark-hard", label: "Gruvbox Dark Hard" },
    { id: "gruvbox-dark-medium", label: "Gruvbox Dark Medium" },
    { id: "gruvbox-dark-soft", label: "Gruvbox Dark Soft" },
    { id: "horizon", label: "Horizon" },
    { id: "houston", label: "Houston" },
    { id: "kanagawa-dragon", label: "Kanagawa Dragon" },
    { id: "kanagawa-wave", label: "Kanagawa Wave" },
    { id: "laserwave", label: "LaserWave" },
    { id: "material-theme", label: "Material Theme" },
    { id: "material-theme-darker", label: "Material Theme Darker" },
    { id: "material-theme-ocean", label: "Material Theme Ocean" },
    { id: "material-theme-palenight", label: "Material Theme Palenight" },
    { id: "min-dark", label: "Min Dark" },
    { id: "monokai", label: "Monokai" },
    { id: "night-owl", label: "Night Owl" },
    { id: "nord", label: "Nord" },
    { id: "one-dark-pro", label: "One Dark Pro" },
    { id: "pierre-dark", label: "Pierre Dark" },
    { id: "plastic", label: "Plastic" },
    { id: "poimandres", label: "Poimandres" },
    { id: "red", label: "Red" },
    { id: "rose-pine", label: "Rosé Pine" },
    { id: "rose-pine-moon", label: "Rosé Pine Moon" },
    { id: "slack-dark", label: "Slack Dark" },
    { id: "solarized-dark", label: "Solarized Dark" },
    { id: "synthwave-84", label: "Synthwave '84" },
    { id: "tokyo-night", label: "Tokyo Night" },
    { id: "vesper", label: "Vesper" },
    { id: "vitesse-black", label: "Vitesse Black" },
    { id: "vitesse-dark", label: "Vitesse Dark" },
  ],
  LIGHT: [
    { id: "ayu-light", label: "Ayu Light" },
    { id: "catppuccin-latte", label: "Catppuccin Latte" },
    { id: "everforest-light", label: "Everforest Light" },
    { id: "github-light", label: "GitHub Light" },
    { id: "github-light-default", label: "GitHub Light Default" },
    { id: "github-light-high-contrast", label: "GitHub Light High Contrast" },
    { id: "gruvbox-light-hard", label: "Gruvbox Light Hard" },
    { id: "gruvbox-light-medium", label: "Gruvbox Light Medium" },
    { id: "gruvbox-light-soft", label: "Gruvbox Light Soft" },
    { id: "horizon-bright", label: "Horizon Bright" },
    { id: "kanagawa-lotus", label: "Kanagawa Lotus" },
    { id: "light-plus", label: "Light Plus" },
    { id: "material-theme-lighter", label: "Material Theme Lighter" },
    { id: "min-light", label: "Min Light" },
    { id: "night-owl-light", label: "Night Owl Light" },
    { id: "one-light", label: "One Light" },
    { id: "pierre-light", label: "Pierre Light" },
    { id: "rose-pine-dawn", label: "Rosé Pine Dawn" },
    { id: "slack-ochin", label: "Slack Ochin" },
    { id: "snazzy-light", label: "Snazzy Light" },
    { id: "solarized-light", label: "Solarized Light" },
    { id: "vitesse-light", label: "Vitesse Light" },
  ],
} as const;

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
