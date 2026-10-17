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
  watchText,
} from "./find-matches";
import { Tooltip } from "./tooltip";

/**
 * find-in-tab.tsx -- ⌘F inside the tab that holds the window's focus: a find bar at the tab's top right, its matches tinted in the tab's own text and stepped through one at a time.
 *
 * Each column of the plan's page wraps the tab it shows in a scope, which
 * offers Find while the column holds the window's keys (`desktop-tasks.tsx`),
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
 * A tab whose words are drawn on a canvas, which the DOM holds none of, as
 * a Terminal tab's are, hands the scope a source of its own
 * (`useFindSource`), which finds, steps, and tallies in its own words in the
 * DOM's place, and seeds the field from its own selection.
 *
 * Otherwise the matches are the DOM's (`find-matches.ts`): read again whenever the
 * tab's text changes, as a transcript does while it streams, without moving
 * the match the find is at. A tab that holds more than it draws draws all
 * of it while a bar is open over it (`useFindOpen`): a fold draws what it
 * folds, hidden in its closed `<details>` until a match in it is shown, and
 * a file draws every window of its lines.
 */

/** How far a step moves through the matches. */
export const FIND_STEP = {
  PREVIOUS: -1,
  NEXT: 1,
} as const;

type FindStep = (typeof FIND_STEP)[keyof typeof FIND_STEP];

/** What the bar says of the matches: how many there are, and which the find is at, -1 for none. */
interface FindTally {
  readonly count: number;
  readonly at: number;
  /** Whether there are more matches than the count, which a source that stops counting says. */
  readonly more?: boolean;
}

/** The pages that stand in the plan's place, each finding in its words as one scope (`PageFind`). */
export const FIND_PAGE = {
  HOME: "home",
  INBOX: "inbox",
  FACTORY: "factory",
  AUTOMATIONS: "automations",
  ISSUES: "issues",
  VERSION_HISTORY: "version-history",
  PERSON: "person",
} as const;

type FindPage = (typeof FIND_PAGE)[keyof typeof FIND_PAGE];

/**
 * What a scope shows: a plan's tab, the page of an agent no plan holds, or
 * a page standing in the plan's place, at the place on it where one page
 * holds several, as the Automations page holds its list and each editor.
 */
export type FindSubject =
  | { readonly task: string; readonly tab: StripTab }
  | { readonly agent: string }
  | { readonly page: FindPage; readonly at?: string | undefined };

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

/**
 * Where a tab's matches come from where its words are not the DOM's: the
 * query found as typed, keeping to the match it was at; a step from it; the
 * tints taken away; the tally as it changes; and the words selected, which
 * ⌘F seeds the field with.
 */
export interface FindSource {
  readonly search: (query: string) => void;
  readonly step: (query: string, step: FindStep) => void;
  readonly clear: () => void;
  readonly onTally: (listener: (tally: FindTally) => void) => () => void;
  readonly selection: () => string | undefined;
}

/** Whether a find bar stands open over the tab drawing under it. */
const FindOpenContext = createContext(false);

/** Hands the scope over the tab a source of the tab's own, or takes it back. */
const FindSourceContext = createContext<(source: FindSource | undefined) => void>(() => undefined);

/** No matches, and no match the find is at. */
const NO_TALLY: FindTally = { count: 0, at: -1 };

/** Whether two subjects name the same tab of the same plan, the same agent's page, or the same place on the same page. */
function sameSubject(a: FindSubject, b: FindSubject): boolean {
  if ("task" in a) return "task" in b && a.task === b.task && sameTab(a.tab, b.tab);
  if ("agent" in a) return "agent" in b && a.agent === b.agent;
  return "page" in b && a.page === b.page && a.at === b.at;
}

/** The words the bar says of the matches: where the find is among them, or how many there are while it is at none counted. */
function tallyLine(query: string, tally: FindTally): string {
  if (query.length === 0) return "";
  if (tally.count === 0) return "No results";
  const count = tally.more === true ? `${tally.count}+` : String(tally.count);
  return tally.at < 0 ? `${count} results` : `${tally.at + 1} of ${count}`;
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
    return watchText(root, () => search(false));
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

/**
 * The matches of `query` as a source of the tab's own finds and tallies
 * them, and the step through them; the tints are taken away as the query
 * empties or the source goes.
 */
function useSourceMatches(source: FindSource | undefined, query: string): FindMatches {
  const [tally, setTally] = useState<FindTally>(NO_TALLY);
  useEffect(() => source?.onTally(setTally), [source]);
  useEffect(() => {
    if (source === undefined) return;
    if (query.length === 0) {
      source.clear();
      setTally(NO_TALLY);
      return;
    }
    source.search(query);
  }, [source, query]);
  useEffect(() => () => source?.clear(), [source]);
  return { tally, step: (by) => source?.step(query, by) };
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
 * Hands the find over this tab a source of the tab's own for as long as it
 * is given, where the tab draws its words on a canvas (`FindSource`).
 */
export function useFindSource(source: FindSource | undefined): void {
  const offer = useContext(FindSourceContext);
  useEffect(() => {
    offer(source);
    return () => offer(undefined);
  }, [offer, source]);
}

/**
 * A tab's find: the element the tab is drawn in, with the find bar at its
 * top right while one is open. It offers ⌘F, and ⌘G and ⇧⌘G while the bar
 * is open, only while `active`, the column holding the window's keys with
 * a tab that has words to find; the bar stays open over a column that
 * loses them, so its matches stay tinted, as an unfocused editor's do.
 * `subject` names the tab shown and its plan, or the agent's page: another
 * closes the bar, which a return to the first does not open again.
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
  // A tab that hands a source of its own finds in its words, never the DOM's.
  const [source, setSource] = useState<FindSource | undefined>(undefined);
  const domMatches = useFindMatches(source === undefined ? root : null, open ? query : "");
  const sourceMatches = useSourceMatches(source, open ? query : "");
  const { tally, step } = source === undefined ? domMatches : sourceMatches;

  const summon = () => {
    if (root === null) return;
    const words = source === undefined ? selectedWords(root) : source.selection();
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
      <FindSourceContext.Provider value={setSource}>
        <FindOpenContext.Provider value={open}>{children}</FindOpenContext.Provider>
      </FindSourceContext.Provider>
    </div>
  );
}

/**
 * A page standing in the plan's place, found in as one scope: Home, the
 * window's Inbox, Factory, the Automations page, and a version history. It
 * fills the place as the page did, its bar under the page's toolbar
 * (`.page-find`), and finds in the page's words, never in what a field
 * holds, since a field's value is no text of the page's; Settings keeps ⌘F
 * on its own search. `at` names the place on a page that holds several,
 * whose change closes the bar as another tab's does.
 */
export function PageFind({
  page,
  at,
  active,
  children,
}: {
  page: FindPage;
  at?: string | undefined;
  /** Whether the page holds the window's keys: the window's Plans tab on screen. */
  active: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <FindScope className="page-find" active={active} subject={{ page, at }}>
      {children}
    </FindScope>
  );
}
