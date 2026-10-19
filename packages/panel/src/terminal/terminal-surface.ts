import { onDrawnThemeChange } from "@luke/ui/appearance";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { adoptInlineStyles } from "./adopted-styles.js";
import {
  TERMINAL_FIND,
  type TerminalFind,
  type TerminalFindWay,
  type TerminalHandle,
  type TerminalProps,
} from "./contract.js";
import { TERMINAL_KEY, terminalKey } from "./terminal-keys.js";
import { terminalFindTints, terminalTheme } from "./terminal-theme.js";

/**
 * terminal-surface.ts -- a terminal's screen: xterm.js fitted to its box, coloured from the window's tokens, its keys sorted between the shell and the window.
 *
 * It draws with WebGL, and with xterm's DOM renderer where WebGL is not to be
 * had, the DOM renderer's rules reaching the page as adopted sheets
 * (`./adopted-styles.ts`). Wide characters are measured as
 * Unicode 11 measures them, so an emoji or a CJK character in a prompt takes
 * the two cells a shell expects. It fits its box whenever the box changes,
 * once a frame at most, and says so only when that changes its size in
 * cells, which is what a shell is told. It knows nothing of where its bytes
 * come from: the tab hands it a shell's output and takes what is typed.
 */

/** The class the host wears while a terminal is mounted in it, which `index.css` styles. */
const SURFACE_CLASS = "terminal-surface";

/** The token the terminal's typeface is read from, and the face it falls back to without one. */
const FONT_TOKEN = "--luke-font-mono";
const FALLBACK_FONT = "monospace";

/**
 * How the terminal draws and keeps its lines: the code's size and leading,
 * a block cursor that holds still, and colours held legible on either
 * appearance's ground, as VS Code's terminal holds them. Option types the
 * character the layout gives it rather than acting as Meta, and Option held
 * while dragging selects text even where a program such as tmux takes the
 * mouse. The Unicode addon is proposed API.
 */
const TERMINAL_LOOK = {
  fontSize: 12,
  lineHeight: 1.4,
  cursorBlink: false,
  cursorStyle: "block",
  scrollback: 10_000,
  minimumContrastRatio: 4.5,
  macOptionIsMeta: false,
  macOptionClickForcesSelection: true,
  allowProposedApi: true,
} as const;

/** The Unicode version wide characters are measured by. */
const UNICODE_VERSION = "11";

/** A WebGL renderer loaded into the terminal, or nothing where the window cannot make one. */
function loadWebgl(terminal: Terminal): WebglAddon | undefined {
  if (!("WebGL2RenderingContext" in window)) return undefined;
  const webgl = new WebglAddon();
  try {
    terminal.loadAddon(webgl);
    return webgl;
  } catch {
    webgl.dispose();
    return undefined;
  }
}

/**
 * Draws with WebGL, on a fresh context whenever the GPU process loses one.
 * Where none can be made the DOM renderer draws instead, its colours held to
 * the palette: it writes a 24-bit colour, or one it adjusted for contrast,
 * as a style attribute, which the panel's policy refuses, so a cell left to
 * it would lose its colour altogether, where a palette colour reaches it as
 * a class (`./adopted-styles.ts`).
 */
function drawWithWebgl(terminal: Terminal): void {
  const webgl = loadWebgl(terminal);
  if (webgl === undefined) {
    terminal.options.minimumContrastRatio = 1;
    return;
  }
  webgl.onContextLoss(() => {
    webgl.dispose();
    drawWithWebgl(terminal);
  });
}

/**
 * A find over the scrollback through the search addon: every match tinted
 * in the find's tokens, the current one brightest, both marked in the
 * scrollbar's ruler, and each step bringing its match into view. A query
 * typed further keeps to the match it was at, as the window's own find
 * does. Note that the tints are read as the find runs, so a find after the
 * appearance flips draws in the new one's.
 */
function scrollbackFind(terminal: Terminal, host: Element): TerminalFind {
  const search = new SearchAddon({ highlightLimit: FIND_LIMIT });
  terminal.loadAddon(search);
  // The query found last, which a query typed further keeps to the match of.
  let last = "";
  const options = (way: TerminalFindWay) => {
    const { match, current } = terminalFindTints(host);
    return {
      incremental: way === TERMINAL_FIND.TYPED,
      decorations: {
        matchBackground: match,
        matchOverviewRuler: match,
        activeMatchBackground: current,
        activeMatchColorOverviewRuler: current,
      },
    };
  };
  return {
    // Note that a query typed afresh is found from the newest output up,
    // as a terminal's recent lines are what a find is after, and one typed
    // further keeps to the match it was at.
    find: (query, way) => {
      const fresh = way === TERMINAL_FIND.TYPED && (last === "" || !query.startsWith(last));
      last = query;
      if (way === TERMINAL_FIND.PREVIOUS || fresh) search.findPrevious(query, options(way));
      else search.findNext(query, options(way));
    },
    clear: () => {
      last = "";
      search.clearDecorations();
      terminal.clearSelection();
    },
    onTally: (listener) => {
      const heard = search.onDidChangeResults(({ resultIndex, resultCount }) =>
        listener({ count: resultCount, at: resultIndex, more: resultCount >= FIND_LIMIT }),
      );
      return () => heard.dispose();
    },
    selection: () => terminal.getSelection(),
  };
}

/** The most matches a find tints and counts; past it the tally says there are more. */
const FIND_LIMIT = 1_000;

/** The typeface the terminal draws in: the window's one monospace stack. */
function monospaceFont(host: Element): string {
  return getComputedStyle(host).getPropertyValue(FONT_TOKEN).trim() || FALLBACK_FONT;
}

export function mountTerminal(host: HTMLElement, props: TerminalProps): TerminalHandle {
  host.classList.add(SURFACE_CLASS);
  const stopAdopting = adoptInlineStyles(host);
  const terminal = new Terminal({
    ...TERMINAL_LOOK,
    fontFamily: monospaceFont(host),
    theme: terminalTheme(host),
  });
  terminal.attachCustomKeyEventHandler((event) => {
    const key = terminalKey(event);
    if (key.kind === TERMINAL_KEY.SHELL) return true;
    // Note that the press is claimed whole on its keydown, because the
    // keypress after it would type Return into the shell as well, and the
    // window's keymap would read ⌘⌫ as deleting the task.
    if (key.kind === TERMINAL_KEY.SEND && event.type === "keydown") {
      event.preventDefault();
      event.stopPropagation();
      terminal.input(key.data, true);
    }
    return false;
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.loadAddon(new Unicode11Addon());
  terminal.unicode.activeVersion = UNICODE_VERSION;
  terminal.loadAddon(
    new WebLinksAddon((event, url) => {
      if (event.metaKey) props.onLink(url);
    }),
  );
  terminal.open(host);
  drawWithWebgl(terminal);
  const find = scrollbackFind(terminal, host);
  const heard = [terminal.onData(props.onInput), terminal.onResize(props.onResize)];
  fit.fit();

  // The tokens' values flip with the appearance, and the canvas holds the old ones until told.
  const stopRetheming = onDrawnThemeChange(() => {
    terminal.options.theme = terminalTheme(host);
  });

  // A box resized many times in a frame is fitted once, at the frame.
  let frame: number | undefined;
  const resized = new ResizeObserver(() => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      fit.fit();
    });
  });
  resized.observe(host);

  return {
    write: (data, written) => terminal.write(data, written),
    size: () => ({ cols: terminal.cols, rows: terminal.rows }),
    focus: () => terminal.focus(),
    reset: () => terminal.reset(),
    find,
    unmount: () => {
      resized.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      stopRetheming();
      for (const each of heard) each.dispose();
      terminal.dispose();
      stopAdopting();
      host.classList.remove(SURFACE_CLASS);
    },
  };
}
