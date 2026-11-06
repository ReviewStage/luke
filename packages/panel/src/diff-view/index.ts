import { MOTION_DELAY_MS } from "@repo/brand";
import { DIFF_LAYOUT } from "@repo/settings/diff-view";
import { onDrawnThemeChange } from "@repo/ui/appearance";
import { LANDED, LANDED_ANIMATION, LANDED_ATTRIBUTE, land } from "@repo/ui/landed";
import {
  CodeView,
  type CodeViewDiffItem,
  type CodeViewItem,
  type CodeViewOptions,
  type DiffLineAnnotation,
  type FileContents,
  type FileDiffMetadata,
  type FileDiffOptions,
  getSingularPatch,
  type LineAnnotation,
  type File as PierreFile,
  FileDiff as PierreFileDiff,
  type PostRenderPhase,
  parsePatchFiles,
  type SelectedLineRange,
} from "@pierre/diffs";
import { FONT_STACK, LIGATURES, LINE_HEIGHT_RATIO } from "../code-type.js";
import { FIND_SHADOW_ATTRIBUTE } from "../find-matches.js";
import {
  ANNOTATION_BAND,
  ANNOTATION_BAND_ATTRIBUTE,
  markAnnotationBands,
} from "./annotation-bands.js";
import {
  DIFF_SELECTION_SIDE,
  type DiffAnnotation,
  type DiffLineRange,
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
  type FileAnnotation,
  type FileLineRange,
  type FileViewHandle,
  type FileViewProps,
  GAP_CONTROL,
  GAP_CONTROL_ATTRIBUTE,
  GAP_LINES,
  sameFileLines,
  sameFileNotes,
  sameLines,
  sameListSelection,
  sameLook,
  sameNotes,
} from "./contract.js";
import { drawnAmong, drawnTeller } from "./drawn-lines.js";
import { watchGapControls } from "./gap-controls.js";
import {
  HIGHLIGHT_CACHE_ENTRIES,
  type Highlighting,
  preferredHighlighter,
  startHighlighting,
} from "./highlight-pool.js";
import { adoptShadowStyles } from "./inline-styles.js";
import { markLineIndents } from "./line-indents.js";
import { pressedOnCode, selectedLines, selectionRect } from "./text-selection.js";
import { wholeOf } from "./whole-diff.js";

const MAX_LINE_DIFF_LENGTH = 1000;

const NO_NOTES: readonly DiffAnnotation[] = [];

declare const DIFF_HIGHLIGHT_WORKER: string | undefined;

const LEAD_ATTRIBUTE = "data-lead";

const FLASH_DEADLINE_MS = MOTION_DELAY_MS.CONFIRM * 2;

const FIND_SKIPPED = "[data-gutter]";

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
  [data-utility-button] {
    margin-right: 0;
  }
  [data-separator="line-info-basic"] [data-separator-wrapper] {
    background-color: var(--diffs-bg-separator, var(--ui-color-fill-hover));
  }
  [data-separator="line-info-basic"] [data-expand-button],
  [data-separator="line-info-basic"] [data-separator-content] {
    background-color: transparent;
    border: 0;
  }
  [data-separator="line-info-basic"] [data-separator-content]:hover {
    cursor: auto;
    text-decoration: none;
  }
  [data-gutter] [data-separator="line-info-basic"]:not([data-expand-index]) [data-separator-wrapper] {
    display: grid;
    grid-template-columns: 100% auto;
  }
  [data-gutter] [data-separator="line-info-basic"]:not([data-expand-index]) [data-separator-content] {
    grid-column: 2;
  }
  @media (hover: hover) {
    [data-separator="line-info-basic"] [${GAP_CONTROL_ATTRIBUTE}="${GAP_CONTROL.MORE}"]:hover {
      background-color: var(--ui-color-fill-pressed);
    }
  }
  [data-separator="line-info-basic"] [${GAP_CONTROL_ATTRIBUTE}="${GAP_CONTROL.ALL}"] {
    cursor: var(--ui-cursor-press);
  }
  @media (hover: hover) {
    [data-separator="line-info-basic"] [${GAP_CONTROL_ATTRIBUTE}="${GAP_CONTROL.ALL}"]:hover {
      color: var(--diffs-fg, var(--ui-color-text));
    }
  }
  [${GAP_CONTROL_ATTRIBUTE}]:focus-visible {
    outline: var(--ui-focus-ring-width) solid var(--ui-color-focus-ring);
    outline-offset: calc(-1 * var(--ui-focus-ring-width));
  }
  [${GAP_CONTROL_ATTRIBUTE}="${GAP_CONTROL.ALL}"]:focus-visible {
    border-radius: var(--ui-focus-ring-width);
    outline-offset: var(--ui-focus-ring-offset);
  }
  :host-context(:root:not([data-keyboard="true"])) [${GAP_CONTROL_ATTRIBUTE}]:focus-visible {
    outline: none;
  }
  [data-line-annotation],
  [data-gutter-buffer="annotation"] {
    --diffs-annotation-bg: var(--diffs-bg);
  }
  [data-line-annotation][data-selected-line],
  [data-gutter-buffer="annotation"][data-selected-line] {
    --diffs-computed-selected-line-bg: var(--diffs-computed-diff-line-bg, transparent);
  }
  [data-line-annotation][${ANNOTATION_BAND_ATTRIBUTE}] {
    --mix-light: 88%;
    --mix-dark: 80%;
  }
  [data-gutter-buffer="annotation"][${ANNOTATION_BAND_ATTRIBUTE}] {
    --mix-light: 91%;
    --mix-dark: 85%;
  }
  [data-line-annotation][${ANNOTATION_BAND_ATTRIBUTE}],
  [data-gutter-buffer="annotation"][${ANNOTATION_BAND_ATTRIBUTE}] {
    background-color: light-dark(
      color-mix(in lab, var(--diffs-bg, var(--ui-color-ground)) var(--mix-light), var(--annotation-band)),
      color-mix(in lab, var(--diffs-bg, var(--ui-color-ground)) var(--mix-dark), var(--annotation-band))
    );
  }
  [data-line-annotation][${ANNOTATION_BAND_ATTRIBUTE}="${ANNOTATION_BAND.ADDITION}"] {
    --annotation-band: var(--diffs-bg-addition-override, var(--diffs-addition-base, var(--diff-added-mark)));
  }
  [data-line-annotation][${ANNOTATION_BAND_ATTRIBUTE}="${ANNOTATION_BAND.DELETION}"] {
    --annotation-band: var(--diffs-bg-deletion-override, var(--diffs-deletion-base, var(--diff-removed-mark)));
  }
  [data-gutter-buffer="annotation"][${ANNOTATION_BAND_ATTRIBUTE}="${ANNOTATION_BAND.ADDITION}"] {
    --annotation-band: var(--diffs-bg-addition-number-override, var(--diffs-addition-base, var(--diff-added-mark)));
  }
  [data-gutter-buffer="annotation"][${ANNOTATION_BAND_ATTRIBUTE}="${ANNOTATION_BAND.DELETION}"] {
    --annotation-band: var(--diffs-bg-deletion-number-override, var(--diffs-deletion-base, var(--diff-removed-mark)));
  }
  [data-indicators="bars"] [data-gutter-buffer="annotation"][${ANNOTATION_BAND_ATTRIBUTE}]::after {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    width: 4px;
    height: 100%;
    pointer-events: none;
  }
  [data-indicators="bars"] [data-gutter-buffer="annotation"][${ANNOTATION_BAND_ATTRIBUTE}="${ANNOTATION_BAND.ADDITION}"]::after {
    background-color: var(--diffs-addition-base, var(--diff-added-mark));
  }
  [data-indicators="bars"] [data-gutter-buffer="annotation"][${ANNOTATION_BAND_ATTRIBUTE}="${ANNOTATION_BAND.DELETION}"]::after {
    background-image: linear-gradient(
      0deg,
      var(--diffs-bg-deletion, var(--diff-removed-ground)) 50%,
      var(--diffs-deletion-base, var(--diff-removed-mark)) 50%
    );
    background-repeat: repeat;
    background-size: 2px 2px;
  }
  [data-code] {
    scrollbar-gutter: auto;
  }
  [data-overflow="wrap"] [data-line] {
    border-inline-start: var(--ui-line-indent, 0ch) solid transparent;
    text-indent: calc(-1 * var(--ui-line-indent, 0ch));
  }
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
    background-color: var(--ui-color-find-match);
  }
  ::highlight(find-current) {
    background-color: var(--ui-color-find-current);
    color: var(--ui-color-on-find-current);
  }
}
`;

const FLASH_CSS = `
@layer unsafe {
  :host([${LANDED_ATTRIBUTE}]) [data-selected-line] {
    background-color: color-mix(
      in lab,
      var(--diffs-computed-selected-line-bg) calc(var(--ui-landed) * 100%),
      var(--diffs-computed-diff-line-bg, transparent)
    );
  }
}
`;

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

const LIST_HEADER_HEIGHT = 37;

const LIST_GAP_HEIGHT = 24;

const LIST_FILE_GAP = 12;

const LIST_FOOT_ROOM = 48;

const LIST_CSS = `
@layer unsafe {
  :host {
    box-sizing: border-box;
    overflow: clip;
    border: 1px solid var(--ui-color-border);
    border-radius: var(--ui-control-radius);
    --diffs-bg-separator-override: var(--ui-color-fill-hover);
  }
  [data-separator="line-info-basic"] {
    height: ${LIST_GAP_HEIGHT}px;
    color: var(--ui-color-text-muted);
    font-family: var(--ui-font-sans);
    font-size: var(--ui-type-caption-size);
  }
}
`;

let sheets: { look: CSSStyleSheet; fill: CSSStyleSheet; whole: CSSStyleSheet } | undefined;

function lookSheets(): { look: CSSStyleSheet; fill: CSSStyleSheet; whole: CSSStyleSheet } {
  if (sheets !== undefined) return sheets;
  const look = new CSSStyleSheet();
  look.replaceSync(`${LOOK_CSS}${LIST_CSS}${FLASH_CSS}`);
  const fill = new CSSStyleSheet();
  fill.replaceSync(`${LOOK_CSS}${FILL_CSS}`);
  const whole = new CSSStyleSheet();
  whole.replaceSync(`${LOOK_CSS}${FLASH_CSS}`);
  sheets = { look, fill, whole };
  return sheets;
}

function sharedOptions(drawn: DiffLook) {
  return {
    theme: drawn.themes,
    themeType: "system",
    preferredHighlighter: preferredHighlighter(),
    diffStyle: drawn.layout === DIFF_LAYOUT.SPLIT ? "split" : "unified",
    diffIndicators: drawn.indicators,
    lineDiffType: drawn.inlineDiff,
    maxLineDiffLength: MAX_LINE_DIFF_LENGTH,
    disableBackground: !drawn.backgrounds,
    disableLineNumbers: !drawn.lineNumbers,
    overflow: drawn.wrap ? "wrap" : "scroll",
  } as const satisfies FileDiffOptions<string, undefined>;
}

function highlightWorkerText(): string | undefined {
  try {
    return DIFF_HIGHLIGHT_WORKER;
  } catch {
    return undefined;
  }
}

let kept: Highlighting | undefined;

function listHighlighting(drawn: DiffLook): Highlighting {
  if (kept !== undefined) {
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

let patchesRead = 0;

function readPatch(patch: string): FileDiffMetadata {
  patchesRead += 1;
  const files = parsePatchFiles(patch, String(patchesRead)).flatMap((each) => each.files);
  const [file] = files;
  if (file === undefined || files.length !== 1)
    throw new Error("A list's patch reads as one file.");
  return file;
}

function optionsOf(props: DiffViewProps): FileDiffOptions<string, undefined> {
  const { renderAnnotation } = props;
  return {
    ...sharedOptions(props.look),
    hunkSeparators: props.excerpt === true ? "simple" : "line-info-basic",
    disableFileHeader: true,
    onPostRender: (node: HTMLElement, _instance: unknown, phase: PostRenderPhase) => {
      if (phase !== "unmount" && node.shadowRoot !== null && props.look.wrap)
        markLineIndents(node.shadowRoot);
    },
    ...(renderAnnotation === undefined
      ? {}
      : { renderAnnotation: (note: { metadata: string }) => renderAnnotation(note.metadata) }),
  };
}

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
  const highlighting = props.pooled === true ? listHighlighting(props.look) : undefined;
  const read = highlighting === undefined ? getSingularPatch : readPatch;
  const view = new PierreFileDiff<string, undefined>(optionsOf(props), highlighting?.pool);
  let patch = props.patch;
  let look = props.look;
  let fileDiff = read(patch);
  view.render({
    fileDiff,
    fileContainer: container,
    lineAnnotations: annotationsOf(props.annotations ?? NO_NOTES),
  });
  view.setSelectedLines(props.selected ?? null);
  return {
    update: (next) => {
      if (next.patch !== patch) {
        patch = next.patch;
        fileDiff = read(patch);
      }
      if (highlighting !== undefined && !sameLook(next.look, look))
        void highlighting.follow(next.look);
      look = next.look;
      typeset(container, next.look);
      view.setOptions(optionsOf(next));
      view.render({
        fileDiff,
        fileContainer: container,
        lineAnnotations: annotationsOf(next.annotations ?? NO_NOTES),
        forceRender: true,
      });
      view.setSelectedLines(next.selected ?? null);
    },
    unmount: () => {
      view.cleanUp();
      release();
      container.remove();
    },
  };
}

const REVEAL_LINES_ABOVE = 3;

function lineHeightOf(look: DiffLook): number {
  return Number(look.fontSize) * Number(LINE_HEIGHT_RATIO[look.lineHeight]);
}

const SCROLL_GLIDE = { TOKEN: "--ui-scroll-glide", AT_ONCE: "auto" } as const;

function glideOf(host: HTMLElement): "smooth-auto" | "instant" {
  const glide = getComputedStyle(host).getPropertyValue(SCROLL_GLIDE.TOKEN).trim();
  return glide === SCROLL_GLIDE.AT_ONCE ? "instant" : "smooth-auto";
}

function annotationsOf(notes: readonly DiffAnnotation[]): DiffLineAnnotation<string>[] {
  return notes.map((note) => ({ side: note.side, lineNumber: note.line, metadata: note.key }));
}

function leadPatchOf(path: string): FileDiffMetadata {
  return getSingularPatch(
    `diff --git a/${path} b/${path}\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+\n`,
  );
}

function patchOf(file: DiffListFile): FileDiffMetadata {
  if (file.lead) return leadPatchOf(file.path);
  try {
    return readPatch(file.patch);
  } catch {
    const path = file.path;
    return getSingularPatch(`diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n`);
  }
}

const NO_LINES: readonly number[] = [];

interface DrawnFile {
  readonly file: DiffListFile;
  readonly item: CodeViewDiffItem<string>;
  readonly read: FileDiffMetadata;
}

const UNEXPANDED_KIND = "rename-pure";

function drawnAs(read: FileDiffMetadata, expandable: boolean): FileDiffMetadata {
  const offered = read.type === "change" || read.type === "rename-changed";
  if (expandable || !offered) return read;
  const { cacheKey: _drawnUnder, ...drawn } = read;
  return { ...drawn, type: UNEXPANDED_KIND };
}

function selectionOf(range: SelectedLineRange): DiffSelection {
  const side = range.side ?? DIFF_SELECTION_SIDE.ADDITIONS;
  return { start: range.start, side, end: range.end, endSide: range.endSide ?? side };
}

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

function listOptions(
  drawn: DiffLook,
  latest: () => DiffListProps,
  dress: (element: HTMLElement, path: string, phase: PostRenderPhase) => void,
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
    layout: {
      paddingTop: LIST_FILE_GAP + (latest().topRoom ?? 0),
      paddingBottom: LIST_FOOT_ROOM,
      gap: LIST_FILE_GAP,
    },
    renderCustomHeader: (
      _drawn: FileDiffMetadata | FileContents,
      context: { item: { id: string } },
    ) => latest().renderHeader(context.item.id),
    renderAnnotation: (
      note: { metadata: string },
      _drawn: FileDiffMetadata | FileContents,
      context: { item: { id: string } },
    ) => latest().renderAnnotation(context.item.id, note.metadata),
    onPostRender: (
      node: HTMLElement,
      instance: PierreFileDiff<string, undefined> | PierreFile<string, undefined>,
      phase: PostRenderPhase,
      context: { item: { id: string } },
    ) => {
      dress(node, context.item.id, phase);
      if (phase !== "unmount" && instance instanceof PierreFileDiff) {
        drawnBy(context.item.id, instance);
      }
    },
  };
}

function rangeIn(root: ShadowRoot): Range | undefined {
  const [composed] = document.getSelection()?.getComposedRanges({ shadowRoots: [root] }) ?? [];
  if (composed === undefined || composed.collapsed) return undefined;
  const range = document.createRange();
  range.setStart(composed.startContainer, composed.startOffset);
  range.setEnd(composed.endContainer, composed.endOffset);
  return range;
}

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
  document.addEventListener("pointerup", letGo, true);
  return () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    host.removeEventListener("pointerdown", press);
    document.removeEventListener("pointerup", letGo, true);
  };
}

function mountList(host: HTMLElement, props: DiffListProps): DiffListHandle {
  let latest = props;
  const drawnFiles = new Map<string, DrawnFile>();
  const paths = new WeakMap<FileDiffMetadata, string>();
  const releases: Array<() => void> = [];
  const dressed = new WeakSet<HTMLElement>();
  const elementPaths = new WeakMap<EventTarget, string>();
  let flash: DiffLineRange | undefined;
  let deadline: Animation | undefined;
  const lit = (element: HTMLElement) =>
    flash !== undefined && elementPaths.get(element) === flash.path;
  const markFlash = (element: HTMLElement) => {
    if (!lit(element)) return element.removeAttribute(LANDED_ATTRIBUTE);
    if (!element.hasAttribute(LANDED_ATTRIBUTE))
      element.setAttribute(LANDED_ATTRIBUTE, LANDED.HELD);
  };
  const gapWatches = new Map<HTMLElement, () => void>();
  const watchGaps = (element: HTMLElement, phase: PostRenderPhase) => {
    const watching = gapWatches.get(element);
    if (phase === "unmount") {
      watching?.();
      gapWatches.delete(element);
    } else if (watching === undefined && element.shadowRoot !== null) {
      gapWatches.set(element, watchGapControls(element.shadowRoot));
    }
  };
  const dress = (element: HTMLElement, path: string, phase: PostRenderPhase) => {
    watchGaps(element, phase);
    if (phase !== "unmount" && element.shadowRoot !== null) {
      if ((drawnFiles.get(path)?.file.annotations.length ?? 0) > 0)
        markAnnotationBands(element.shadowRoot);
      if (latest.look.wrap) markLineIndents(element.shadowRoot);
    }
    element.toggleAttribute(LEAD_ATTRIBUTE, drawnFiles.get(path)?.file.lead === true);
    elementPaths.set(element, path);
    markFlash(element);
    if (dressed.has(element) || element.shadowRoot === null) return;
    dressed.add(element);
    element.setAttribute(FIND_SHADOW_ATTRIBUTE, FIND_SKIPPED);
    releases.push(adoptShadowStyles(element.shadowRoot, lookSheets().look));
    element.addEventListener("animationend", (event) => {
      if (event.target === element && event.animationName === LANDED_ANIMATION) endFlash();
    });
  };
  const drawn = drawnTeller((path, lines) => latest.onDrawn?.(path, lines));
  const tellDrawn = drawn.tell;
  const drawnBy = (path: string, instance: PierreFileDiff<string, undefined>) =>
    tellDrawn(path, drawnAmong(instance, drawnFiles.get(path)?.file.hidden ?? NO_LINES));
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
      if (item.fileDiff !== held?.item.fileDiff) tellDrawn(file.path, NO_LINES);
      else rehidden.add(file.path);
      return item;
    });
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
  const pathOf = (fileDiff: FileDiffMetadata) => paths.get(fileDiff) ?? fileDiff.name;
  const optionsFor = (next: DiffListProps) =>
    listOptions(next.look, () => latest, dress, drawnBy, commentable, pathOf);
  const highlighting = listHighlighting(props.look);
  const { pool } = highlighting;
  const view = new CodeView<string, undefined>(optionsFor(props), pool);
  view.setup(host);
  view.setItems(itemsOf(props.files));
  view.render(true);
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
  const light = (selected: DiffListSelection | undefined) => {
    if (selected === undefined) return view.clearSelectedLines();
    const { start, side, end, endSide } = selected.selection;
    view.setSelectedLines({ id: selected.path, range: { start, side, end, endSide } });
  };
  if (props.selected !== undefined) light(props.selected);
  const drawnElements = () => host.querySelectorAll<HTMLElement>(`[${FIND_SHADOW_ATTRIBUTE}]`);
  const endFlash = () => {
    const standing = flash;
    deadline?.cancel();
    deadline = undefined;
    if (standing === undefined) return;
    flash = undefined;
    for (const element of drawnElements()) markFlash(element);
    const now = view.getSelectedLines();
    const picked = now === null ? undefined : selectionOf(now.range);
    if (
      now?.id === standing.path &&
      picked?.start === standing.startLine &&
      picked.end === standing.endLine &&
      picked.side === standing.side &&
      picked.endSide === standing.side
    )
      light(latest.selected);
  };
  const revealLines = (range: DiffLineRange) => {
    const { path, side, startLine, endLine } = range;
    const lines = { start: startLine, side, end: endLine, endSide: side };
    flash = range;
    deadline?.cancel();
    deadline = host.animate([], { duration: FLASH_DEADLINE_MS });
    deadline.onfinish = endFlash;
    view.setSelectedLines({ id: path, range: lines });
    for (const element of drawnElements()) {
      if (lit(element)) land(element, LANDED.HELD);
      else element.removeAttribute(LANDED_ATTRIBUTE);
    }
    view.scrollTo({
      type: "range",
      id: path,
      range: lines,
      align: "start",
      offset: lineHeightOf(latest.look) * REVEAL_LINES_ABOVE,
      behavior: glideOf(host),
    });
  };
  return {
    update: (next) => {
      const was = latest;
      latest = next;
      typeset(host, next.look);
      if (!sameLook(next.look, was.look)) {
        void highlighting.follow(next.look);
      }
      if (
        !sameLook(next.look, was.look) ||
        (next.onComment === undefined) !== (was.onComment === undefined) ||
        (next.readTexts === undefined) !== (was.readTexts === undefined) ||
        next.topRoom !== was.topRoom
      )
        view.setOptions(optionsFor(next));
      view.setItems(itemsOf(next.files));
      view.render();
      drawn.forget(new Set(next.files.map((file) => file.path)));
      readRehidden();
      tellTop(host.scrollTop);
      if (!sameListSelection(next.selected, was.selected)) {
        if (flash === undefined) light(next.selected);
        else endFlash();
      }
    },
    reveal: (path) =>
      view.scrollTo({ type: "item", id: path, align: "start", behavior: glideOf(host) }),
    revealLine: (path, side, line) =>
      view.scrollTo({
        type: "line",
        id: path,
        lineNumber: line,
        side,
        align: "start",
        offset: lineHeightOf(latest.look) * REVEAL_LINES_ABOVE,
        behavior: glideOf(host),
      }),
    revealLines,
    unmount: () => {
      drawn.forget(new Set());
      deadline?.cancel();
      stopWatching();
      unsubscribe();
      view.cleanUp();
      for (const release of releases) release();
      for (const stop of gapWatches.values()) stop();
      gapWatches.clear();
      host.replaceChildren();
    },
  };
}

const WHOLE_FILE_ITEM = "file";

const WHOLE_FILE_EDGE = 6;

const WHOLE_FILE_KEYS_KEPT = HIGHLIGHT_CACHE_ENTRIES;

interface WholeFileKey {
  readonly name: string;
  readonly revision: string;
  readonly text: string;
  readonly key: string;
}

let wholeFileKeys: readonly WholeFileKey[] = [];

let wholeFilesRead = 0;

function wholeFileKey(name: string, revision: string, text: string): string {
  const same = (each: WholeFileKey) => each.name === name && each.revision === revision;
  const held = wholeFileKeys.find(same);
  if (held?.text !== text) wholeFilesRead += 1;
  const key = held?.text === text ? held.key : `whole-${wholeFilesRead}`;
  wholeFileKeys = [
    ...wholeFileKeys.filter((each) => !same(each)),
    { name, revision, text, key },
  ].slice(-WHOLE_FILE_KEYS_KEPT);
  return key;
}

function withoutFinalNewline(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

function fileAnnotationsOf(notes: readonly FileAnnotation[]): LineAnnotation<string>[] {
  return notes.map((note) => ({ lineNumber: note.line, metadata: note.key }));
}

function litRange(range: FileLineRange): SelectedLineRange {
  return { start: range.startLine, end: range.endLine };
}

function fileLinesOf(range: SelectedLineRange): FileLineRange {
  return { startLine: Math.min(range.start, range.end), endLine: Math.max(range.start, range.end) };
}

function quietGutter(element: HTMLElement): void {
  for (const gutter of element.shadowRoot?.querySelectorAll("[data-gutter]") ?? []) {
    gutter.setAttribute("aria-hidden", "true");
  }
}

function wholeFileOptions(
  drawn: DiffLook,
  latest: () => FileViewProps,
  dress: (element: HTMLElement, phase: PostRenderPhase) => void,
  pick: (range: SelectedLineRange | null) => void,
): CodeViewOptions<string, undefined> {
  return {
    theme: drawn.themes,
    themeType: "system",
    preferredHighlighter: preferredHighlighter(),
    tokenizeMaxLineLength: MAX_LINE_DIFF_LENGTH,
    disableLineNumbers: !drawn.lineNumbers,
    overflow: drawn.wrap ? "wrap" : "scroll",
    disableFileHeader: true,
    enableLineSelection: true,
    lineHoverHighlight: "number",
    onLineSelectionEnd: pick,
    itemMetrics: { lineHeight: lineHeightOf(drawn) },
    layout: { paddingTop: WHOLE_FILE_EDGE, paddingBottom: WHOLE_FILE_EDGE, gap: 0 },
    renderAnnotation: (note: { metadata: string }) => latest().renderAnnotation(note.metadata),
    onPostRender: (node: HTMLElement, _instance: unknown, phase: PostRenderPhase) =>
      dress(node, phase),
  };
}

function mountFile(host: HTMLElement, props: FileViewProps): FileViewHandle {
  let latest = props;
  const releases: Array<() => void> = [];
  const dressed = new WeakSet<HTMLElement>();
  let picked: FileLineRange | undefined;
  let drawnElement: HTMLElement | undefined;
  const ground = () => {
    if (drawnElement !== undefined) {
      host.style.backgroundColor = getComputedStyle(drawnElement).backgroundColor;
    }
  };
  releases.push(onDrawnThemeChange(ground));
  const dress = (element: HTMLElement, phase: PostRenderPhase) => {
    if (phase === "unmount") {
      if (drawnElement === element) drawnElement = undefined;
      return;
    }
    drawnElement = element;
    quietGutter(element);
    if (element.shadowRoot !== null && latest.look.wrap) markLineIndents(element.shadowRoot);
    if (!dressed.has(element) && element.shadowRoot !== null) {
      dressed.add(element);
      element.setAttribute(FIND_SHADOW_ATTRIBUTE, FIND_SKIPPED);
      releases.push(adoptShadowStyles(element.shadowRoot, lookSheets().whole));
    }
    ground();
    latest.onDrawn?.();
  };
  const pick = (range: SelectedLineRange | null) => {
    picked = range === null ? undefined : fileLinesOf(range);
  };
  const optionsFor = (next: FileViewProps) =>
    wholeFileOptions(next.look, () => latest, dress, pick);
  let version = 0;
  const itemOf = (next: FileViewProps): CodeViewItem<string> => {
    version += 1;
    return {
      id: WHOLE_FILE_ITEM,
      type: "file",
      file: {
        name: next.name,
        contents: withoutFinalNewline(next.text),
        cacheKey: wholeFileKey(next.name, next.revision, next.text),
      },
      annotations: fileAnnotationsOf(next.annotations),
      version,
    };
  };
  const light = (lit: FileLineRange | undefined) => {
    picked = undefined;
    if (lit === undefined) view.clearSelectedLines({ notify: false });
    else view.setSelectedLines({ id: WHOLE_FILE_ITEM, range: litRange(lit) }, { notify: false });
  };
  typeset(host, props.look);
  const highlighting = listHighlighting(props.look);
  const view = new CodeView<string, undefined>(optionsFor(props), highlighting.pool);
  view.setup(host);
  view.setItems([itemOf(props)]);
  view.render(true);
  if (props.lit !== undefined) light(props.lit);
  return {
    update: (next) => {
      const was = latest;
      latest = next;
      typeset(host, next.look);
      if (!sameLook(next.look, was.look)) {
        void highlighting.follow(next.look);
        view.setOptions(optionsFor(next));
      }
      const another =
        next.name !== was.name || next.text !== was.text || next.revision !== was.revision;
      if (another) picked = undefined;
      if (
        another ||
        !sameLook(next.look, was.look) ||
        !sameFileNotes(next.annotations, was.annotations)
      ) {
        view.setItems([itemOf(next)]);
        view.render();
      }
      if (!sameFileLines(next.lit, was.lit)) light(next.lit);
    },
    revealLines: (range) =>
      view.scrollTo({
        type: "range",
        id: WHOLE_FILE_ITEM,
        range: litRange(range),
        align: "center",
        behavior: "instant",
      }),
    pickedLines: () => {
      if (picked !== undefined) return picked;
      if (document.getSelection()?.isCollapsed !== false) return undefined;
      const root = drawnElement?.shadowRoot;
      const range = root === null || root === undefined ? undefined : rangeIn(root);
      const selection = range === undefined ? undefined : selectedLines(range);
      return selection === undefined
        ? undefined
        : fileLinesOf({ start: selection.start, end: selection.end });
    },
    unmount: () => {
      view.cleanUp();
      for (const release of releases) release();
      host.replaceChildren();
      host.style.removeProperty("background-color");
    },
  };
}

export const diffView: DiffViewModule = { mount, mountList, mountFile };
