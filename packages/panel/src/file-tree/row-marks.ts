import type { FileTree, FileTreeRowDecoration } from "@pierre/trees";
import type { FileMark } from "./contract.js";

const PART = {
  SPEECH: 0,
  THREADS: 1,
  ADDED: 2,
  REMOVED: 3,
  VIEWED: 4,
} as const;

const TOGGLE_ROLE = "checkbox";

const MARK_WORDS = {
  VIEWED: "Viewed",
  threads: (count: number) => (count === 1 ? "1 comment" : `${count} comments`),
  lines: (additions: number, deletions: number) =>
    `${additions} ${additions === 1 ? "line" : "lines"} added, ${deletions} removed`,
} as const;

const PART_COLOR = {
  THREADS: "var(--ui-color-text-muted)",
  ADDED: "var(--ui-color-complete)",
  REMOVED: "var(--ui-color-danger-text)",
  VIEWED: "var(--ui-color-complete)",
  UNVIEWED: "var(--ui-color-text-muted)",
} as const;

const GLYPH = {
  SPEECH:
    '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>',
  CIRCLE: '<circle cx="12" cy="12" r="10"/>',
  CHECKED: '<circle cx="12" cy="12" r="10"/><path d="m16 9-5.5 5.5L8 12"/>',
} as const;

function maskOf(shapes: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shapes}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const LANE = '[data-type="item"] > [data-item-section="decoration"]';
const RUN = `${LANE} > span`;

function part(at: number): string {
  return `${RUN} > span:nth-child(${at + 1})`;
}

const TOGGLE = `span:nth-child(${PART.VIEWED + 1})`;
const TICKED = `${TOGGLE}:not(:empty)`;

const REACHED = '[data-type="item"]:is(:hover, [data-item-focused])';

const VIEWED_ROW = `[data-type="item"]:has(> [data-item-section="decoration"] > span > ${TICKED})`;

const ROW_GROUND =
  "linear-gradient(var(--truncate-marker-background-overlay-color, transparent), var(--truncate-marker-background-overlay-color, transparent)), var(--truncate-marker-background-color, transparent)";

const NAME = '[data-type="item"] > [data-item-section="content"]';
const HALVES = `${NAME} [data-truncate-group-container="middle"]`;
const CUT = `${NAME} [data-truncate-container]`;
const CUT_MARK = `${CUT} [data-truncate-marker]`;
const FOLDERS = `${NAME} [data-item-flattened-subitems] > [data-item-flattened-subitem]`;

const OPEN_ROW = '[data-type="item"][data-item-selected="true"]';

const SHEET = `
${OPEN_ROW} { box-shadow: 0 0 0 1px var(--ui-color-border), 0 1px 2px var(--ui-color-shadow-soft); }
${HALVES} > div:first-child, ${FOLDERS} { flex: 0 1 max-content; min-width: 0; }
${HALVES} > div:last-child, ${FOLDERS}:last-child { flex: 0 999999 max-content; min-width: 0; }
${CUT}[data-truncate-container="fruncate"] [data-truncate-content] { direction: ltr; }
${CUT_MARK} { right: 0; left: auto; width: var(--ui-label-fade); color: transparent; mask-image: linear-gradient(to right, transparent, #000); }
${CUT_MARK}::before, ${CUT_MARK}::after { content: none; }
[data-file-tree-virtualized-scroll], [data-file-tree-scrollbar-measure] { scrollbar-width: thin; }
${LANE}:has(> span > span) { position: relative; overflow: visible; }
${LANE}:has(> span > ${TICKED}) { min-width: calc(var(--ui-space-4) + var(--ui-space-12)); }
${RUN} { flex-wrap: wrap; justify-content: flex-end; align-content: flex-start; height: 1lh; column-gap: var(--ui-space-4); font-variant-numeric: tabular-nums; }
${RUN} > span { display: inline-flex; flex: none; height: 100%; align-items: center; }
${RUN} > span:empty { display: none; }
${part(PART.SPEECH)}:has(+ span:not(:empty)) { display: inline-flex; margin-inline-end: calc(var(--ui-space-2) - var(--ui-space-4)); }
${part(PART.SPEECH)}::before { content: ""; width: 1em; height: 1em; background: currentColor; mask: ${maskOf(GLYPH.SPEECH)} center / contain no-repeat; }
${part(PART.VIEWED)}, ${part(PART.VIEWED)}:empty { position: absolute; inset-block: 0; inset-inline-end: 0; display: none; padding-inline-start: var(--ui-space-4); background: ${ROW_GROUND}; font-size: 0; cursor: default; }
${part(PART.VIEWED)}::before { content: ""; width: var(--ui-space-12); height: var(--ui-space-12); background: currentColor; mask: ${maskOf(GLYPH.CHECKED)} center / contain no-repeat; }
${part(PART.VIEWED)}:empty::before { mask-image: ${maskOf(GLYPH.CIRCLE)}; }
${REACHED} > [data-item-section="decoration"] > span > ${TOGGLE}, ${RUN} > ${TICKED} { display: inline-flex; }
${REACHED} > [data-item-section="decoration"]:has(> span > ${TOGGLE}) > span > span:not(:nth-child(${PART.VIEWED + 1})), ${RUN}:has(> ${TICKED}) > span:not(:nth-child(${PART.VIEWED + 1})) { visibility: hidden; }
${VIEWED_ROW}:not([data-item-selected]) { opacity: 0.6; }
`;

let sheet: CSSStyleSheet | undefined;

const watched = new WeakSet<ShadowRoot>();

function nameToggles(root: ShadowRoot): void {
  for (const toggle of root.querySelectorAll<HTMLElement>(part(PART.VIEWED))) {
    toggle.setAttribute("role", TOGGLE_ROLE);
    toggle.setAttribute("aria-label", MARK_WORDS.VIEWED);
    toggle.setAttribute("aria-checked", String(toggle.textContent !== ""));
  }
}

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

export function dress(tree: FileTree): void {
  const root = tree.getFileTreeContainer()?.shadowRoot;
  if (root === null || root === undefined) return;
  watchToggles(root);
  if (root.adoptedStyleSheets === undefined) return;
  if (sheet === undefined) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(SHEET);
  }
  if (!root.adoptedStyleSheets.includes(sheet)) {
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
  }
}

function counted(count: number, sign: string): string {
  return count > 0 ? `${sign}${count}` : "";
}

export function rowDecoration(mark: FileMark | undefined): FileTreeRowDecoration | null {
  if (mark === undefined) return null;
  const threads = mark.threads ?? 0;
  const viewed = mark.viewed;
  if (threads === 0 && mark.lines === undefined && viewed === undefined) return null;
  const additions = mark.lines?.additions ?? 0;
  const deletions = mark.lines?.deletions ?? 0;
  const parts = [
    { text: "", color: PART_COLOR.THREADS },
    { text: counted(threads, ""), color: PART_COLOR.THREADS },
    { text: counted(additions, "+"), color: PART_COLOR.ADDED },
    { text: counted(deletions, "−"), color: PART_COLOR.REMOVED },
  ];
  if (viewed !== undefined) {
    parts.push({
      text: viewed ? MARK_WORDS.VIEWED : "",
      color: viewed ? PART_COLOR.VIEWED : PART_COLOR.UNVIEWED,
    });
  }
  const said = [
    threads > 0 ? MARK_WORDS.threads(threads) : undefined,
    mark.lines === undefined ? undefined : MARK_WORDS.lines(additions, deletions),
    viewed === true ? MARK_WORDS.VIEWED : undefined,
  ].filter((words) => words !== undefined);
  return { text: parts.map((each) => each.text).join(""), title: said.join(" · "), parts };
}

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
