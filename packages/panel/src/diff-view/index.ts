import { DIFF_FONT, DIFF_LAYOUT, DIFF_LINE_HEIGHT } from "@luke/settings/diff-view";
import {
  CodeView,
  type CodeViewDiffItem,
  type CodeViewOptions,
  type DiffLineAnnotation,
  type FileContents,
  type FileDiffMetadata,
  type FileDiffOptions,
  getSingularPatch,
  type File as PierreFile,
  FileDiff as PierreFileDiff,
  type PostRenderPhase,
  parsePatchFiles,
  type SelectedLineRange,
} from "@pierre/diffs";
import { FIND_SHADOW_ATTRIBUTE } from "../find-matches.js";
import {
  DIFF_SELECTION_SIDE,
  type DiffAnnotation,
  type DiffListFile,
  type DiffListHandle,
  type DiffListProps,
  type DiffListSelection,
  type DiffLook,
  type DiffSelection,
  type DiffViewHandle,
  type DiffViewModule,
  type DiffViewProps,
  sameListSelection,
  sameLook,
  sameNotes,
} from "./contract.js";
import { type Highlighting, startHighlighting } from "./highlight-pool.js";
import { adoptShadowStyles } from "./inline-styles.js";

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
 * thread's, are lit in the code's blue, as a File tab's pointed lines are.
 * Between two hunks of a file stands how many unchanged lines they leave
 * out, with no offer to show them, since the service reads the patch alone
 * and those lines are not at hand; an excerpt, a review thread's lines,
 * says nothing of the lines around it.
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
 */

/** Each font's stack, ending in the window's own code type should the Mac lack it. */
const FONT_STACK = {
  [DIFF_FONT.SF_MONO]: "var(--luke-font-mono)",
  [DIFF_FONT.MENLO]: "Menlo, var(--luke-font-mono)",
  [DIFF_FONT.MONACO]: "Monaco, var(--luke-font-mono)",
  [DIFF_FONT.COURIER_NEW]: '"Courier New", var(--luke-font-mono)',
  [DIFF_FONT.ANDALE_MONO]: '"Andale Mono", var(--luke-font-mono)',
} as const satisfies Record<DiffLook["font"], string>;

/** Each line height as a ratio of the type's size, so a line grows with its type; the File tab's 1.6 at normal. */
const LINE_HEIGHT_RATIO = {
  [DIFF_LINE_HEIGHT.COMPACT]: "1.45",
  [DIFF_LINE_HEIGHT.NORMAL]: "1.6",
  [DIFF_LINE_HEIGHT.SPACIOUS]: "1.85",
} as const satisfies Record<DiffLook["lineHeight"], string>;

/** The font features ligatures turn on or off. */
const LIGATURES = { ON: "'liga' 1, 'calt' 1", OFF: "'liga' 0, 'calt' 0" } as const;

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

/** How tall a list's file header stands, in pixels, which Pierre reserves for it before it is measured: the view's `.diff-list-head` (`styles/tasks.css`). */
const LIST_HEADER_HEIGHT = 34;

/** The room below a list's last file, in pixels, so its last lines can be scrolled up off the foot of the pane. */
const LIST_FOOT_ROOM = 48;

let sheets: { look: CSSStyleSheet; fill: CSSStyleSheet } | undefined;

/** The look's sheets, made once and adopted by every diff's shadow root: the look every diff in a list wears, and the same with the fill one diff alone wears. */
function lookSheets(): { look: CSSStyleSheet; fill: CSSStyleSheet } {
  if (sheets !== undefined) return sheets;
  const look = new CSSStyleSheet();
  look.replaceSync(LOOK_CSS);
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
    kept.follow(drawn);
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

/** A file as the list last drew it: what it was handed, and the item Pierre was given for it. */
interface DrawnFile {
  readonly file: DiffListFile;
  readonly item: CodeViewDiffItem<string>;
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
 * Pierre's options for a list: the look, each file's header and notes drawn
 * in the elements the view keeps for them, read off the latest props, and
 * each file's element dressed as it is drawn.
 */
function listOptions(
  drawn: DiffLook,
  latest: () => DiffListProps,
  dress: (element: HTMLElement, path: string) => void,
  commentable: (path: string) => boolean,
): CodeViewOptions<string, undefined> {
  return {
    ...sharedOptions(drawn),
    ...commentOptions(latest, commentable),
    hunkSeparators: "line-info-basic",
    stickyHeaders: true,
    itemMetrics: {
      lineHeight: Number(drawn.fontSize) * Number(LINE_HEIGHT_RATIO[drawn.lineHeight]),
      diffHeaderHeight: LIST_HEADER_HEIGHT,
    },
    layout: { paddingTop: 0, paddingBottom: LIST_FOOT_ROOM, gap: 0 },
    renderCustomHeader: (
      _drawn: FileDiffMetadata | FileContents,
      context: { item: { id: string } },
    ) => latest().renderHeader(context.item.id),
    renderAnnotation: (note: { metadata: string }, context: { item: { id: string } }) =>
      latest().renderAnnotation(context.item.id, note.metadata),
    onPostRender: (
      node: HTMLElement,
      _instance: PierreFileDiff<string, undefined> | PierreFile<string, undefined>,
      _phase: PostRenderPhase,
      context: { item: { id: string } },
    ) => dress(node, context.item.id),
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
  const releases: Array<() => void> = [];
  const dressed = new WeakSet<HTMLElement>();
  // Note that Pierre keeps a file's element for another file once the first
  // scrolls away, so each element's shadow root is dressed once, the first
  // time it is drawn, and whether it is drawn as notes alone every time.
  const dress = (element: HTMLElement, path: string) => {
    element.toggleAttribute(LEAD_ATTRIBUTE, drawnFiles.get(path)?.file.lead === true);
    if (dressed.has(element) || element.shadowRoot === null) return;
    dressed.add(element);
    element.setAttribute(FIND_SHADOW_ATTRIBUTE, FIND_SKIPPED);
    releases.push(adoptShadowStyles(element.shadowRoot, lookSheets().look));
  };
  const itemsOf = (files: readonly DiffListFile[]) =>
    files.map((file) => {
      const held = drawnFiles.get(file.path);
      if (
        held !== undefined &&
        held.file.patch === file.patch &&
        held.file.lead === file.lead &&
        held.file.collapsed === file.collapsed &&
        sameNotes(held.file.annotations, file.annotations)
      ) {
        return held.item;
      }
      const item: CodeViewDiffItem<string> = {
        id: file.path,
        type: "diff",
        fileDiff:
          held?.file.patch === file.patch && held.file.lead === file.lead
            ? held.item.fileDiff
            : patchOf(file),
        collapsed: file.collapsed,
        annotations: annotationsOf(file.annotations),
        version: (held?.item.version ?? 0) + 1,
      };
      drawnFiles.set(file.path, { file, item });
      return item;
    });
  typeset(host, props.look);
  const commentable = (path: string) => drawnFiles.get(path)?.file.lead === false;
  const optionsFor = (next: DiffListProps) =>
    listOptions(next.look, () => latest, dress, commentable);
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
  const unsubscribe = view.subscribeToScroll((scrollTop) => tellTop(scrollTop));
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
        highlighting.follow(next.look);
      }
      if (
        !sameLook(next.look, was.look) ||
        (next.onComment === undefined) !== (was.onComment === undefined)
      )
        view.setOptions(optionsFor(next));
      view.setItems(itemsOf(next.files));
      view.render();
      tellTop(host.scrollTop);
      if (!sameListSelection(next.selected, was.selected)) light(next.selected);
    },
    reveal: (path) =>
      view.scrollTo({ type: "item", id: path, align: "start", behavior: "smooth-auto" }),
    unmount: () => {
      unsubscribe();
      view.cleanUp();
      for (const release of releases) release();
      host.replaceChildren();
    },
  };
}

export const diffView: DiffViewModule = { mount, mountList };
