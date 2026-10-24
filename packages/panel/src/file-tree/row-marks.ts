import type { FileTree, FileTreeRowDecoration } from "@pierre/trees";
import type { FileMark } from "./contract.js";

/**
 * row-marks.ts -- what a pull request's file row says at its end, past what became of it: its review threads, the lines it adds and removes, and its Viewed toggle, as stage-cli's tree draws them; and the sheet the tree draws them by.
 *
 * Pierre draws one decoration in each row's lane, a run of words in the
 * colours given, so a file's are drawn as one run of five parts in a fixed
 * order (`PART`): a speech mark and the count of the threads standing on
 * it; the lines it adds; the lines it removes; and its Viewed toggle. A
 * part with nothing to say holds no words, and the sheet draws no room for
 * it. The sheet draws the speech mark and the toggle's circle, ticked once
 * the file is viewed, as Lucide's `MessageSquare`, `Circle`, and
 * `CircleCheck`, and finds each part by its place in the run.
 *
 * The name comes first: the lane holds only the room the name leaves, as
 * Pierre lays it out, so no mark ever cuts a name short. Where that room
 * runs out the run gives up its parts from its end, one line of a run that
 * wraps with its second line out of sight: the lines removed, then the
 * lines added, then the count, then the speech mark. The toggle takes no
 * room of its own while the row is hovered or holds the keyboard: it
 * stands over the run's end, the row's ground behind it, in place of the
 * counts. Once ticked it stands there always, in room the lane keeps for
 * it, so a viewed file's name is cut short before it rather than under
 * it, and the row is dimmed, as stage-cli dims a viewed file. A folder's
 * row says nothing more.
 *
 * A name cut short fades out at its end, as a cut label does across the
 * window (`@luke/ui`'s OneLine), rather than losing its middle to Pierre's
 * ellipsis: Pierre cuts a name in two halves and empties the first before
 * the second, and the sheet empties the second first, cuts it at its end
 * rather than its start, and draws Pierre's marker, which stands only where
 * a half is cut, as the row's ground fading in over its last letters. A
 * folder row naming several folders (`db / schema`) gives up its last
 * folder first, the same way.
 *
 * The toggle is a control a reader can find and press: Pierre draws each
 * part as a bare span with only its colour, so the tree names every toggle
 * after each drawing, as a checkbox named Viewed, checked once the file is
 * viewed (`nameToggles`), and a press on it, a reader's own among them, is
 * heard by the tree (`pressedToggle`).
 *
 * Note that the sheet is adopted by the tree's shadow root as a
 * constructed sheet rather than handed to Pierre's `unsafeCSS`, because
 * Pierre writes that into a `<style>` element, which the panel's policy
 * (`style-src 'self'`: the desktop's `renderer/index.html` and the web's
 * `vercel.json`) refuses, as it admits a constructed sheet
 * (`../terminal/adopted-styles.ts`). Pierre adopts its own sheet each
 * time its element joins the document, in this one's place, so the tree
 * adopts it again after each time it moves one (`dress`).
 */

/** Each part's place in a file's run of words. */
const PART = {
  SPEECH: 0,
  THREADS: 1,
  ADDED: 2,
  REMOVED: 3,
  VIEWED: 4,
} as const;

/** The role a Viewed toggle plays for a reader: ticked or not, as a review's checkbox. */
const TOGGLE_ROLE = "checkbox";

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

/** A decorated row's lane, and the run of words in it. */
const LANE = '[data-type="item"] > [data-item-section="decoration"]';
const RUN = `${LANE} > span`;

/** One part of a row's run, by its place. */
function part(at: number): string {
  return `${RUN} > span:nth-child(${at + 1})`;
}

/** The toggle, and the toggle once ticked, as a part of a run. */
const TOGGLE = `span:nth-child(${PART.VIEWED + 1})`;
const TICKED = `${TOGGLE}:not(:empty)`;

/** A row in reach of the pointer or the keyboard, which draws a toggle not yet ticked. */
const REACHED = '[data-type="item"]:is(:hover, [data-item-focused])';

/** A row whose toggle is ticked. */
const VIEWED_ROW = `[data-type="item"]:has(> [data-item-section="decoration"] > span > ${TICKED})`;

/**
 * The row's ground as it stands, hovered or chosen, which Pierre paints
 * behind a name it cuts short and the toggle paints behind itself.
 */
const ROW_GROUND =
  "linear-gradient(var(--truncate-marker-background-overlay-color, transparent), var(--truncate-marker-background-overlay-color, transparent)), var(--truncate-marker-background-color, transparent)";

/** A row's name, Pierre's two halves of one, a half, and Pierre's mark where a half is cut. */
const NAME = '[data-type="item"] > [data-item-section="content"]';
const HALVES = `${NAME} [data-truncate-group-container="middle"]`;
const CUT = `${NAME} [data-truncate-container]`;
const CUT_MARK = `${CUT} [data-truncate-marker]`;
const FOLDERS = `${NAME} [data-item-flattened-subitems] > [data-item-flattened-subitem]`;

/** The open file's row, the one the tree marks chosen (`folder-browser.ts`'s `markAlone`). */
const OPEN_ROW = '[data-type="item"][data-item-selected="true"]';

/**
 * The rules the tree draws by: the open file's row lifted by a hairline and
 * a soft shadow over the ground the host gives it, as `@luke/ui`'s ListRow
 * draws a list's open row; a cut name's fade at its end; the window's thin scrollbar, whose colour
 * inherits into Pierre's shadow root and whose width does not, so it is set
 * here on the scroller and on the box Pierre measures that scroller's
 * gutter from; and each file's run.
 */
const SHEET = `
${OPEN_ROW} { box-shadow: 0 0 0 1px var(--luke-color-border), 0 1px 2px var(--luke-color-shadow-soft); }
${HALVES} > div:first-child, ${FOLDERS} { flex: 0 1 max-content; min-width: 0; }
${HALVES} > div:last-child, ${FOLDERS}:last-child { flex: 0 999999 max-content; min-width: 0; }
${CUT}[data-truncate-container="fruncate"] [data-truncate-content] { direction: ltr; }
${CUT_MARK} { right: 0; left: auto; width: var(--luke-label-fade); color: transparent; mask-image: linear-gradient(to right, transparent, #000); }
${CUT_MARK}::before, ${CUT_MARK}::after { content: none; }
[data-file-tree-virtualized-scroll], [data-file-tree-scrollbar-measure] { scrollbar-width: thin; }
${LANE}:has(> span > span) { position: relative; overflow: visible; }
${LANE}:has(> span > ${TICKED}) { min-width: calc(var(--luke-space-4) + var(--luke-space-12)); }
${RUN} { flex-wrap: wrap; justify-content: flex-end; align-content: flex-start; height: 1lh; column-gap: var(--luke-space-4); font-variant-numeric: tabular-nums; }
${RUN} > span { display: inline-flex; flex: none; height: 100%; align-items: center; }
${RUN} > span:empty { display: none; }
${part(PART.SPEECH)}:has(+ span:not(:empty)) { display: inline-flex; margin-inline-end: calc(var(--luke-space-2) - var(--luke-space-4)); }
${part(PART.SPEECH)}::before { content: ""; width: 1em; height: 1em; background: currentColor; mask: ${maskOf(GLYPH.SPEECH)} center / contain no-repeat; }
${part(PART.VIEWED)}, ${part(PART.VIEWED)}:empty { position: absolute; inset-block: 0; inset-inline-end: 0; display: none; padding-inline-start: var(--luke-space-4); background: ${ROW_GROUND}; font-size: 0; cursor: default; }
${part(PART.VIEWED)}::before { content: ""; width: var(--luke-space-12); height: var(--luke-space-12); background: currentColor; mask: ${maskOf(GLYPH.CHECKED)} center / contain no-repeat; }
${part(PART.VIEWED)}:empty::before { mask-image: ${maskOf(GLYPH.CIRCLE)}; }
${REACHED} > [data-item-section="decoration"] > span > ${TOGGLE}, ${RUN} > ${TICKED} { display: inline-flex; }
${REACHED} > [data-item-section="decoration"]:has(> span > ${TOGGLE}) > span > span:not(:nth-child(${PART.VIEWED + 1})), ${RUN}:has(> ${TICKED}) > span:not(:nth-child(${PART.VIEWED + 1})) { visibility: hidden; }
${VIEWED_ROW}:not([data-item-selected]) { opacity: 0.6; }
`;

/** The sheet, made the first time a tree is dressed, where the document can make one. */
let sheet: CSSStyleSheet | undefined;

/** The shadow roots whose toggles are named each time Pierre draws in them. */
const watched = new WeakSet<ShadowRoot>();

/**
 * Names each Viewed toggle drawn under a tree's shadow root as the control
 * it is: a checkbox named Viewed, checked once its file is viewed, which the
 * part says by holding the word.
 */
function nameToggles(root: ShadowRoot): void {
  for (const toggle of root.querySelectorAll<HTMLElement>(part(PART.VIEWED))) {
    toggle.setAttribute("role", TOGGLE_ROLE);
    toggle.setAttribute("aria-label", MARK_WORDS.VIEWED);
    toggle.setAttribute("aria-checked", String(toggle.textContent !== ""));
  }
}

/**
 * Names a tree's toggles now and after each time Pierre draws in its shadow
 * root, once for each root. Note that only the parts' words and rows are
 * watched, never attributes, so naming a toggle wakes no second naming.
 */
function watchToggles(root: ShadowRoot): void {
  if (watched.has(root)) return;
  watched.add(root);
  new MutationObserver(() => nameToggles(root)).observe(root, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  nameToggles(root);
}

/**
 * Adopts the tree's sheet into its shadow root wherever it is not adopted
 * there, beside Pierre's own, and names its toggles as Pierre draws them;
 * call it each time the tree's element joins the document, since Pierre then
 * adopts its own sheet alone.
 */
export function dress(tree: FileTree): void {
  const root = tree.getFileTreeContainer()?.shadowRoot;
  if (root === null || root === undefined) return;
  watchToggles(root);
  // Note that a document that adopts no sheets, as jsdom's, draws the run unstyled.
  if (root.adoptedStyleSheets === undefined) return;
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
  // Note that the speech mark holds no words: the sheet draws it beside a count.
  const parts = [
    { text: "", color: PART_COLOUR.THREADS },
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
