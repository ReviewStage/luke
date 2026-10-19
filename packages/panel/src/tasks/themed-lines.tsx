/**
 * themed-lines.tsx -- a File tab's lines, and a page's source, in the syntax themes View settings chose: the host's GitHub colours where those are the themes, and otherwise each window of lines coloured again as a diff is, the host's colours standing until then.
 *
 * The host colours every line it reads in GitHub's two themes
 * (`@luke/host`'s `task-code.ts`), which are View settings' own defaults,
 * so lines in the default themes are drawn as the host coloured them and
 * the diff bundle is never loaded for them. Where another pair is chosen,
 * the diff bundle colours each window of lines held (`file-tab-model.ts`'s
 * `windowAt`) as a diff's lines are, in its pool's workers
 * (`diff-view/index.ts`'s `colourLines`), and the window's lines take its
 * colours once they land, the same words in the same boxes, so nothing
 * moves; the run stands on the theme's ground. A window the host drew
 * plain, or the bundle names no grammar for, or whose words came back
 * otherwise, keeps the host's colours: a window is never left plainer than
 * the host drew it. Colours are kept per window under the read and the
 * themes they were made for, so a run drawn again takes them at once, each
 * checked against the window's own words before it is drawn.
 */

import { useAtomValue } from "@effect/atom-react";
import type { CodeLines } from "@luke/features/tasks-view";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import {
  type ComponentProps,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSideBundles } from "../bundle-loader.js";
import type { ColouredLines, DiffLook } from "../diff-view/contract.js";
import { CodeLinesView } from "./code-lines.js";
import { useDiffLook } from "./file-diff.js";
import { windowAt } from "./file-tab-model.js";
import { DEFAULT_SETTINGS, useFileViewSettings } from "./file-view-settings.js";

/** A run of lines' own props, its scroller handed as a box to read, which the colouring reads the view off. */
type CodeLinesViewProps = Omit<ComponentProps<typeof CodeLinesView>, "scrollerRef"> & {
  readonly scrollerRef?: RefObject<HTMLDivElement | null> | undefined;
};

/** The read a run of lines came from: what was read, a file's path or a page's id, and at which revision, a commit or a version. */
export interface RunRead {
  readonly source: string;
  readonly revision: string;
}

/** What names a run of lines for its colouring: its file's name, which its grammar is read from, and the read it came from. */
interface RunName {
  readonly name: string;
  readonly read: RunRead;
}

/** A window of the lines held: where it starts, and its lines as the host coloured them. */
interface HeldWindow {
  readonly firstLine: number;
  readonly lines: CodeLines;
}

/** The lines held, cut at each window's edge, as they were read. */
function windowsOf(firstLine: number, lines: CodeLines): HeldWindow[] {
  const windows: HeldWindow[] = [];
  let at = 0;
  while (at < lines.length) {
    const line = firstLine + at;
    const take = windowAt(line).lastLine - line + 1;
    windows.push({ firstLine: line, lines: lines.slice(at, at + take) });
    at += take;
  }
  return windows;
}

/** A line's words, its runs joined. */
function wordsOf(line: CodeLines[number]): string {
  return line.map((run) => run.text).join("");
}

/** Whether the host coloured any run of a window, which a window it drew plain did not. */
function hostColoured(window: HeldWindow): boolean {
  return window.lines.some((line) => line.some((run) => run.color !== undefined));
}

/** Whether the colours came back over the window's own words, line for line, so taking them moves nothing. */
function sameWords(window: HeldWindow, coloured: ColouredLines): boolean {
  return (
    coloured.lines.length === window.lines.length &&
    coloured.lines.every((line, index) => {
      const held = window.lines[index];
      return held !== undefined && wordsOf(line) === wordsOf(held);
    })
  );
}

/** How many windows' colours are kept across every File tab and page source, the oldest let go first, so one opened again is drawn in its theme at once. */
const KEPT_WINDOWS = 64;

/** Colours by the first line of their window; none where a window keeps the host's. */
type WindowColours = Map<number, ColouredLines | null>;

/** Each window's colours, by read, then revision, then dark and light theme, then the window's first line. */
const keptColours = new Map<string, Map<string, Map<string, Map<string, WindowColours>>>>();

/** Each window kept, oldest first, by the identifiers it is kept under. */
const keptOrder: {
  readonly read: RunRead;
  readonly themes: DiffLook["themes"];
  readonly firstLine: number;
}[] = [];

/** The windows kept for a read in a pair of themes, made where `make` asks and none stands. */
function keptWindows(
  read: RunRead,
  themes: DiffLook["themes"],
  make: boolean,
): WindowColours | undefined {
  const step = <Value,>(map: Map<string, Value>, key: string, fresh: () => Value) => {
    const found = map.get(key);
    if (found !== undefined || !make) return found;
    const made = fresh();
    map.set(key, made);
    return made;
  };
  const revisions = step(keptColours, read.source, () => new Map());
  const darks = revisions && step(revisions, read.revision, () => new Map());
  const lights = darks && step(darks, themes.dark, () => new Map());
  return lights && step(lights, themes.light, (): WindowColours => new Map());
}

/** Keeps a window's colours, the oldest window kept let go past `KEPT_WINDOWS`. */
function keep(
  read: RunRead,
  themes: DiffLook["themes"],
  firstLine: number,
  coloured: ColouredLines | null,
): void {
  keptWindows(read, themes, true)?.set(firstLine, coloured);
  keptOrder.push({ read, themes, firstLine });
  while (keptOrder.length > KEPT_WINDOWS) {
    const oldest = keptOrder.shift();
    if (oldest !== undefined)
      keptWindows(oldest.read, oldest.themes, false)?.delete(oldest.firstLine);
  }
}

/** How many windows are out to the bundle at once, one per worker, so the window scrolled to next is asked for before those far from it. */
const OUT_AT_ONCE = 2;

/** The line in the middle of the scroller's view, read off its scroll by the lines' mean height; the run's first where it has not scrolled. */
function lineInView(scroller: HTMLElement | null, firstLine: number, count: number): number {
  if (scroller === null || scroller.scrollHeight === 0 || count === 0) return firstLine;
  const middle = scroller.scrollTop + scroller.clientHeight / 2;
  return firstLine + Math.floor((middle / scroller.scrollHeight) * count);
}

/** How far a window stands from a line, in lines: none for the window holding it. */
function distance(window: HeldWindow, line: number): number {
  const last = window.firstLine + window.lines.length - 1;
  if (line < window.firstLine) return window.firstLine - line;
  return line > last ? line - last : 0;
}

/** What a mounted run asked for, under the read and themes it asked in: each window's colours as they landed, and those out. */
interface Asked {
  readonly read: RunRead;
  readonly themes: DiffLook["themes"];
  readonly landed: WindowColours;
  readonly out: Set<number>;
}

/** Whether two reads, or two pairs of themes, are one. */
function sameRead(a: RunRead, b: RunRead): boolean {
  return a.source === b.source && a.revision === b.revision;
}

function sameThemes(a: DiffLook["themes"], b: DiffLook["themes"]): boolean {
  return a.dark === b.dark && a.light === b.light;
}

/**
 * The lines in the themes chosen: each window's colours as they land from
 * the diff bundle, the window in view asked for first and the rest by how
 * near they stand to it, asked again as the view scrolls; colours kept from
 * an earlier drawing taken at once; the host's until then, wherever the
 * bundle gives none, and wherever kept colours are not over the window's
 * words; and the theme's ground once a window has its colours. Note that
 * what the mounted run asked for is its own, never let go while it stands,
 * so a run of more windows than are kept asks for each once.
 */
function RecolouredLinesView({
  name,
  read,
  firstLine,
  lines,
  scrollerRef,
  ...props
}: CodeLinesViewProps & RunName): React.JSX.Element {
  const loaded = useAtomValue(useSideBundles().diffView);
  const module = AsyncResult.isSuccess(loaded) ? loaded.value : undefined;
  const look = useDiffLook(false);
  const [, setLandings] = useState(0);
  const asked = useRef<Asked | undefined>(undefined);
  if (
    asked.current === undefined ||
    !sameRead(asked.current.read, read) ||
    !sameThemes(asked.current.themes, look.themes)
  ) {
    asked.current = { read, themes: look.themes, landed: new Map(), out: new Set() };
  }
  const own = useRef<HTMLDivElement | null>(null);
  const scroller = scrollerRef ?? own;
  const windows = windowsOf(firstLine, lines);

  /** A window's colours, its own or kept, where they stand over its words; none otherwise. */
  const colouredOf = (window: HeldWindow, run: Asked): ColouredLines | null | undefined => {
    const kept = keptWindows(run.read, run.themes, false);
    const from = run.landed.has(window.firstLine) ? run.landed : kept;
    if (from === undefined || !from.has(window.firstLine)) return undefined;
    // Note that a window given no colours keeps the host's, its own or kept, and is not asked for again.
    const found = from.get(window.firstLine);
    if (found === null || found === undefined) return null;
    return sameWords(window, found) ? found : undefined;
  };

  const latest = useRef({ windows, module, look, colouredOf });
  latest.current = { windows, module, look, colouredOf };
  // Asks for the windows nearest the view not yet coloured, as many as may be out at once.
  const askNext = useCallback(() => {
    const { windows, module, look, colouredOf } = latest.current;
    const run = asked.current;
    if (module === undefined || run === undefined) return;
    const line = lineInView(scroller.current, windows[0]?.firstLine ?? 1, lines.length);
    const waiting = windows
      .filter(
        (window) =>
          colouredOf(window, run) === undefined &&
          !run.out.has(window.firstLine) &&
          hostColoured(window),
      )
      .sort((a, b) => distance(a, line) - distance(b, line));
    for (const window of waiting) {
      if (run.out.size >= OUT_AT_ONCE) return;
      run.out.add(window.firstLine);
      module
        .colourLines({ name, lines: window.lines.map(wordsOf), look })
        .then(
          (coloured) => (coloured !== undefined && sameWords(window, coloured) ? coloured : null),
          () => null,
        )
        .then((kept) => {
          run.out.delete(window.firstLine);
          run.landed.set(window.firstLine, kept);
          keep(run.read, run.themes, window.firstLine, kept);
          setLandings((landings) => landings + 1);
          askNext();
        });
    }
  }, [name, lines.length, scroller]);

  useEffect(askNext);
  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    element.addEventListener("scroll", askNext, { passive: true });
    return () => element.removeEventListener("scroll", askNext);
  }, [askNext, scroller]);

  const drawn: CodeLines[number][] = [];
  let ground: ColouredLines["ground"] | undefined;
  for (const window of windows) {
    const coloured = colouredOf(window, asked.current);
    if (coloured === undefined || coloured === null) drawn.push(...window.lines);
    else {
      drawn.push(...coloured.lines);
      ground ??= coloured.ground;
    }
  }
  return (
    <CodeLinesView
      {...props}
      scrollerRef={scroller}
      firstLine={firstLine}
      lines={drawn}
      ground={ground}
    />
  );
}

/** The themes a pair other than View settings' defaults is chosen in, which the diff bundle colours lines in. */
function useChosenThemes(): boolean {
  const { settings } = useFileViewSettings();
  return (
    settings.diffDarkTheme !== DEFAULT_SETTINGS.diffDarkTheme ||
    settings.diffLightTheme !== DEFAULT_SETTINGS.diffLightTheme
  );
}

/** Loads the diff bundle and has its pool colour one empty line of a file's name, so its workers hold the themes and the grammar before the file's lines land. */
function WarmColours({ name }: { name: string }): null {
  const loaded = useAtomValue(useSideBundles().diffView);
  const module = AsyncResult.isSuccess(loaded) ? loaded.value : undefined;
  const look = useDiffLook(false);
  const { dark, light } = look.themes;
  const latest = useRef(look);
  latest.current = look;
  useEffect(() => {
    if (module === undefined) return;
    module.colourLines({ name, lines: [""], look: latest.current }).catch(() => undefined);
    // Note that each pair warms once: a change of type alone warms nothing new.
  }, [module, name, dark, light]);
  return null;
}

/**
 * Warms the colouring of a file's lines where another pair than the
 * default is chosen, as soon as the file is opened rather than once its
 * lines land; nothing in the default pair, which loads nothing.
 */
export function ThemeWarmer({ name }: { name: string }): React.JSX.Element | null {
  return useChosenThemes() ? <WarmColours name={name} /> : null;
}

/**
 * A run of lines in the syntax themes View settings chose: as the host
 * coloured them in the default themes, the diff bundle never loaded; and
 * coloured again in any other pair.
 */
export function ThemedCodeLinesView(props: CodeLinesViewProps & RunName): React.JSX.Element {
  if (!useChosenThemes()) {
    const { name: _name, read: _read, ...plain } = props;
    return <CodeLinesView {...plain} />;
  }
  return <RecolouredLinesView {...props} />;
}
