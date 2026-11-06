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

const SURFACE_CLASS = "terminal-surface";

const FONT_TOKEN = "--ui-font-mono";
const FALLBACK_FONT = "monospace";

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

const DIM_ATTRIBUTE = "data-dim";

function isDim(host: HTMLElement): boolean {
  return host.getAttribute(DIM_ATTRIBUTE) === "true";
}

const UNICODE_VERSION = "11";

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

function scrollbackFind(terminal: Terminal, host: Element): TerminalFind {
  const search = new SearchAddon({ highlightLimit: FIND_LIMIT });
  terminal.loadAddon(search);
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

const FIND_LIMIT = 1_000;

function monospaceFont(host: Element): string {
  return getComputedStyle(host).getPropertyValue(FONT_TOKEN).trim() || FALLBACK_FONT;
}

function faceLoaded(face: string): boolean {
  return !("fonts" in document) || document.fonts.check(face);
}

function onFaceLanded(face: string, then: () => void): void {
  document.fonts.load(face).then(then, () => undefined);
}

export function mountTerminal(host: HTMLElement, props: TerminalProps): TerminalHandle {
  host.classList.add(SURFACE_CLASS);
  const stopAdopting = adoptInlineStyles(host);
  const family = monospaceFont(host);
  const face = `${TERMINAL_LOOK.fontSize}px ${family}`;
  const landed = faceLoaded(face);
  const terminal = new Terminal({
    ...TERMINAL_LOOK,
    fontFamily: landed ? family : FALLBACK_FONT,
    theme: terminalTheme(host, isDim(host)),
  });
  terminal.attachCustomKeyEventHandler((event) => {
    const key = terminalKey(event);
    if (key.kind === TERMINAL_KEY.SHELL) return true;
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
  const contrast = terminal.options.minimumContrastRatio ?? 1;
  const find = scrollbackFind(terminal, host);
  const heard = [terminal.onData(props.onInput), terminal.onResize(props.onResize)];
  fit.fit();

  let mounted = true;
  if (!landed) {
    onFaceLanded(face, () => {
      if (!mounted) return;
      terminal.options.fontFamily = family;
      fit.fit();
    });
  }

  const retheme = () => {
    const dim = isDim(host);
    terminal.options.theme = terminalTheme(host, dim);
    terminal.options.minimumContrastRatio = dim ? 1 : contrast;
  };
  const stopRetheming = onDrawnThemeChange(retheme);
  const dimming = new MutationObserver(retheme);
  dimming.observe(host, { attributes: true, attributeFilter: [DIM_ATTRIBUTE] });

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
      mounted = false;
      resized.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      stopRetheming();
      dimming.disconnect();
      for (const each of heard) each.dispose();
      terminal.dispose();
      stopAdopting();
      host.classList.remove(SURFACE_CLASS);
    },
  };
}
