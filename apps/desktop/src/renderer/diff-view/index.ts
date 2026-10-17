import { DIFF_FONT, DIFF_LAYOUT, DIFF_LINE_HEIGHT } from "@luke/settings/diff-view";
import { type FileDiffOptions, getSingularPatch, FileDiff as PierreFileDiff } from "@pierre/diffs";
import { FIND_SHADOW_ATTRIBUTE } from "../find-matches";
import type { DiffLook, DiffViewHandle, DiffViewModule, DiffViewProps } from "./contract";
import { adoptShadowStyles } from "./inline-styles";

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
 * WebAssembly. Pierre's worker pool is not used: one file is drawn at a
 * time, on the window's own thread, and the policy admits a worker only
 * from a `blob:`.
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
  /* The theme's ground runs to the foot of the box a diff is drawn in, however few its lines. */
  :host {
    display: block;
    min-height: 100%;
  }
  pre {
    box-sizing: border-box;
    min-height: 100%;
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

/** Pierre's options for what is drawn and how: a whole file's patch, or an excerpt with nothing said of the lines around it. */
function optionsOf(drawn: DiffLook, excerpt: boolean): FileDiffOptions<undefined, undefined> {
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
    hunkSeparators: excerpt ? "simple" : "line-info-basic",
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
  const release = adoptShadowStyles(root, look());
  typeset(container, props.look);
  const view = new PierreFileDiff<undefined, undefined>(
    optionsOf(props.look, props.excerpt === true),
  );
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
      view.setOptions(optionsOf(next.look, next.excerpt === true));
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

export const diffView: DiffViewModule = { mount };
