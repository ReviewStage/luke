import type { FileTree, FileTreeRowDecoration } from "@pierre/trees";
import type { FileMark } from "./contract.js";

/**
 * row-marks.ts -- what a pull request's file row says at its end, past what became of it: its review threads, the lines it adds and removes, and its Viewed toggle, as stage-cli's tree draws them; and the sheet the tree draws them by.
 *
 * Pierre draws one decoration in each row's lane, a run of words in the
 * colours given, so a file's are drawn as one run of four parts in a fixed
 * order (`PART`): the threads standing on it, counted beside a speech mark;
 * the lines it adds; the lines it removes; and its Viewed toggle. A part
 * with nothing to say holds no words, and the sheet draws no room for it.
 * The sheet draws the speech mark and the toggle's circle, ticked once the
 * file is viewed, as Lucide's `MessageSquare`, `Circle`, and `CircleCheck`,
 * and finds each part by its place in the run; it dims a viewed file's
 * row, as stage-cli does, shows a toggle not yet ticked only while its row
 * is hovered or holds the keyboard, and draws the lines only where the
 * row's name leaves room for them. A folder's row says nothing more.
 *
 * Note that the sheet is adopted by the tree's shadow root as a
 * constructed sheet rather than handed to Pierre's `unsafeCSS`, because
 * Pierre writes that into a `<style>` element, which the panel's policy
 * (`style-src 'self'`, `index.html`) refuses, as it admits a constructed
 * sheet (`../terminal/adopted-styles.ts`). Pierre adopts its own sheet each
 * time its element joins the document, in this one's place, so the tree
 * adopts it again after each time it moves one (`dress`).
 */

/** Each part's place in a file's run of words. */
const PART = {
  THREADS: 0,
  ADDED: 1,
  REMOVED: 2,
  VIEWED: 3,
} as const;

/** What a part says, read out in the run's hint. */
const MARK_WORDS = {
  VIEWED: "Viewed",
  threads: (count: number) => (count === 1 ? "1 comment" : `${count} comments`),
  lines: (additions: number, deletions: number) =>
    `${additions} ${additions === 1 ? "line" : "lines"} added, ${deletions} removed`,
} as const;

/** The colour each part is drawn in, the panel's own, which the tree's shadow root inherits. */
const PART_COLOUR = {
  THREADS: "var(--luke-color-text-muted)",
  ADDED: "var(--luke-color-complete)",
  REMOVED: "var(--luke-color-danger-text)",
  VIEWED: "var(--luke-color-complete)",
  UNVIEWED: "var(--luke-color-text-muted)",
} as const;

/** Lucide's glyphs as masks, stroked as every Lucide glyph in the window is. */
const GLYPH = {
  SPEECH:
    '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>',
  CIRCLE: '<circle cx="12" cy="12" r="10"/>',
  CHECKED: '<circle cx="12" cy="12" r="10"/><path d="m16 9-5.5 5.5L8 12"/>',
} as const;

/** A glyph as the address a mask draws it from. */
function maskOf(shapes: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shapes}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * The room each part the lane never gives up takes, with the gap before
 * it: a count of up to two figures beside its mark, and the toggle. The
 * lane takes the room the name leaves, never less than these need, the
 * name cut short before them.
 */
const LEAST = {
  THREADS: "var(--luke-space-4) + 1em + var(--luke-space-2) + 2ch",
  VIEWED: "var(--luke-space-4) + var(--luke-space-12)",
} as const;

/**
 * The order the run lays its parts in from the row's end, which is the
 * order it gives them up in where the lane runs short: the lines first,
 * as one line of a run that wraps, its second line out of sight. So the
 * run reads as stage-cli's does, the lines, the threads, then the toggle.
 */
const FROM_END = {
  [PART.VIEWED]: 0,
  [PART.THREADS]: 1,
  [PART.REMOVED]: 2,
  [PART.ADDED]: 3,
} as const;

/** A decorated row's lane, and the run of words in it. */
const LANE = '[data-type="item"] > [data-item-section="decoration"]';
const RUN = `${LANE} > span`;

/** One part of a row's run, by its place. */
function part(at: number): string {
  return `${RUN} > span:nth-child(${at + 1})`;
}

/** A run's threads where any stand on its file, and its toggle where it draws one. */
const THREADS_SHOWN = `span:nth-child(${PART.THREADS + 1}):not(:empty)`;
const TOGGLE_SHOWN = `span:nth-child(${PART.VIEWED + 1})`;

/** A row whose toggle is ticked. */
const VIEWED_ROW = `[data-type="item"]:has(> [data-item-section="decoration"] > span > span:nth-child(${PART.VIEWED + 1}):not(:empty))`;

/**
 * The rules the tree draws by: the window's thin scrollbar, whose colour
 * inherits into Pierre's shadow root and whose width does not, so it is set
 * here on the scroller and on the box Pierre measures that scroller's
 * gutter from; and each file's run.
 */
const SHEET = `
[data-file-tree-virtualized-scroll], [data-file-tree-scrollbar-measure] { scrollbar-width: thin; }
${LANE}:has(> span > ${THREADS_SHOWN}) { min-width: calc(${LEAST.THREADS}); }
${LANE}:has(> span > ${TOGGLE_SHOWN}) { min-width: calc(${LEAST.VIEWED}); }
${LANE}:has(> span > ${THREADS_SHOWN}):has(> span > ${TOGGLE_SHOWN}) { min-width: calc(${LEAST.THREADS} + ${LEAST.VIEWED}); }
${RUN} { flex-direction: row-reverse; flex-wrap: wrap; justify-content: flex-start; align-content: flex-start; height: 1lh; column-gap: var(--luke-space-4); font-variant-numeric: tabular-nums; }
${RUN} > span { display: inline-flex; flex: none; height: 100%; align-items: center; gap: var(--luke-space-2); }
${RUN} > span:empty { display: none; }
${Object.entries(FROM_END)
  .map(([at, order]) => `${part(Number(at))} { order: ${order}; }`)
  .join("\n")}
${part(PART.THREADS)}::before { content: ""; width: 1em; height: 1em; background: currentColor; mask: ${maskOf(GLYPH.SPEECH)} center / contain no-repeat; }
${part(PART.VIEWED)}, ${part(PART.VIEWED)}:empty { display: inline-flex; font-size: 0; cursor: default; }
${part(PART.VIEWED)}::before { content: ""; width: var(--luke-space-12); height: var(--luke-space-12); background: currentColor; mask: ${maskOf(GLYPH.CHECKED)} center / contain no-repeat; }
${part(PART.VIEWED)}:empty::before { mask-image: ${maskOf(GLYPH.CIRCLE)}; }
[data-type="item"]:not(:hover, [data-item-focused]) > [data-item-section="decoration"] > span > span:nth-child(${PART.VIEWED + 1}):empty { visibility: hidden; }
${VIEWED_ROW}:not([data-item-selected]) { opacity: 0.6; }
`;

/** The sheet, made the first time a tree is dressed, where the document can make one. */
let sheet: CSSStyleSheet | undefined;

/**
 * Adopts the tree's sheet into its shadow root wherever it is not adopted
 * there, beside Pierre's own; call it each time the tree's element joins the
 * document, since Pierre then adopts its own sheet alone.
 */
export function dress(tree: FileTree): void {
  const root = tree.getFileTreeContainer()?.shadowRoot;
  // Note that a document that adopts no sheets, as jsdom's, draws the run unstyled.
  if (root?.adoptedStyleSheets === undefined) return;
  if (sheet === undefined) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(SHEET);
  }
  if (!root.adoptedStyleSheets.includes(sheet)) {
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  }
}

/** The words of a count, none where there is nothing to count. */
function counted(count: number, sign: string): string {
  return count > 0 ? `${sign}${count}` : "";
}

/**
 * A file's run of words at the end of its row, from its mark, or none where
 * it has nothing to say past what became of it; the toggle is drawn only
 * where the mark says whether the file is viewed.
 */
export function rowDecoration(mark: FileMark | undefined): FileTreeRowDecoration | null {
  if (mark === undefined) return null;
  const threads = mark.threads ?? 0;
  const viewed = mark.viewed;
  if (threads === 0 && mark.lines === undefined && viewed === undefined) return null;
  const additions = mark.lines?.additions ?? 0;
  const deletions = mark.lines?.deletions ?? 0;
  const parts = [
    { text: counted(threads, ""), color: PART_COLOUR.THREADS },
    { text: counted(additions, "+"), color: PART_COLOUR.ADDED },
    { text: counted(deletions, "−"), color: PART_COLOUR.REMOVED },
  ];
  if (viewed !== undefined) {
    parts.push({
      text: viewed ? MARK_WORDS.VIEWED : "",
      color: viewed ? PART_COLOUR.VIEWED : PART_COLOUR.UNVIEWED,
    });
  }
  const said = [
    threads > 0 ? MARK_WORDS.threads(threads) : undefined,
    mark.lines === undefined ? undefined : MARK_WORDS.lines(additions, deletions),
    viewed === true ? MARK_WORDS.VIEWED : undefined,
  ].filter((words) => words !== undefined);
  return { text: parts.map((each) => each.text).join(""), title: said.join(" · "), parts };
}

/**
 * The file whose Viewed toggle a press landed on, by its path as the tree
 * names it, read through the tree's shadow root: the part of its row's run
 * standing at the toggle's place.
 */
export function pressedToggle(event: Event): string | undefined {
  const path = event.composedPath();
  const lane = path.findIndex(
    (target) => target instanceof HTMLElement && target.dataset.itemSection === "decoration",
  );
  const pressed = path[lane - 2];
  const row = path[lane + 1];
  if (lane < 2 || !(pressed instanceof HTMLElement) || !(row instanceof HTMLElement))
    return undefined;
  const at = Array.prototype.indexOf.call(pressed.parentElement?.children ?? [], pressed);
  return at === PART.VIEWED && row.dataset.itemType === "file" ? row.dataset.itemPath : undefined;
}
