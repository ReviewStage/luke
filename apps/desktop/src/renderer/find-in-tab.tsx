import { CloseIcon, SearchIcon } from "@luke/ui";
import { type StripTab, sameTab } from "@luke/ui/tab-strip-model";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import {
  type ComponentProps,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "./app-commands";
import {
  FIND_SKIP_ATTRIBUTE,
  type FindPainting,
  findRanges,
  matchFrom,
  NO_PAINTING,
  repaint,
  reveal,
  selectedWords,
} from "./find-matches";
import { Tooltip } from "./tooltip";

/**
 * find-in-tab.tsx -- ⌘F inside the tab that holds the window's focus: a find bar at the tab's top right, its matches tinted in the tab's own text and stepped through one at a time.
 *
 * Each column of the plan's page wraps the tab it shows in a scope, which
 * offers Find while the column holds the window's keys (`desktop-plans.tsx`),
 * so ⌘F finds in the plan's document, an agent's transcript, or whatever
 * the side panel shows, and never in both columns at once, which is why
 * Electron's `findInPage`, a find over the whole window, is not used. The
 * bar is the one Chrome, VS Code, and Slack draw: the field, "3 of 12" or
 * "No results", the previous and next matches, and a close. Return and
 * ⇧Return step from the field, ⌘G and ⇧⌘G from anywhere in the column, and
 * Escape closes the bar and hands the focus back to where it was. ⌘F seeds
 * the field with the words selected in the tab, and a second ⌘F selects the
 * field's text to type over. The query is kept when the bar closes, so ⌘F
 * opens on the last one, as a browser's does. Choosing another tab closes
 * the bar.
 *
 * The matches are the DOM's (`find-matches.ts`): read again whenever the
 * tab's text changes, as a transcript does while it streams, without moving
 * the match the find is at. A tab that holds more than it draws draws all
 * of it while a bar is open over it (`useFindOpen`): a fold draws what it
 * folds, hidden in its closed `<details>` until a match in it is shown, and
 * a file draws every window of its lines.
 */

/** How far a step moves through the matches. */
const FIND_STEP = {
  PREVIOUS: -1,
  NEXT: 1,
} as const;

type FindStep = (typeof FIND_STEP)[keyof typeof FIND_STEP];

/** What the bar says of the matches: how many there are, and which the find is at, -1 for none. */
interface FindTally {
  readonly count: number;
  readonly at: number;
}

/** What a scope shows: the plan, and its tab. */
export interface FindSubject {
  readonly plan: string;
  readonly tab: StripTab;
}

/** The bar standing open: what it was opened over, and how many times ⌘F has summoned it there. */
interface OpenBar {
  readonly subject: FindSubject;
  readonly summons: number;
}

/** A find's matches as its bar reads them, and the step through them. */
interface FindMatches {
  readonly tally: FindTally;
  readonly step: (step: FindStep) => void;
}

/** Whether a find bar stands open over the tab drawing under it. */
const FindOpenContext = createContext(false);

/** Whether two subjects name the same tab of the same plan. */
function sameSubject(a: FindSubject, b: FindSubject): boolean {
  return a.plan === b.plan && sameTab(a.tab, b.tab);
}

/** The words the bar says of the matches. */
function tallyLine(query: string, tally: FindTally): string {
  if (query.length === 0) return "";
  return tally.count === 0 ? "No results" : `${tally.at + 1} of ${tally.count}`;
}

/**
 * The matches of `query` under `root`, painted and kept as the tab's text
 * changes, and the step that moves through them. A query typed further, or
 * read again over new text, keeps to the match it was at (`matchFrom`);
 * only a new query and a step bring the match into view.
 */
function useFindMatches(root: HTMLElement | null, query: string): FindMatches {
  const painting = useRef<FindPainting>(NO_PAINTING);
  const [tally, setTally] = useState<FindTally>({ count: 0, at: -1 });
  const paint = useCallback((next: FindPainting) => {
    repaint(painting.current, next);
    painting.current = next;
    setTally({ count: next.ranges.length, at: next.at });
  }, []);

  useEffect(() => {
    if (root === null || query.length === 0) {
      paint(NO_PAINTING);
      return;
    }
    const search = (shown: boolean) => {
      const held = painting.current;
      const ranges = findRanges(root, query);
      const at = matchFrom(ranges, held.ranges[held.at], root);
      paint({ ranges, at });
      const range = ranges[at];
      if (shown && range !== undefined) reveal(range, root);
    };
    search(true);
    const watch = new MutationObserver(() => search(false));
    watch.observe(root, { childList: true, subtree: true, characterData: true });
    return () => watch.disconnect();
  }, [root, query, paint]);

  // The highlights are the document's, so a tab that goes takes its matches with it.
  useEffect(() => () => repaint(painting.current, NO_PAINTING), []);

  const step = (by: FindStep) => {
    const held = painting.current;
    const count = held.ranges.length;
    if (root === null || count === 0) return;
    const at = (held.at + by + count) % count;
    paint({ ranges: held.ranges, at });
    const range = held.ranges[at];
    if (range !== undefined) reveal(range, root);
  };
  return { tally, step };
}

/** One of the bar's buttons: a glyph alone, named for a reader, with its chord in its hint. */
function BarButton({
  label,
  command,
  disabled,
  onPress,
  children,
}: {
  label: string;
  command?: typeof APP_COMMAND.FIND_NEXT | typeof APP_COMMAND.FIND_PREVIOUS;
  disabled?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip label={label} {...(command === undefined ? {} : { command })}>
      <button
        type="button"
        className="icon-button find-bar-button"
        aria-label={label}
        disabled={disabled}
        onClick={onPress}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * The bar: the field in a search well with the tally at its end, then the
 * previous and next matches and the close. Each summons puts the caret in
 * the field with its text selected.
 */
function FindBar({
  query,
  onQuery,
  tally,
  summons,
  onStep,
  onClose,
}: {
  query: string;
  onQuery: (query: string) => void;
  tally: FindTally;
  summons: number;
  onStep: (step: FindStep) => void;
  onClose: () => void;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    field.current?.focus({ preventScroll: true });
    field.current?.select();
  }, [summons]);
  const line = tallyLine(query, tally);
  return (
    <search className="find-bar" aria-label="Find" {...{ [FIND_SKIP_ATTRIBUTE]: "" }}>
      <label className="settings-search-well field-well find-bar-well">
        <SearchIcon />
        <input
          ref={field}
          className="settings-search-input"
          aria-label="Find"
          placeholder="Find"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            // Note that an Escape is stopped even mid-composition, because the
            // input method spends that press dismissing its candidates, and
            // the window's own Escape would turn the page behind the bar.
            if (event.key === "Escape") event.stopPropagation();
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") onClose();
            if (event.key !== "Enter") return;
            event.preventDefault();
            onStep(event.shiftKey ? FIND_STEP.PREVIOUS : FIND_STEP.NEXT);
          }}
        />
        {line.length === 0 ? null : (
          <span className="find-bar-tally" aria-live="polite">
            {line}
          </span>
        )}
      </label>
      <BarButton
        label="Previous match"
        command={APP_COMMAND.FIND_PREVIOUS}
        disabled={tally.count === 0}
        onPress={() => onStep(FIND_STEP.PREVIOUS)}
      >
        <ChevronUpIcon aria-hidden="true" />
      </BarButton>
      <BarButton
        label="Next match"
        command={APP_COMMAND.FIND_NEXT}
        disabled={tally.count === 0}
        onPress={() => onStep(FIND_STEP.NEXT)}
      >
        <ChevronDownIcon aria-hidden="true" />
      </BarButton>
      <BarButton label="Close find" onPress={onClose}>
        <CloseIcon />
      </BarButton>
    </search>
  );
}

/**
 * Whether a find bar stands open over the tab: a tab that draws less than
 * it holds, folding it away or reading it a window at a time, draws all of
 * it while this is so, so the find covers what the tab holds.
 */
export function useFindOpen(): boolean {
  return useContext(FindOpenContext);
}

/**
 * A tab's find: the element the tab is drawn in, with the find bar at its
 * top right while one is open. It offers ⌘F, and ⌘G and ⇧⌘G while the bar
 * is open, only while `active`, the column holding the window's keys with
 * a tab that has words to find; the bar stays open over a column that
 * loses them, so its matches stay tinted, as an unfocused editor's do.
 * `subject` names the tab shown and its plan: another closes the bar, which
 * a return to the first does not open again.
 */
export function FindScope({
  active,
  subject,
  className,
  children,
  ...props
}: Omit<ComponentProps<"div">, "ref"> & {
  active: boolean;
  subject: FindSubject;
}): React.JSX.Element {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [bar, setBar] = useState<OpenBar | undefined>(undefined);
  const back = useRef<HTMLElement | null>(null);
  // Note that the bar is let go as the tab changes, rather than left to
  // stand for a tab no longer shown, which a return would draw again.
  const [shown, setShown] = useState(subject);
  if (!sameSubject(shown, subject)) {
    setShown(subject);
    setBar(undefined);
  }
  const open = bar !== undefined && sameSubject(bar.subject, subject);
  const { tally, step } = useFindMatches(root, open ? query : "");

  const summon = () => {
    if (root === null) return;
    const words = selectedWords(root);
    if (words !== undefined) setQuery(words);
    // Note that the focus to hand back is the one before the bar first
    // opened, since a second ⌘F finds it in the bar's own field.
    const focused = document.activeElement;
    if (!open) back.current = focused instanceof HTMLElement ? focused : null;
    setBar({ subject, summons: (bar?.summons ?? 0) + 1 });
  };
  const close = () => {
    setBar(undefined);
    const target = back.current;
    back.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  };
  useAppCommand(APP_COMMAND.FIND, active ? summon : undefined);
  useAppCommand(APP_COMMAND.FIND_NEXT, active && open ? () => step(FIND_STEP.NEXT) : undefined);
  useAppCommand(
    APP_COMMAND.FIND_PREVIOUS,
    active && open ? () => step(FIND_STEP.PREVIOUS) : undefined,
  );

  return (
    <div
      ref={setRoot}
      className={className === undefined ? "find-scope" : `${className} find-scope`}
      {...props}
    >
      {open ? (
        <FindBar
          query={query}
          onQuery={setQuery}
          tally={tally}
          summons={bar.summons}
          onStep={step}
          onClose={close}
        />
      ) : null}
      <FindOpenContext.Provider value={open}>{children}</FindOpenContext.Provider>
    </div>
  );
}
