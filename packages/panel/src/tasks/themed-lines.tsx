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
 * moves; the run's ground and ink are the theme's. A window the host drew
 * plain, or the bundle names no grammar for, or whose words came back
 * otherwise, keeps the host's colours: a window is never left plainer than
 * the host drew it.
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

/** What names a run of lines for its colouring: its file's name, which its grammar is read from, and a key naming the read it came from. */
interface RunName {
  readonly name: string;
  readonly runKey: string;
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

/** The themes a look colours in, as one key. */
function themesKey(look: DiffLook): string {
  return `${look.themes.dark}/${look.themes.light}`;
}

/** How many windows' colours are kept, newest last, across every File tab and page source, so one opened again is drawn in its theme at once. */
const KEPT_WINDOWS = 64;

/** Each window's colours, under its run, its place, its length, and the themes it was coloured in; none where it keeps the host's. */
const keptColours = new Map<string, ColouredLines | null>();

/** Keeps a window's colours, the oldest let go past `KEPT_WINDOWS`. */
function keep(key: string, coloured: ColouredLines | null): void {
  keptColours.delete(key);
  keptColours.set(key, coloured);
  for (const oldest of keptColours.keys()) {
    if (keptColours.size <= KEPT_WINDOWS) break;
    keptColours.delete(oldest);
  }
}

/** How many windows are out to the bundle at once, one per worker, so the window scrolled to next is asked for before those far from it. */
const OUT_AT_ONCE = 2;

/** The line at the top of the scroller's view, read off its scroll by the lines' mean height; the run's first where it has not scrolled. */
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

/**
 * The lines in the themes chosen: each window's colours as they land from
 * the diff bundle, the window in view asked for first and the rest by how
 * near they stand to it, asked again as the view scrolls; kept colours
 * drawn at once; the host's until then and wherever the bundle gives none;
 * and the theme's ground and ink once a window has its colours.
 */
function RecolouredLinesView({
  name,
  runKey,
  firstLine,
  lines,
  scrollerRef,
  ...props
}: CodeLinesViewProps & RunName): React.JSX.Element {
  const loaded = useAtomValue(useSideBundles().diffView);
  const module = AsyncResult.isSuccess(loaded) ? loaded.value : undefined;
  const look = useDiffLook(false);
  const themes = themesKey(look);
  // Note that a landing only redraws: what is drawn is read from the kept colours.
  const [, setLandings] = useState(0);
  const out = useRef(new Set<string>());
  const own = useRef<HTMLDivElement | null>(null);
  const scroller = scrollerRef ?? own;
  const windows = windowsOf(firstLine, lines);
  const keyOf = (window: HeldWindow) =>
    `${runKey}:${window.firstLine}:${window.lines.length}@${themes}`;

  const latest = useRef({ windows, keyOf, module, look });
  latest.current = { windows, keyOf, module, look };
  // Asks for the windows nearest the view not yet coloured, as many as may be out at once.
  const askNext = useCallback(() => {
    const { windows, keyOf, module, look } = latest.current;
    if (module === undefined) return;
    const line = lineInView(scroller.current, windows[0]?.firstLine ?? 1, lines.length);
    const waiting = windows
      .filter((window) => {
        const key = keyOf(window);
        return !keptColours.has(key) && !out.current.has(key) && hostColoured(window);
      })
      .sort((a, b) => distance(a, line) - distance(b, line));
    for (const window of waiting) {
      if (out.current.size >= OUT_AT_ONCE) return;
      const key = keyOf(window);
      out.current.add(key);
      module
        .colourLines({ name, key, lines: window.lines.map(wordsOf), look })
        .then(
          (coloured) => (coloured !== undefined && sameWords(window, coloured) ? coloured : null),
          () => null,
        )
        .then((kept) => {
          keep(key, kept);
          out.current.delete(key);
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
  let palette: Pick<ColouredLines, "ground" | "ink"> | undefined;
  for (const window of windows) {
    const coloured = keptColours.get(keyOf(window));
    if (coloured === undefined || coloured === null) drawn.push(...window.lines);
    else {
      drawn.push(...coloured.lines);
      palette ??= coloured;
    }
  }
  return (
    <CodeLinesView
      {...props}
      scrollerRef={scroller}
      firstLine={firstLine}
      lines={drawn}
      palette={palette}
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
  const themes = themesKey(look);
  useEffect(() => {
    if (module === undefined) return;
    module
      .colourLines({ name, key: `warm:${name}@${themes}`, lines: [""], look })
      .catch(() => undefined);
    // Note that the look is read once per pair: a change of type alone warms nothing new.
  }, [module, name, themes]);
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
    const { name: _name, runKey: _runKey, ...plain } = props;
    return <CodeLinesView {...plain} />;
  }
  return <RecolouredLinesView {...props} />;
}
