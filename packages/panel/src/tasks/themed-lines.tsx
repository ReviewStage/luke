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
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { useSideBundles } from "../bundle-loader.js";
import type { ColouredLines, DiffLook } from "../diff-view/contract.js";
import { CodeLinesView } from "./code-lines.js";
import { useDiffLook } from "./file-diff.js";
import { windowAt } from "./file-tab-model.js";
import { DEFAULT_SETTINGS, useFileViewSettings } from "./file-view-settings.js";

type CodeLinesViewProps = ComponentProps<typeof CodeLinesView>;

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

/** Each window's colours as they landed, under the themes they were coloured in: none where a window keeps the host's. */
interface Landed {
  readonly themes: string;
  readonly windows: ReadonlyMap<string, ColouredLines | null>;
}

/**
 * The lines in the themes chosen: each window's colours as they land from
 * the diff bundle, the host's until then and wherever the bundle gives
 * none, and the theme's ground and ink once a window has landed.
 */
function RecolouredLinesView({
  name,
  runKey,
  firstLine,
  lines,
  ...props
}: CodeLinesViewProps & RunName): React.JSX.Element {
  const loaded = useAtomValue(useSideBundles().diffView);
  const module = AsyncResult.isSuccess(loaded) ? loaded.value : undefined;
  const look = useDiffLook(false);
  const themes = themesKey(look);
  const [landed, setLanded] = useState<Landed>({ themes, windows: new Map() });
  const asked = useRef(new Set<string>());
  const windows = windowsOf(firstLine, lines);
  const keyOf = (window: HeldWindow) =>
    `${runKey}:${window.firstLine}:${window.lines.length}@${themes}`;
  const current =
    landed.themes === themes ? landed.windows : new Map<string, ColouredLines | null>();

  useEffect(() => {
    if (module === undefined) return;
    for (const window of windows) {
      const key = keyOf(window);
      if (asked.current.has(key) || !hostColoured(window)) continue;
      asked.current.add(key);
      module
        .colourLines({ name, key, lines: window.lines.map(wordsOf), look })
        .then(
          (coloured) => (coloured !== undefined && sameWords(window, coloured) ? coloured : null),
          () => null,
        )
        .then((kept) =>
          setLanded((was) => {
            const base = was.themes === themes ? was.windows : new Map();
            return { themes, windows: new Map(base).set(key, kept) };
          }),
        );
    }
  });

  const drawn: CodeLines[number][] = [];
  let palette: Pick<ColouredLines, "ground" | "ink"> | undefined;
  for (const window of windows) {
    const coloured = current.get(keyOf(window));
    if (coloured === undefined || coloured === null) drawn.push(...window.lines);
    else {
      drawn.push(...coloured.lines);
      palette ??= coloured;
    }
  }
  return <CodeLinesView {...props} firstLine={firstLine} lines={drawn} palette={palette} />;
}

/**
 * A run of lines in the syntax themes View settings chose: as the host
 * coloured them in the default themes, the diff bundle never loaded; and
 * coloured again in any other pair.
 */
export function ThemedCodeLinesView(props: CodeLinesViewProps & RunName): React.JSX.Element {
  const { settings } = useFileViewSettings();
  const chosen =
    settings.diffDarkTheme !== DEFAULT_SETTINGS.diffDarkTheme ||
    settings.diffLightTheme !== DEFAULT_SETTINGS.diffLightTheme;
  if (!chosen) {
    const { name: _name, runKey: _runKey, ...plain } = props;
    return <CodeLinesView {...plain} />;
  }
  return <RecolouredLinesView {...props} />;
}
