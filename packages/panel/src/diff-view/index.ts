import { DIFF_LAYOUT } from "@luke/settings/diff-view";
import {
  CodeView,
  type CodeViewDiffItem,
  type CodeViewOptions,
  type DiffLineAnnotation,
  type FileContents,
  type FileDiffMetadata,
  type FileDiffOptions,
  getFiletypeFromFileName,
  getSharedHighlighter,
  getSingularPatch,
  type File as PierreFile,
  FileDiff as PierreFileDiff,
  type PostRenderPhase,
  parsePatchFiles,
  renderFileWithHighlighter,
  type SelectedLineRange,
} from "@pierre/diffs";
import { FONT_STACK, LIGATURES, LINE_HEIGHT_RATIO } from "../code-type.js";
import { FIND_SHADOW_ATTRIBUTE } from "../find-matches.js";
import { colouredFrom } from "./colour-lines.js";
import {
  type ColouredLines,
  type ColourRequest,
  DIFF_SELECTION_SIDE,
  type DiffAnnotation,
  type DiffListFile,
  type DiffListHandle,
  type DiffListProps,
  type DiffListSelection,
  type DiffLook,
  type DiffSelection,
  type DiffTextSelection,
  type DiffViewHandle,
  type DiffViewModule,
  type DiffViewProps,
  GAP_LINES,
  sameLines,
  sameListSelection,
  sameLook,
  sameNotes,
} from "./contract.js";
import { drawnAmong, drawnTeller } from "./drawn-lines.js";
import { HIGHLIGHT_MODE, type Highlighting, startHighlighting } from "./highlight-pool.js";
import { adoptShadowStyles } from "./inline-styles.js";
import { pressedOnCode, selectedLines, selectionRect } from "./text-selection.js";
import { wholeOf } from "./whole-diff.js";

/**
 * index.ts -- the diff bundle: a patch drawn by Pierre's diffs as every diff setting says, in the panel's colours.
 *
 * An entry of the renderer's build (`scripts/build.mjs`), imported by the
 * first diff shown (`../bundle-loader.ts`), so the bundle every
 * window parses never carries Pierre or Shiki; each language's grammar and
 * each syntax theme is a chunk of its own, fetched the first time it is
 * drawn. Shiki colours the code in the theme chosen for each appearance,
 * the File tab's two GitHub themes (`@luke/host`'s `task-code.ts`) until
 * another is, each taken as the system's appearance changes, and runs its
 * grammars on its JavaScript engine, since the panel's policy admits no
 * WebAssembly.
 *
 * A list's files are highlighted off the window's thread, in Pierre's own
 * pool of workers (`listHighlighting`): the build bundles Pierre's worker
 * whole as one classic script and hands this bundle its text
 * (`DIFF_HIGHLIGHT_WORKER`), which each worker is started from as a
 * `blob:`, the one place the policy admits a worker from. A file is drawn
 * in plain text until its colours come back, and each file's patch is read
 * under a name of its own (`readPatch`), so the pool's cache hands a file
 * scrolled back into view its colours again rather than highlighting it
 * anew. Where no worker can start, or the build carried none, as under a
 * test, Pierre highlights on the window's own thread, as one diff alone
 * always does.
 *
 * Pierre draws in a shadow root of its own. The panel's diff tints reach it
 * through the `--diffs-*` properties a sheet adopted there sets from the
 * window's tokens (`styles/base.css`), which a shadow root inherits, and the
 * chosen type through the same properties set on its host, each font one
 * every Mac has; the markup Pierre writes its layout and colours in is
 * applied through the CSSOM (`./inline-styles.ts`). The host is marked for
 * the tab's find, which reads the shadow root's words and leaves out its
 * gutter, as a File tab's numbers are, and the same sheet paints the find's
 * matches there, since a document's `::highlight` rules do not reach into a
 * shadow root.
 *
 * A changed line marks what it changed as asked (whole words joined across
 * the spaces between them, words, characters, or nothing), and a line too
 * long to compare is tinted whole. Lines handed as selected, a review
 * thread's, are lit in the code's blue, as a File tab's pointed lines are,
 * their rows alone and not the notes under them; the gutter's + stands
 * inside the numbers' column, never over the code.
 * Between two hunks of a file stands how many unchanged lines they leave
 * out. One diff alone offers no way to show them, since only its patch is
 * at hand; an excerpt, a review thread's lines, says nothing of the lines
 * around it. A list whose view reads its files whole (`readTexts`) offers
 * them as GitHub's diff does, twenty lines up or down or all at once, the
 * file read the first time one of its gaps is opened
 * (`expansionOptions`). The view is told which lines between a file's
 * hunks it waits to put a note under the file draws, as a gap opens over
 * them (`./drawn-lines.ts`): read as each file is drawn, since Pierre keeps
 * what was opened on the file's drawing and tells of no press itself.
 *
 * Files changed draws its pull request's files as one list (`mountList`),
 * through Pierre's own `CodeView`: every file under a header that sticks to
 * the top while its lines scroll past, only the files near the view drawn at
 * all, each in a shadow root of its own that the find reads and the same
 * sheet dresses, and a collapsed file drawn as its header alone. The header
 * is the element the view keeps for the file, which Pierre stands in the
 * file's light DOM, so the panel's own stylesheets draw it and the view
 * fills it as it does any of its own; a note under a line, a review
 * thread's, is the same, by its key, and a note on the whole file stands
 * under its header (`FILE_NOTE_LINE`). A file that draws no lines of its own,
 * one binary or too large, or an image the view draws as a picture, stands
 * as its notes on the whole file alone (`DiffListFile.lead`): Pierre draws
 * such notes only above a line, and measures them there, so the file is
 * handed one empty line, hidden with the old side and the numbers, and its
 * notes run across the whole of its width. Note that nothing is put in the
 * header beyond its one row, because Pierre reserves the header a height of
 * its own and holds it at the top while the file scrolls by. The view is
 * told which file stands at the top as the list scrolls, and scrolls it to
 * a file's header.
 *
 * Where the view comments on lines, code selected as text is read once the
 * drag that began in a file lets go (`watchTextSelection`): the lines it
 * runs over in that file's shadow root (`./text-selection.ts`) and where its
 * words stand, which the view offers a comment on. A press in the list or a
 * scroll lets the offer go.
 */

/** The longest line, in characters, whose changed words are marked; a longer one is tinted whole. */
const MAX_LINE_DIFF_LENGTH = 1000;

/**
 * The text of the worker a list's files are highlighted in, set by the
 * build (`scripts/build.mjs`); a run that never went through the bundler
 * has none.
 */
declare const DIFF_HIGHLIGHT_WORKER: string | undefined;

/** The attribute a list's file wears while it is drawn as its notes alone. */
const LEAD_ATTRIBUTE = "data-lead";

/** What the find leaves out of the shadow root's words: the gutter of numbers, as a File tab's numbers are. */
const FIND_SKIPPED = "[data-gutter]";

/**
 * The panel's look in the shadow root, from the window's tokens, in
 * Pierre's last layer so it stands over the theme's own tints: the diff
 * tints every place a diff is drawn shares, and lit lines in the code's
 * blue. The ground and ink are the theme's, the File tab's own in its
 * GitHub themes, and the type is the host's (`typeset`).
 */
const LOOK_CSS = `
@layer unsafe {
  :host {
    display: block;
    --diffs-addition-color-override: var(--diff-added-mark);
    --diffs-deletion-color-override: var(--diff-removed-mark);
    --diffs-bg-addition-override: var(--diff-added-ground);
    --diffs-bg-deletion-override: var(--diff-removed-ground);
    --diffs-bg-addition-number-override: var(--diff-added-ground);
    --diffs-bg-deletion-number-override: var(--diff-removed-ground);
    --diffs-bg-addition-emphasis-override: var(--diff-added-word);
    --diffs-bg-deletion-emphasis-override: var(--diff-removed-word);
    --diffs-modified-color-override: var(--code-pointed-edge);
  }
  pre {
    box-sizing: border-box;
    -webkit-user-select: text;
    user-select: text;
  }
  [data-gutter] {
    -webkit-user-select: none;
    user-select: none;
  }
  [data-code],
  [data-gutter] {
    scrollbar-width: thin;
  }
  /* The gutter's + stands inside the numbers' column, over a number at
     most, as GitHub's does; Pierre hangs it a character short of a line's
     height past the column, over the code's first characters. */
  [data-utility-button] {
    margin-right: 0;
  }
  /* A band between hunks is one surface across its width: Pierre fills
     the band's row with the code's ground and its arrows and its words
     with the band's, a box pasted onto a strip. Its row takes the band's
     ground, the arrows and the words stand on it with no ground of their
     own, and only the arrow fills under the pointer; the words, a bigger
     target opening the same lines, lift their ink. */
  [data-separator="line-info-basic"] [data-separator-wrapper] {
    /* Pierre's own band ground, which a list sets (LIST_CSS). */
    background-color: var(--diffs-bg-separator, var(--luke-color-fill-hover));
  }
  [data-separator="line-info-basic"] [data-expand-button],
  [data-separator="line-info-basic"] [data-separator-content] {
    background-color: transparent;
    border: 0;
  }
  [data-separator="line-info-basic"] [data-expand-button]:hover {
    background-color: var(--luke-color-fill-pressed);
  }
  /* The words open what the arrow opens: Pierre opens a gap's both ends
     from its words, which at the file's top or foot is not the arrow's, so
     the words let the pointer through to the arrow, whose press reaches
     across the band. A gap of two arrows keeps its words' own press,
     which opens both of its ends, so neither arrow is covered. */
  [data-separator="line-info-basic"] [data-separator-wrapper]:not([data-separator-multi-button])
    [data-separator-content] {
    pointer-events: none;
  }
  [data-separator="line-info-basic"] [data-separator-wrapper]:not([data-separator-multi-button])
    [data-expand-button]::after {
    content: "";
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    /* The arrow's column stands in the gutter alone, its words running on
       past it over the code, so its press runs the file's width. */
    width: 100cqi;
  }
  [data-separator="line-info-basic"] [data-separator-wrapper]:hover [data-separator-content] {
    color: var(--luke-color-text-muted);
  }
  /* Lines lit, a comment's or a thread's, light their own rows alone: a
     note under them, the comment being written or a thread, keeps its own
     ground rather than standing in the band. */
  [data-line-annotation][data-selected-line],
  [data-gutter-buffer="annotation"][data-selected-line] {
    --diffs-computed-selected-line-bg: var(--diffs-computed-diff-line-bg, transparent);
  }
  /* Note that a line's code scrolls sideways alone, so it keeps no room for a
     scroll bar up and down, which a system that draws its bars in the
     layout would otherwise leave as a strip at the end of every line, its
     rows and its gaps stopping short of the file's header. */
  [data-code] {
    scrollbar-gutter: auto;
  }
  /* A file drawn as its notes alone, laid out as blocks: its one empty line, the old side, the numbers, and the hatching beside a side's missing lines are hidden, so its notes run across its whole width, as tall as Pierre measured them. */
  :host([${LEAD_ATTRIBUTE}]) pre,
  :host([${LEAD_ATTRIBUTE}]) [data-code],
  :host([${LEAD_ATTRIBUTE}]) [data-content] {
    display: block;
  }
  :host([${LEAD_ATTRIBUTE}]) pre {
    padding-bottom: 0;
  }
  :host([${LEAD_ATTRIBUTE}]) [data-deletions],
  :host([${LEAD_ATTRIBUTE}]) [data-gutter],
  :host([${LEAD_ATTRIBUTE}]) [data-line],
  :host([${LEAD_ATTRIBUTE}]) [data-content-buffer] {
    display: none;
  }
  ::highlight(find-match) {
    background-color: var(--luke-color-find-match);
  }
  ::highlight(find-current) {
    background-color: var(--luke-color-find-current);
    color: var(--luke-color-on-find-current);
  }
}
`;

/** One diff alone: the theme's ground runs to the foot of the box it is drawn in, however few its lines. */
const FILL_CSS = `
@layer unsafe {
  :host {
    min-height: 100%;
  }
  pre {
    min-height: 100%;
  }
}
`;

/** How tall a list's file header stands, in pixels, which Pierre reserves for it before it is measured: the view's `.diff-list-head` (`styles/tasks.css`), its row and its rule. */
const LIST_HEADER_HEIGHT = 37;

/** How tall a band between two hunks of a list's file stands, in pixels, which Pierre lays the list out by (`LIST_CSS`). */
const LIST_GAP_HEIGHT = 24;

/** The room between two files of a list, and above the first, in pixels: the panel's ground between their cards. */
const LIST_FILE_GAP = 12;

/** The room below a list's last file, in pixels, so its last lines can be scrolled up off the foot of the pane. */
const LIST_FOOT_ROOM = 48;

/**
 * A file in a list: a card, its edge and its corners the panel's, holding
 * its header and its lines, each gap between hunks a quiet band of its own
 * height (`LIST_GAP_HEIGHT`). Note that the card's corners are clipped at
 * the card's own edge, so its header, stuck at the top of the list while
 * its lines scroll by, stands square there, the rounded top scrolled away.
 */
const LIST_CSS = `
@layer unsafe {
  :host {
    box-sizing: border-box;
    overflow: clip;
    border: 1px solid var(--luke-color-border);
    border-radius: var(--luke-control-radius);
    --diffs-bg-separator-override: var(--luke-color-fill-hover);
  }
  [data-separator="line-info-basic"] {
    height: ${LIST_GAP_HEIGHT}px;
    color: var(--luke-color-text-subtle);
    font-family: var(--luke-font-sans);
    font-size: var(--luke-type-caption-size);
  }
}
`;

let sheets: { look: CSSStyleSheet; fill: CSSStyleSheet } | undefined;

/** The look's sheets, made once and adopted by every diff's shadow root: the look with the card every file of a list wears, and the look with the fill one diff alone wears. */
function lookSheets(): { look: CSSStyleSheet; fill: CSSStyleSheet } {
  if (sheets !== undefined) return sheets;
  const look = new CSSStyleSheet();
  look.replaceSync(`${LOOK_CSS}${LIST_CSS}`);
  const fill = new CSSStyleSheet();
  fill.replaceSync(`${LOOK_CSS}${FILL_CSS}`);
  sheets = { look, fill };
  return sheets;
}

/** The options a single diff and a list share: the theme, the layout, and how a changed line is marked. */
function sharedOptions(drawn: DiffLook) {
  return {
    theme: drawn.themes,
    themeType: "system",
    preferredHighlighter: "shiki-js",
    diffStyle: drawn.layout === DIFF_LAYOUT.SPLIT ? "split" : "unified",
    diffIndicators: drawn.indicators,
    lineDiffType: drawn.inlineDiff,
    maxLineDiffLength: MAX_LINE_DIFF_LENGTH,
    disableBackground: !drawn.backgrounds,
    disableLineNumbers: !drawn.lineNumbers,
    overflow: drawn.wrap ? "wrap" : "scroll",
  } as const satisfies FileDiffOptions<string, undefined>;
}

/** The worker's text the build set; none where nothing built this bundle. */
function highlightWorkerText(): string | undefined {
  try {
    // SAFETY: esbuild replaces this free identifier when it bundles the
    // renderer; a run that never went through the bundler has no such
    // global, and reading one throws rather than answering undefined.
    return DIFF_HIGHLIGHT_WORKER;
  } catch {
    return undefined;
  }
}

let kept: Highlighting | undefined;

/**
 * How a list's files are highlighted (`@luke/panel/diff-view/highlight-pool`),
 * started the first time a list is drawn and kept for the window's life,
 * since a next list would only load the same grammars and themes again:
 * each worker started from the text the build carried, as a `blob:`.
 */
function listHighlighting(drawn: DiffLook): Highlighting {
  if (kept !== undefined) {
    // A list drawn after the settings changed hands the kept pool its own look.
    void kept.follow(drawn);
    return kept;
  }
  const text = highlightWorkerText();
  const address =
    text === undefined
      ? undefined
      : URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
  const startWorker =
    address === undefined ? undefined : () => new Worker(address, { name: "diff-highlight" });
  kept = startHighlighting(startWorker, drawn, MAX_LINE_DIFF_LENGTH);
  return kept;
}

/** How many patches the list has read, which names each read in the pool's cache. */
let patchesRead = 0;

/**
 * A file's patch read under a name of its own, which the pool keeps its
 * colours by, so a patch read again, a file whose patch changed, is never
 * handed the colours of the one before; one that does not read as a single
 * file's patch is refused, as `getSingularPatch` refuses it.
 */
function readPatch(patch: string): FileDiffMetadata {
  patchesRead += 1;
  const files = parsePatchFiles(patch, String(patchesRead)).flatMap((each) => each.files);
  const [file] = files;
  if (file === undefined || files.length !== 1)
    throw new Error("A list's patch reads as one file.");
  return file;
}

/** Pierre's options for one patch: a whole file's, or an excerpt with nothing said of the lines around it. */
function optionsOf(props: DiffViewProps): FileDiffOptions<string, undefined> {
  return {
    ...sharedOptions(props.look),
    hunkSeparators: props.excerpt === true ? "simple" : "line-info-basic",
    disableFileHeader: true,
  };
}

/** Sets the diff's type on its host, through the CSSOM, whose `--diffs-*` properties the shadow root inherits over its own. */
function typeset(container: HTMLElement, drawn: DiffLook): void {
  const { style } = container;
  style.setProperty("--diffs-font-family", FONT_STACK[drawn.font]);
  style.setProperty("--diffs-header-font-family", FONT_STACK[drawn.font]);
  style.setProperty("--diffs-font-size", `${drawn.fontSize}px`);
  style.setProperty("--diffs-line-height", LINE_HEIGHT_RATIO[drawn.lineHeight]);
  style.setProperty("--diffs-font-features", drawn.ligatures ? LIGATURES.ON : LIGATURES.OFF);
}

function mount(host: HTMLElement, props: DiffViewProps): DiffViewHandle {
  const container = document.createElement("diffs-container");
  container.setAttribute(FIND_SHADOW_ATTRIBUTE, FIND_SKIPPED);
  host.append(container);
  const root = container.shadowRoot ?? container.attachShadow({ mode: "open" });
  const release = adoptShadowStyles(root, lookSheets().fill);
  typeset(container, props.look);
  const view = new PierreFileDiff<string, undefined>(optionsOf(props));
  let patch = props.patch;
  let fileDiff = getSingularPatch(patch);
  view.render({ fileDiff, fileContainer: container });
  view.setSelectedLines(props.selected ?? null);
  return {
    update: (next) => {
      if (next.patch !== patch) {
        patch = next.patch;
        fileDiff = getSingularPatch(patch);
      }
      typeset(container, next.look);
      view.setOptions(optionsOf(next));
      view.render({ fileDiff, fileContainer: container, forceRender: true });
      view.setSelectedLines(next.selected ?? null);
    },
    unmount: () => {
      view.cleanUp();
      release();
      container.remove();
    },
  };
}

/** How many lines stand above a line a list is scrolled to, under its file's header, so the lines leading to it are read with it. */
const REVEAL_LINES_ABOVE = 3;

/** How tall one line of a list stands in a look, in pixels, as Pierre is told to lay it out. */
function lineHeightOf(look: DiffLook): number {
  return Number(look.fontSize) * Number(LINE_HEIGHT_RATIO[look.lineHeight]);
}

/** A note's place as Pierre takes it, its key carried as the note's own. */
function annotationsOf(notes: readonly DiffAnnotation[]): DiffLineAnnotation<string>[] {
  return notes.map((note) => ({ side: note.side, lineNumber: note.line, metadata: note.key }));
}

/** A file drawn as its notes alone, as Pierre takes it: a new file of one empty line, which Pierre draws its notes on the whole file above. */
function leadPatchOf(path: string): FileDiffMetadata {
  return getSingularPatch(
    `diff --git a/${path} b/${path}\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+\n`,
  );
}

/** A file's patch read, or, where it does not read as one, the file with no hunks, so one unreadable patch costs its own lines and not the list. */
function patchOf(file: DiffListFile): FileDiffMetadata {
  if (file.lead) return leadPatchOf(file.path);
  try {
    return readPatch(file.patch);
  } catch {
    const path = file.path;
    return getSingularPatch(`diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n`);
  }
}

/** No lines. */
const NO_LINES: readonly number[] = [];

/** A file as the list last drew it: what it was handed, and the item Pierre was given for it. */
interface DrawnFile {
  readonly file: DiffListFile;
  readonly item: CodeViewDiffItem<string>;
  /** Its patch as read, which the item draws as it is where the file may be opened between its hunks. */
  readonly read: FileDiffMetadata;
}

/**
 * The kind Pierre is told a file is where its lines between hunks may not
 * be opened: Pierre offers a gap's arrows only for a file changed in place
 * or moved with changes, and draws a file's hunks alike whatever its kind,
 * so a file told it only moved draws as it is with no arrows on its gaps.
 * Note that this is Pierre's one per-file door to that offer, its reader of
 * files whole being one for the whole list.
 */
const UNEXPANDED_KIND = "rename-pure";

/** A read patch as the item draws it: as read where its gaps may be opened, and otherwise told it only moved, so none is offered. */
function drawnAs(read: FileDiffMetadata, expandable: boolean): FileDiffMetadata {
  const offered = read.type === "change" || read.type === "rename-changed";
  if (expandable || !offered) return read;
  // Note that the copy keeps no cache key, because Pierre would hand it the drawing it keeps under the read's, its arrows with it.
  const { cacheKey: _drawnUnder, ...drawn } = read;
  return { ...drawn, type: UNEXPANDED_KIND };
}

/** A range Pierre picked, in the contract's words: a side Pierre leaves unsaid is the new file's. */
function selectionOf(range: SelectedLineRange): DiffSelection {
  const side = range.side ?? DIFF_SELECTION_SIDE.ADDITIONS;
  return { start: range.start, side, end: range.end, endSide: range.endSide ?? side };
}

/**
 * Pierre's own picking of lines, where the view comments on them: a press
 * of a line's number picks it and a ⇧-press or a drag picks a range, as
 * GitHub's diff does, and the gutter's + on the line under the pointer, or
 * on the range picked, tells the view, which opens its comment there. A file
 * drawn as its notes alone has no line of its own to pick, so its pick is
 * let go.
 */
function commentOptions(
  latest: () => DiffListProps,
  commentable: (path: string) => boolean,
): CodeViewOptions<string, undefined> {
  if (latest().onComment === undefined) return {};
  return {
    enableLineSelection: true,
    enableGutterUtility: true,
    lineHoverHighlight: "number",
    onGutterUtilityClick: (range: SelectedLineRange, context: { item: { id: string } }) => {
      const path = context.item.id;
      if (commentable(path)) latest().onComment?.({ path, selection: selectionOf(range) });
    },
  };
}

/**
 * Pierre's reading of a file whole, where the view reads files whole: the
 * first press on a gap between a file's hunks asks the view for the file's
 * text before and after, which Pierre draws the gap's lines from from then
 * on. A file the view could not read whole is refused, and its gap stays
 * as it is.
 */
function expansionOptions(
  latest: () => DiffListProps,
  pathOf: (fileDiff: FileDiffMetadata) => string,
): CodeViewOptions<string, undefined> {
  if (latest().readTexts === undefined) return {};
  return {
    expansionLineCount: GAP_LINES,
    loadDiffFiles: async (fileDiff: FileDiffMetadata) => {
      const texts = await latest().readTexts?.(pathOf(fileDiff));
      if (texts === undefined) throw new Error("The file could not be read whole.");
      return {
        oldFile: { name: fileDiff.prevName ?? fileDiff.name, contents: texts.before },
        newFile: { name: fileDiff.name, contents: texts.after },
      };
    },
  };
}

/**
 * Pierre's options for a list: the look, each file's header and notes drawn
 * in the elements the view keeps for them, read off the latest props, and
 * each file's element dressed as it is drawn.
 */
function listOptions(
  drawn: DiffLook,
  latest: () => DiffListProps,
  dress: (element: HTMLElement, path: string) => void,
  /** Told each file drawn, as Pierre draws it, to read which of its hidden lines it draws. */
  drawnBy: (path: string, instance: PierreFileDiff<string, undefined>) => void,
  commentable: (path: string) => boolean,
  pathOf: (fileDiff: FileDiffMetadata) => string,
): CodeViewOptions<string, undefined> {
  return {
    ...sharedOptions(drawn),
    ...commentOptions(latest, commentable),
    ...expansionOptions(latest, pathOf),
    hunkSeparators: "line-info-basic",
    stickyHeaders: true,
    itemMetrics: {
      lineHeight: lineHeightOf(drawn),
      diffHeaderHeight: LIST_HEADER_HEIGHT,
      hunkSeparatorHeight: LIST_GAP_HEIGHT,
    },
    layout: { paddingTop: LIST_FILE_GAP, paddingBottom: LIST_FOOT_ROOM, gap: LIST_FILE_GAP },
    renderCustomHeader: (
      _drawn: FileDiffMetadata | FileContents,
      context: { item: { id: string } },
    ) => latest().renderHeader(context.item.id),
    renderAnnotation: (note: { metadata: string }, context: { item: { id: string } }) =>
      latest().renderAnnotation(context.item.id, note.metadata),
    onPostRender: (
      node: HTMLElement,
      instance: PierreFileDiff<string, undefined> | PierreFile<string, undefined>,
      phase: PostRenderPhase,
      context: { item: { id: string } },
    ) => {
      dress(node, context.item.id);
      if (phase !== "unmount" && instance instanceof PierreFileDiff) {
        drawnBy(context.item.id, instance);
      }
    },
  };
}

/** The selection's range inside one shadow root, as a live range; none where nothing is selected there. */
function rangeIn(root: ShadowRoot): Range | undefined {
  const [composed] = document.getSelection()?.getComposedRanges({ shadowRoots: [root] }) ?? [];
  if (composed === undefined || composed.collapsed) return undefined;
  const range = document.createRange();
  range.setStart(composed.startContainer, composed.startOffset);
  range.setEnd(composed.endContainer, composed.endOffset);
  return range;
}

/**
 * Tells the view what code a drag that began in a file of the list selected
 * as text, once it lets go, wherever the pointer then stands; and tells it
 * the selection is gone as a press lands in the list. The selection is read
 * a frame after the drag lets go, once the browser has settled it, and only
 * in the file the drag began in, so a selection running into another file
 * runs over no lines. Answers what stops the watch.
 */
function watchTextSelection(
  host: HTMLElement,
  watched: () => boolean,
  tell: (selected: DiffTextSelection | undefined) => void,
  pathOf: (element: EventTarget) => string | undefined,
): () => void {
  let origin: HTMLElement | undefined;
  let frame: number | undefined;
  const read = (element: HTMLElement) => {
    frame = undefined;
    const path = pathOf(element);
    const range = element.shadowRoot === null ? undefined : rangeIn(element.shadowRoot);
    const selection = range === undefined ? undefined : selectedLines(range);
    const rect = range === undefined ? undefined : selectionRect(range);
    if (path === undefined || selection === undefined || rect === undefined) return;
    tell({ picked: { path, selection }, rect });
  };
  const press = (event: PointerEvent) => {
    const path = event.composedPath();
    // Note that only a press on the code begins a drag over it; one on a
    // file's header or a note leaves the selection standing, which a let-go
    // would otherwise read again and offer anew.
    origin = pressedOnCode(path)
      ? path.find(
          (target): target is HTMLElement =>
            target instanceof HTMLElement && pathOf(target) !== undefined,
        )
      : undefined;
    tell(undefined);
  };
  const letGo = () => {
    const element = origin;
    origin = undefined;
    if (element === undefined || !watched()) return;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => read(element));
  };
  host.addEventListener("pointerdown", press);
  // Note that the drag may let go past the list, beyond the file it began in.
  document.addEventListener("pointerup", letGo, true);
  return () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    host.removeEventListener("pointerdown", press);
    document.removeEventListener("pointerup", letGo, true);
  };
}

/**
 * Draws a list of files, as Files changed shows its pull request's. Note
 * that a file's patch is read again only when it changes, and its item
 * handed anew, its version counted up, only when what it draws changes,
 * because Pierre draws again whatever it is handed anew.
 */
function mountList(host: HTMLElement, props: DiffListProps): DiffListHandle {
  let latest = props;
  const drawnFiles = new Map<string, DrawnFile>();
  const paths = new WeakMap<FileDiffMetadata, string>();
  const releases: Array<() => void> = [];
  const dressed = new WeakSet<HTMLElement>();
  // Each file's element by the file it draws now, which a drag's selection is read in.
  const elementPaths = new WeakMap<EventTarget, string>();
  // Note that Pierre keeps a file's element for another file once the first
  // scrolls away, so each element's shadow root is dressed once, the first
  // time it is drawn, and whether it is drawn as notes alone every time.
  const dress = (element: HTMLElement, path: string) => {
    element.toggleAttribute(LEAD_ATTRIBUTE, drawnFiles.get(path)?.file.lead === true);
    elementPaths.set(element, path);
    if (dressed.has(element) || element.shadowRoot === null) return;
    dressed.add(element);
    element.setAttribute(FIND_SHADOW_ATTRIBUTE, FIND_SKIPPED);
    releases.push(adoptShadowStyles(element.shadowRoot, lookSheets().look));
  };
  // The hidden lines each file was last told to draw, told again only as they change.
  const drawn = drawnTeller((path, lines) => latest.onDrawn?.(path, lines));
  const tellDrawn = drawn.tell;
  const drawnBy = (path: string, instance: PierreFileDiff<string, undefined>) =>
    tellDrawn(path, drawnAmong(instance, drawnFiles.get(path)?.file.hidden ?? NO_LINES));
  // The files whose hidden lines changed while their item stood, read again once the list is drawn.
  const rehidden = new Set<string>();
  const itemsOf = (files: readonly DiffListFile[]) =>
    files.map((file) => {
      const held = drawnFiles.get(file.path);
      if (
        held !== undefined &&
        held.file.patch === file.patch &&
        held.file.lead === file.lead &&
        held.file.collapsed === file.collapsed &&
        held.file.expandable === file.expandable &&
        held.file.whole === file.whole &&
        sameNotes(held.file.annotations, file.annotations)
      ) {
        if (!sameLines(held.file.hidden ?? NO_LINES, file.hidden ?? NO_LINES)) {
          drawnFiles.set(file.path, { ...held, file });
          rehidden.add(file.path);
        }
        return held.item;
      }
      const read =
        held?.file.patch === file.patch &&
        held.file.lead === file.lead &&
        held.file.whole === undefined
          ? held.read
          : patchOf(file);
      const item: CodeViewDiffItem<string> = {
        id: file.path,
        type: "diff",
        fileDiff:
          file.whole === undefined ? drawnAs(read, file.expandable) : wholeOf(read, file.whole),
        collapsed: file.collapsed,
        annotations: annotationsOf(file.annotations),
        version: (held?.item.version ?? 0) + 1,
      };
      drawnFiles.set(file.path, { file, item, read });
      paths.set(item.fileDiff, file.path);
      // Note that a patch drawn anew opens none of its gaps until Pierre draws it, so none of its hidden lines stands drawn.
      if (item.fileDiff !== held?.item.fileDiff) tellDrawn(file.path, NO_LINES);
      else rehidden.add(file.path);
      return item;
    });
  // Each file whose hidden lines changed read again: as Pierre draws it, or, out of view, where it stood, since nothing opens a gap there.
  const readRehidden = () => {
    const rendered = new Map(view.getRenderedItems().map((each) => [each.id, each]));
    for (const path of rehidden) {
      const hidden = drawnFiles.get(path)?.file.hidden ?? NO_LINES;
      const standing = rendered.get(path);
      if (standing?.type === "diff") drawnBy(path, standing.instance);
      else
        tellDrawn(
          path,
          drawn.told(path).filter((line) => hidden.includes(line)),
        );
    }
    rehidden.clear();
  };
  typeset(host, props.look);
  const commentable = (path: string) => drawnFiles.get(path)?.file.lead === false;
  // Note that a file's read patch names its file by path for Pierre's reading of it whole, since Pierre hands back the patch alone.
  const pathOf = (fileDiff: FileDiffMetadata) => paths.get(fileDiff) ?? fileDiff.name;
  const optionsFor = (next: DiffListProps) =>
    listOptions(next.look, () => latest, dress, drawnBy, commentable, pathOf);
  const highlighting = listHighlighting(props.look);
  const { pool } = highlighting;
  const view = new CodeView<string, undefined>(optionsFor(props), pool);
  view.setup(host);
  view.setItems(itemsOf(props.files));
  view.render(true);
  // The file whose header stands at the top of the list, told when it changes.
  let top: string | undefined;
  const tellTop = (scrollTop: number) => {
    const standing = latest.files.findLast(
      (file) => (view.getTopForItem(file.path) ?? Number.POSITIVE_INFINITY) <= scrollTop + 1,
    );
    const path = standing?.path ?? latest.files[0]?.path;
    if (path === undefined || path === top) return;
    top = path;
    latest.onTopFile(path);
  };
  // Note that a selection's offer stands where the selection stood, so a
  // scroll lets it go; the view is told so once, not on every scroll.
  let offered = false;
  const tellText = (selected: DiffTextSelection | undefined) => {
    if (selected === undefined && !offered) return;
    offered = selected !== undefined;
    latest.onSelectText?.(selected);
  };
  const stopWatching = watchTextSelection(
    host,
    () => latest.onSelectText !== undefined,
    tellText,
    (element) => elementPaths.get(element),
  );
  const unsubscribe = view.subscribeToScroll((scrollTop) => {
    tellTop(scrollTop);
    tellText(undefined);
  });
  tellTop(0);
  // The lines being commented on, lit; Pierre's own pick stands while none is.
  const light = (selected: DiffListSelection | undefined) => {
    if (selected === undefined) return view.clearSelectedLines();
    const { start, side, end, endSide } = selected.selection;
    view.setSelectedLines({ id: selected.path, range: { start, side, end, endSide } });
  };
  if (props.selected !== undefined) light(props.selected);
  return {
    update: (next) => {
      const was = latest;
      latest = next;
      typeset(host, next.look);
      if (!sameLook(next.look, was.look)) {
        // A look the pool's workers do not hold yet is handed them first, since the pool's colours stand over the list's own.
        void highlighting.follow(next.look);
      }
      if (
        !sameLook(next.look, was.look) ||
        (next.onComment === undefined) !== (was.onComment === undefined) ||
        (next.readTexts === undefined) !== (was.readTexts === undefined)
      )
        view.setOptions(optionsFor(next));
      view.setItems(itemsOf(next.files));
      view.render();
      // A file the list no longer holds draws none of its lines, and its next drawing opens no gap.
      drawn.forget(new Set(next.files.map((file) => file.path)));
      readRehidden();
      tellTop(host.scrollTop);
      if (!sameListSelection(next.selected, was.selected)) light(next.selected);
    },
    reveal: (path) =>
      view.scrollTo({ type: "item", id: path, align: "start", behavior: "smooth-auto" }),
    // Note that Pierre resolves the line against its layout again on every frame until the scroll settles, so files measured on the way do not leave it short.
    revealLine: (path, side, line) =>
      view.scrollTo({
        type: "line",
        id: path,
        lineNumber: line,
        side,
        align: "start",
        offset: lineHeightOf(latest.look) * REVEAL_LINES_ABOVE,
        behavior: "smooth-auto",
      }),
    unmount: () => {
      // A list taken down draws nothing; the next one mounted opens no gap.
      drawn.forget(new Set());
      stopWatching();
      unsubscribe();
      view.cleanUp();
      for (const release of releases) release();
      host.replaceChildren();
    },
  };
}

/**
 * A run of a file's lines coloured in the look's syntax themes, as a list's
 * files are: in the kept pool's workers once they hold the look, or on the
 * window's own thread where the pool settled there; none where the file's
 * name names no grammar Pierre carries, or the colouring failed.
 */
async function colourLines(request: ColourRequest): Promise<ColouredLines | undefined> {
  colouringsAsked += 1;
  const file = {
    name: request.name,
    contents: request.lines.join("\n"),
    cacheKey: String(colouringsAsked),
  };
  if (getFiletypeFromFileName(file.name) === PLAIN_TEXT) return undefined;
  const highlighting = listHighlighting(request.look);
  const { pool } = highlighting;
  try {
    if ((await highlighting.settled) === HIGHLIGHT_MODE.POOL && pool !== undefined) {
      await highlighting.follow(request.look);
      await pool.primeFileHighlightCache(file);
      const cached = pool.getFileResultCache(file)?.result;
      return cached === undefined ? undefined : colouredFrom(cached, request.lines.length);
    }
    const { dark, light } = request.look.themes;
    const highlighter = await getSharedHighlighter({
      themes: [dark, light],
      langs: [getFiletypeFromFileName(file.name)],
      preferredHighlighter: "shiki-js",
    });
    const drawn = renderFileWithHighlighter(file, highlighter, {
      theme: request.look.themes,
      useTokenTransformer: false,
      tokenizeMaxLineLength: MAX_LINE_DIFF_LENGTH,
    });
    return colouredFrom(drawn, request.lines.length);
  } catch {
    return undefined;
  }
}

/** How many colourings were asked for, which names each in the pool's cache, as `patchesRead` names a list's reads. */
let colouringsAsked = 0;

/** The name Pierre gives a file whose name names no grammar. */
const PLAIN_TEXT = "text";

export const diffView: DiffViewModule = { mount, mountList, colourLines };
