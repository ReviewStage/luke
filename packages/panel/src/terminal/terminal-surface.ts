import { onDrawnThemeChange } from "@repo/ui/appearance";
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
 * terminal-surface.ts -- a terminal's screen: xterm.js made once for the terminal's life, shown in whichever box its tab draws, fitted to it, colored from the window's tokens, its keys sorted between the shell and the window.
 *
 * The screen is one element of its own, opened in the first box it is shown
 * in and moved between boxes after that, so a tab hidden and shown again
 * keeps its scrollback and the shell's own drawing, and a screen out of any
 * box goes on drawing what its shell prints. It draws with WebGL, and with
 * xterm's DOM renderer once the GPU process loses its context or where
 * WebGL is not to be had, the DOM renderer's rules
 * reaching the page as adopted sheets (`./adopted-styles.ts`). It draws in
 * the window's monospace face, or, while a web page is still fetching that
 * face, in the system's until it lands, so its cells are never measured in
 * one face and drawn in another, which would draw the screen past its box.
 * Wide characters are measured as Unicode 11 measures them, so an emoji or a
 * CJK character in a prompt takes the two cells a shell expects. It fits its
 * box whenever the box changes, once a frame at most, and never a box with
 * no room, and says so only when that changes its size in cells, which is
 * what a shell is told. It knows nothing of where its bytes come from: the
 * session hands it a shell's output and takes what is typed.
 */

/** The class the screen's own element wears, which `index.css` styles. */
const SURFACE_CLASS = "terminal-surface";

/** The token the terminal's typeface is read from, and the face it falls back to without one. */
const FONT_TOKEN = "--ui-font-mono";
const FALLBACK_FONT = "monospace";

/**
 * How the terminal draws and keeps its lines: the code's size and leading,
 * a block cursor that holds still, and colors held legible on either
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
 * Draws with WebGL, and with the DOM renderer once the GPU process loses its
 * context, or where WebGL is not to be had; `dom` hears the DOM renderer
 * take over. Note that the DOM renderer's colors are held to the palette:
 * it writes a 24-bit color, or one it adjusted for contrast, as a style
 * attribute, which the panel's policy refuses, so a cell left to it would
 * lose its color altogether, where a palette color reaches it as a class
 * (`./adopted-styles.ts`).
 */
function drawWithWebgl(terminal: Terminal, dom: () => void): void {
  const webgl = loadWebgl(terminal);
  if (webgl === undefined) {
    dom();
    return;
  }
  webgl.onContextLoss(() => {
    webgl.dispose();
    dom();
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

/**
 * Whether the face given has loaded, which a page answers for a web font
 * only once something has drawn in it; the desktop's faces are the
 * system's, loaded already.
 */
function faceLoaded(face: string): boolean {
  return !("fonts" in document) || document.fonts.check(face);
}

/** Calls `then` once the face given has loaded; a face that fails to load never calls it. */
function onFaceLanded(face: string, then: () => void): void {
  document.fonts.load(face).then(then, () => undefined);
}

/** Whether a box has room to fit a screen into: in the document, and with a width and a height. */
function hasRoom(element: HTMLElement): boolean {
  return element.isConnected && element.clientWidth > 0 && element.clientHeight > 0;
}

export function createTerminal(props: TerminalProps): TerminalHandle {
  const screen = document.createElement("div");
  screen.classList.add(SURFACE_CLASS);
  const stopAdopting = adoptInlineStyles(screen);
  const terminal = new Terminal(TERMINAL_LOOK);
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
  const find = scrollbackFind(terminal, screen);
  // Whether the output is dimmed, and the contrast floor the renderer drawing now takes.
  let dimmed = false;
  let contrast: number = TERMINAL_LOOK.minimumContrastRatio;
  // Note that a dimmed screen is dimmed in its colors, never by the box's opacity, and its contrast floor is lifted, because the floor would lift the output back out of its dimming.
  const retheme = () => {
    if (!screen.isConnected) return;
    terminal.options.theme = terminalTheme(screen, dimmed);
    terminal.options.minimumContrastRatio = dimmed ? 1 : contrast;
  };

  // The size is said once the screen has first been fitted to a box with room, then as it changes.
  let fitted = false;
  const heard = [
    terminal.onData(props.onInput),
    terminal.onResize((size) => {
      if (fitted) props.onResize(size);
    }),
  ];
  const fitNow = () => {
    if (!hasRoom(screen) || fit.proposeDimensions() === undefined) return;
    fit.fit();
    if (fitted) return;
    fitted = true;
    props.onResize({ cols: terminal.cols, rows: terminal.rows });
  };

  // A box resized many times in a frame is fitted once, at the frame.
  let frame: number | undefined;
  const resized = new ResizeObserver(() => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      fitNow();
    });
  });
  resized.observe(screen);
  const stopRetheming = onDrawnThemeChange(retheme);

  // The screen opens in the first box it is shown in, which its face and colors are read from.
  let opened = false;
  let disposed = false;
  const open = () => {
    opened = true;
    const family = monospaceFont(screen);
    const face = `${TERMINAL_LOOK.fontSize}px ${family}`;
    // Note that a face still on its way is stood in for by the system's, because the terminal measures its cells as it opens.
    const landed = faceLoaded(face);
    terminal.options.fontFamily = landed ? family : FALLBACK_FONT;
    retheme();
    terminal.open(screen);
    drawWithWebgl(terminal, () => {
      contrast = 1;
      retheme();
    });
    // A face that lands later is drawn in from then, its cells measured again as a change of face measures them, and the screen fitted to them.
    if (landed) return;
    onFaceLanded(face, () => {
      if (disposed) return;
      terminal.options.fontFamily = family;
      fitNow();
    });
  };

  return {
    write: (data, written) => terminal.write(data, written),
    attach: (host) => {
      host.append(screen);
      if (!opened) open();
      else {
        // Note that the colors are read again, since the appearance may have flipped while the screen stood out of the document.
        retheme();
        terminal.refresh(0, terminal.rows - 1);
      }
      fitNow();
    },
    detach: () => screen.remove(),
    dim: (dim) => {
      dimmed = dim;
      retheme();
    },
    focus: () => terminal.focus(),
    find,
    dispose: () => {
      disposed = true;
      resized.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      stopRetheming();
      for (const each of heard) each.dispose();
      terminal.dispose();
      stopAdopting();
      screen.remove();
    },
  };
}
