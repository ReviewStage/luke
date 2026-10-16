import { type FileDiffOptions, getSingularPatch, FileDiff as PierreFileDiff } from "@pierre/diffs";
import { FIND_SHADOW_ATTRIBUTE } from "../find-matches";
import {
  DIFF_LAYOUT,
  type DiffLook,
  type DiffViewHandle,
  type DiffViewModule,
  type DiffViewProps,
} from "./contract";
import { adoptShadowStyles } from "./inline-styles";

/**
 * index.ts -- the diff bundle: one changed file's patch drawn by Pierre's diffs, unified or split, its changed words marked, in the File tab's colours.
 *
 * Built on its own as `diff-view.js` (`scripts/build.mjs`), an ES module
 * split into chunks, and loaded by the Files changed view the first time it
 * shows a diff, so the bundle every window parses never carries Pierre or
 * Shiki; each language's grammar is a chunk of its own, fetched the first
 * time a file of that language is drawn. Shiki colours the code in the File
 * tab's two themes (`@luke/host`'s `task-code.ts`), each appearance's taken
 * as the system's changes, and runs its grammars on its JavaScript engine,
 * since the panel's policy admits no WebAssembly. Pierre's worker pool is
 * not used: one file is drawn at a time, on the window's own thread, and the
 * policy admits a worker only from a `blob:`.
 *
 * Pierre draws in a shadow root of its own. The panel's look reaches it
 * through the `--diffs-*` properties a sheet adopted there sets from the
 * window's tokens (`styles/base.css`), which a shadow root inherits, so the
 * diff stands on the code's own ground with the File tab's type, numbers,
 * and the diff tints every place a diff is drawn shares; the markup Pierre
 * writes its layout and colours in is applied through the CSSOM
 * (`./inline-styles.ts`). The host is marked for the tab's find, which reads
 * the shadow root's words and leaves out its gutter, as a File tab's
 * numbers are, and the same sheet paints the find's matches there, since a
 * document's `::highlight` rules do not reach into a shadow root.
 *
 * A changed line marks the words it changed (Pierre's `word-alt`, words
 * joined across the spaces between them) unless told not to, and a line too
 * long to compare is tinted whole. Between two hunks stands how many
 * unchanged lines they leave out, with no offer to show them, since the
 * service reads the patch alone and those lines are not at hand.
 */

/** The File tab's two themes, by Shiki's names, so a diff is coloured as the file it changes. */
const THEMES = { dark: "github-dark-default", light: "github-light-default" } as const;

/** The longest line, in characters, whose changed words are marked; a longer one is tinted whole. */
const MAX_LINE_DIFF_LENGTH = 1000;

/** What the find leaves out of the shadow root's words: the gutter of numbers, as a File tab's numbers are. */
const FIND_SKIPPED = "[data-gutter]";

/**
 * The panel's look in the shadow root, from the window's tokens, in
 * Pierre's last layer so it stands over the theme's own ground and tints.
 */
const LOOK_CSS = `
@layer unsafe {
  :host {
    --diffs-font-family: var(--font-mono);
    --diffs-header-font-family: var(--font-mono);
    --diffs-font-size: 11.5px;
    --diffs-line-height: 1.6;
    --diffs-light-bg: var(--code-ground);
    --diffs-dark-bg: var(--code-ground);
    --diffs-light: var(--code-text);
    --diffs-dark: var(--code-text);
    --diffs-fg-number-override: var(--code-line-number);
    --diffs-addition-color-override: var(--diff-added-mark);
    --diffs-deletion-color-override: var(--diff-removed-mark);
    --diffs-bg-addition-override: var(--diff-added-ground);
    --diffs-bg-deletion-override: var(--diff-removed-ground);
    --diffs-bg-addition-number-override: var(--diff-added-ground);
    --diffs-bg-deletion-number-override: var(--diff-removed-ground);
    --diffs-bg-addition-emphasis-override: var(--diff-added-word);
    --diffs-bg-deletion-emphasis-override: var(--diff-removed-word);
    --diffs-bg-separator-override: var(--code-pointed);
  }
  pre {
    background-color: var(--code-ground);
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
  ::highlight(find-match) {
    background-color: var(--find-match);
  }
  ::highlight(find-current) {
    background-color: var(--find-current);
    color: var(--find-current-text);
  }
}
`;

let lookSheet: CSSStyleSheet | undefined;

/** The look's sheet, made once and adopted by every diff's shadow root. */
function look(): CSSStyleSheet {
  if (lookSheet !== undefined) return lookSheet;
  lookSheet = new CSSStyleSheet();
  lookSheet.replaceSync(LOOK_CSS);
  return lookSheet;
}

/** Pierre's options for a look. */
function optionsOf(drawn: DiffLook): FileDiffOptions<undefined, undefined> {
  return {
    theme: THEMES,
    themeType: "system",
    preferredHighlighter: "shiki-js",
    diffStyle: drawn.layout === DIFF_LAYOUT.SPLIT ? "split" : "unified",
    diffIndicators: "bars",
    lineDiffType: drawn.changedWords ? "word-alt" : "none",
    maxLineDiffLength: MAX_LINE_DIFF_LENGTH,
    disableLineNumbers: !drawn.lineNumbers,
    overflow: drawn.wrap ? "wrap" : "scroll",
    hunkSeparators: "line-info-basic",
    disableFileHeader: true,
  };
}

function mount(host: HTMLElement, props: DiffViewProps): DiffViewHandle {
  const container = document.createElement("diffs-container");
  container.setAttribute(FIND_SHADOW_ATTRIBUTE, FIND_SKIPPED);
  host.append(container);
  const root = container.shadowRoot ?? container.attachShadow({ mode: "open" });
  const release = adoptShadowStyles(root, look());
  const view = new PierreFileDiff<undefined, undefined>(optionsOf(props.look));
  let patch = props.patch;
  let fileDiff = getSingularPatch(patch);
  view.render({ fileDiff, fileContainer: container });
  return {
    update: (next) => {
      if (next.patch !== patch) {
        patch = next.patch;
        fileDiff = getSingularPatch(patch);
      }
      view.setOptions(optionsOf(next.look));
      view.render({ fileDiff, fileContainer: container, forceRender: true });
    },
    unmount: () => {
      view.cleanUp();
      release();
      container.remove();
    },
  };
}

const module: DiffViewModule = { mount };

window.lukeDiffView = module;
