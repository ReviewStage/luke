import { APP_COMMAND } from "@repo/settings/shortcuts";
import {
  CloseIcon,
  DisclosureFind,
  Fill,
  IconButton,
  MENU_SURFACE_FLOW,
  MenuSurface,
  motionHeld,
  SearchField,
  Tooltip,
  useDisclosureFinding,
} from "@repo/ui";
import { FIND_SKIP_ATTRIBUTE } from "@repo/ui/find-skip";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { type StripTab, sameTab } from "@repo/ui/tab-strip-model";
import { useDisclosure } from "@repo/ui/use-disclosure";
import { type Store, useCreateStore, useSelector } from "@tanstack/react-store";
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
import { useAppCommand } from "./app-commands.js";
import {
  type FindPainting,
  findRanges,
  matchFrom,
  NO_PAINTING,
  repaint,
  reveal,
  selectedWords,
  watchText,
} from "./find-matches.js";

const FIND_SCOPE = "find-scope relative @container/find-scope";

export const FIND_STEP = {
  PREVIOUS: -1,
  NEXT: 1,
} as const;

type FindStep = (typeof FIND_STEP)[keyof typeof FIND_STEP];

export interface FindTally {
  readonly count: number;
  readonly at: number;
  readonly more?: boolean;
}

export const FIND_PAGE = {
  HOME: "home",
  INBOX: "inbox",
  AUTOMATIONS: "automations",
  BOARD: "board",
  VERSION_HISTORY: "version-history",
  PERSON: "person",
  ADMIN: "admin",
} as const;

type FindPage = (typeof FIND_PAGE)[keyof typeof FIND_PAGE];

export type FindSubject =
  | { readonly task: string; readonly tab: StripTab }
  | { readonly agent: string }
  | { readonly page: FindPage; readonly at?: string | undefined };

export interface FindHeld {
  readonly query: string;
  readonly bar: FindSubject | undefined;
  readonly at: number;
}

export type FindStore = Store<FindHeld>;

export const NO_FIND: FindHeld = { query: "", bar: undefined, at: -1 };

interface FindMatches {
  readonly tally: FindTally;
  readonly step: (step: FindStep) => void;
}

export interface FindSource {
  readonly search: (query: string) => void;
  readonly step: (query: string, step: FindStep) => void;
  readonly clear: () => void;
  readonly onTally: (listener: (tally: FindTally) => void) => () => void;
  readonly selection: () => string | undefined;
}

export type FindChord =
  | typeof APP_COMMAND.FIND
  | typeof APP_COMMAND.FIND_NEXT
  | typeof APP_COMMAND.FIND_PREVIOUS;

interface FindScopeDoors {
  readonly offer: (source: FindSource | undefined) => void;
  readonly press: (chord: FindChord) => void;
}

const FindScopeContext = createContext<FindScopeDoors>({
  offer: () => undefined,
  press: () => undefined,
});

const NO_TALLY: FindTally = { count: 0, at: -1 };

function sameSubject(a: FindSubject, b: FindSubject): boolean {
  if ("task" in a) return "task" in b && a.task === b.task && sameTab(a.tab, b.tab);
  if ("agent" in a) return "agent" in b && a.agent === b.agent;
  return "page" in b && a.page === b.page && a.at === b.at;
}

function useFindMatches(
  root: HTMLElement | null,
  query: string,
  kept: { readonly at: number; readonly onAt: (at: number) => void },
): FindMatches {
  const painting = useRef<FindPainting>(NO_PAINTING);
  const [tally, setTally] = useState<FindTally>({ count: 0, at: -1 });
  const { onAt } = kept;
  const paint = useCallback(
    (next: FindPainting) => {
      repaint(painting.current, next);
      painting.current = next;
      setTally({ count: next.ranges.length, at: next.at });
      onAt(next.at);
    },
    [onAt],
  );
  const resumed = useRef(kept.at);

  useEffect(() => {
    if (root === null || query.length === 0) {
      paint(NO_PAINTING);
      return;
    }
    const search = (shown: boolean) => {
      const held = painting.current;
      const ranges = findRanges(root, query);
      const resume = resumed.current;
      resumed.current = -1;
      const at =
        resume >= 0 && resume < ranges.length
          ? resume
          : matchFrom(ranges, held.ranges[held.at], root);
      paint({ ranges, at });
      const range = ranges[at];
      if (shown && resume < 0 && range !== undefined) reveal(range, root);
    };
    search(true);
    return watchText(root, () => search(false));
  }, [root, query, paint]);

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

function BarButton({
  label,
  command,
  disabled,
  onPress,
  icon,
}: {
  label: string;
  command?: typeof APP_COMMAND.FIND_NEXT | typeof APP_COMMAND.FIND_PREVIOUS;
  disabled?: boolean;
  onPress: () => void;
  icon: React.ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip label={label} {...(command === undefined ? {} : { command })}>
      <IconButton icon={icon} label={label} disabled={disabled} onClick={onPress} />
    </Tooltip>
  );
}

function FindBar({
  query,
  onQuery,
  tally,
  summons,
  leaving,
  surface,
  onStep,
  onClose,
}: {
  query: string;
  onQuery: (query: string) => void;
  tally: FindTally;
  summons: number;
  leaving: boolean;
  surface: (element: HTMLElement | null) => void;
  onStep: (step: FindStep) => void;
  onClose: () => void;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    field.current?.focus({ preventScroll: true });
    field.current?.select();
  }, [summons]);
  return (
    <MenuSurface
      ref={surface}
      className="find-bar absolute top-ui-8 right-column-inset z-3"
      flow={MENU_SURFACE_FLOW.ROW}
      leaving={leaving}
      role="search"
      aria-label="Find"
      {...{ [FIND_SKIP_ATTRIBUTE]: "" }}
    >
      <div className="find-bar-field mr-list-gap w-find-field">
        <ReplayUnmask>
          <SearchField
            ref={field}
            label="Find"
            placeholder="Find"
            value={query}
            onChange={onQuery}
            tally={
              query.length === 0
                ? undefined
                : {
                    count: tally.count,
                    at: tally.at < 0 ? undefined : tally.at,
                    more: tally.more,
                  }
            }
            onEnter={() => onStep(FIND_STEP.NEXT)}
            onShiftEnter={() => onStep(FIND_STEP.PREVIOUS)}
            onEscape={onClose}
          />
        </ReplayUnmask>
      </div>
      <BarButton
        label="Previous match"
        command={APP_COMMAND.FIND_PREVIOUS}
        disabled={tally.count === 0}
        onPress={() => onStep(FIND_STEP.PREVIOUS)}
        icon={<ChevronUpIcon aria-hidden="true" />}
      />
      <BarButton
        label="Next match"
        command={APP_COMMAND.FIND_NEXT}
        disabled={tally.count === 0}
        onPress={() => onStep(FIND_STEP.NEXT)}
        icon={<ChevronDownIcon aria-hidden="true" />}
      />
      <BarButton label="Close find" onPress={onClose} icon={<CloseIcon />} />
    </MenuSurface>
  );
}

export function useFindOpen(): boolean {
  return useDisclosureFinding();
}

export function useFindSource(source: FindSource | undefined): void {
  const { offer } = useContext(FindScopeContext);
  useEffect(() => {
    offer(source);
    return () => offer(undefined);
  }, [offer, source]);
}

export function useFindPress(): (chord: FindChord) => void {
  return useContext(FindScopeContext).press;
}

export function FindScope({
  active,
  subject,
  held,
  className,
  children,
  ...props
}: Omit<ComponentProps<"div">, "ref"> & {
  active: boolean;
  subject: FindSubject;
  held?: FindStore | undefined;
}): React.JSX.Element {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const own = useCreateStore<FindHeld>(NO_FIND);
  const store = held ?? own;
  const { query, bar, at } = useSelector(store);
  const setQuery = (next: string) => store.setState((was) => ({ ...was, query: next }));
  const setBar = (next: FindSubject | undefined) =>
    store.setState((was) => ({ ...was, bar: next }));
  const onAt = useCallback(
    (next: number) => store.setState((was) => (was.at === next ? was : { ...was, at: next })),
    [store],
  );
  const [summons, setSummons] = useState(0);
  const back = useRef<HTMLElement | null>(null);
  const shown = useRef(subject);
  useEffect(() => {
    if (sameSubject(shown.current, subject)) return;
    shown.current = subject;
    store.setState((was) => (was.bar === undefined ? was : { ...was, bar: undefined }));
  });
  const open = bar !== undefined && sameSubject(bar, subject);
  const drawn = useDisclosure(open);
  const [source, setSource] = useState<FindSource | undefined>(undefined);
  const domMatches = useFindMatches(source === undefined ? root : null, open ? query : "", {
    at,
    onAt,
  });
  const sourceMatches = useSourceMatches(source, open ? query : "");
  const { tally, step } = source === undefined ? domMatches : sourceMatches;
  const [tallied, setTallied] = useState(tally);
  if (open && tallied !== tally) setTallied(tally);

  const summon = () => {
    if (root === null) return;
    const words = source === undefined ? selectedWords(root) : source.selection();
    if (words !== undefined) setQuery(words);
    const focused = document.activeElement;
    if (!open) back.current = focused instanceof HTMLElement ? focused : null;
    setBar(subject);
    setSummons((count) => count + 1);
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
  const pressed = useRef<(chord: FindChord) => void>(() => undefined);
  useLayoutEffect(() => {
    pressed.current = (chord) => {
      if (chord === APP_COMMAND.FIND) summon();
      else if (open) step(chord === APP_COMMAND.FIND_NEXT ? FIND_STEP.NEXT : FIND_STEP.PREVIOUS);
    };
  });
  const [doors] = useState<FindScopeDoors>(() => ({
    offer: setSource,
    press: (chord) => pressed.current(chord),
  }));

  return (
    <Fill
      ref={setRoot}
      className={className === undefined ? FIND_SCOPE : `${className} ${FIND_SCOPE}`}
      {...props}
    >
      {!drawn.mounted || (drawn.leaving && motionHeld()) ? null : (
        <FindBar
          query={query}
          onQuery={setQuery}
          tally={tallied}
          summons={summons}
          leaving={drawn.leaving}
          surface={drawn.ref}
          onStep={step}
          onClose={close}
        />
      )}
      <FindScopeContext.Provider value={doors}>
        <DisclosureFind finding={open}>{children}</DisclosureFind>
      </FindScopeContext.Provider>
    </Fill>
  );
}

export function PageFind({
  page,
  at,
  active,
  hidden,
  held,
  children,
}: {
  page: FindPage;
  at?: string | undefined;
  active: boolean;
  hidden?: boolean | undefined;
  held?: FindStore | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <FindScope
      className="page-find"
      active={active}
      subject={{ page, at }}
      hidden={hidden}
      held={held}
    >
      {children}
    </FindScope>
  );
}
