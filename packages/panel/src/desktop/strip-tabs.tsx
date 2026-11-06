import type { AgentStatus, AgentSummary } from "@repo/features/agent-wire";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { APP_COMMAND, type KeyedCommand } from "@repo/settings/shortcuts";
import {
  IconButton,
  type MenuRow,
  PlusIcon,
  POPOVER_ALIGN,
  POPOVER_BOUNDS,
  SearchableMenu,
  STATUS_TONE,
  type StatusTone,
  Tooltip,
} from "@repo/ui";
import { useDisclosure } from "@repo/ui/use-disclosure";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { commandAction, PANEL_COMMAND } from "../command-items.js";
import { useCopyToast } from "../copy-feedback.js";
import type { HeldTranscript } from "../tasks/agent-tab-card.js";
import {
  type CopiedTranscript,
  type TranscriptCopy,
  type TranscriptUnread,
  transcriptMarkdown,
} from "../tasks/transcript-copy.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import type { MenuAction, MenuEnds, MenuEntry } from "./action-menu.js";
import { type AgentMenuDoors, agentMenuGroups } from "./agent-actions.js";
import { MenuTab } from "./tab-strip.js";

const TRANSCRIPT_COPIED_NOTE = "Transcript copied";

const TRANSCRIPT_UNREAD_NOTE = "The transcript could not be copied. Try again.";

export interface TabPin {
  pinned: boolean;
  onToggle: () => void;
  agent?: boolean;
}

function pinItem(pin: TabPin): MenuAction {
  const pinned = pin.agent === true ? PANEL_COMMAND.UNPIN_AGENT : PANEL_COMMAND.UNPIN_TAB;
  const unpinned = pin.agent === true ? PANEL_COMMAND.PIN_AGENT : PANEL_COMMAND.PIN_TAB;
  const command = pin.pinned ? pinned : unpinned;
  return {
    ...commandAction(command, pin.onToggle, false),
    label: `${command.verb} ${command.noun}`,
  };
}

export interface DocumentMenu extends MenuEnds {
  readonly groups: () => readonly (readonly MenuEntry[])[];
}

export interface TabDoors
  extends Pick<
    AgentMenuDoors,
    | "onCopy"
    | "onRename"
    | "onOpenTerminal"
    | "onOpenBrowser"
    | "onOpenInTask"
    | "archive"
    | "deletion"
    | "copyLink"
  > {
  chosen: boolean;
  onClose: (() => void) | undefined;
  onCloseOthers: (() => void) | undefined;
  pin: TabPin | undefined;
  handed?: TabActionGroups | undefined;
  document?: DocumentMenu | undefined;
}

export interface ShownTab {
  readonly label: string;
  readonly groups: (opener: HTMLElement) => MenuEntry[][];
}

export type TabAction =
  | MenuEntry
  | (Omit<MenuAction, "onSelect"> & { readonly onAsk: (opener: HTMLElement) => void });

export type TabActionGroups = readonly (readonly TabAction[])[];

export type HandTabActions = (actions: TabActionGroups | undefined) => void;

export const HandTabActionsContext = createContext<HandTabActions | undefined>(undefined);

export function handedCommand(
  groups: TabActionGroups,
  command: KeyedCommand,
): (() => void) | undefined {
  for (const action of groups.flat()) {
    if ("onSelect" in action && action.command === command) return action.onSelect;
  }
  return undefined;
}

export function tabActionItems(
  groups: readonly (readonly TabAction[])[],
  opener: HTMLElement,
): MenuEntry[][] {
  return groups.map((group) =>
    group.map((action) => {
      if (!("onAsk" in action)) return action;
      const { onAsk, ...item } = action;
      return { ...item, onSelect: () => onAsk(opener) };
    }),
  );
}

function tabActionGroups(doors: TabDoors): TabActionGroups {
  const { onClose } = doors;
  const close: MenuAction[] =
    onClose === undefined ? [] : [commandAction(PANEL_COMMAND.CLOSE_TAB, onClose, doors.chosen)];
  const pin: MenuAction[] = doors.pin === undefined ? [] : [pinItem(doors.pin)];
  const closeOthers: MenuAction[] =
    doors.onCloseOthers === undefined || doors.document !== undefined
      ? []
      : [commandAction(PANEL_COMMAND.CLOSE_OTHER_TABS, doors.onCloseOthers, doors.chosen)];
  return [[...close, ...closeOthers, ...pin], ...tabContentGroups(doors)].filter(
    (group) => group.length > 0,
  );
}

export function contentActionGroups(doors: Omit<TabDoors, "handed">): MenuEntry[][] {
  const { onCopy, onRename, onOpenTerminal, onOpenInTask, archive, deletion, copyLink, chosen } =
    doors;
  if (doors.document !== undefined) return doors.document.groups().map((group) => [...group]);
  return agentMenuGroups({
    chosen,
    copyLink,
    onCopy,
    onRename,
    onOpenTerminal,
    onOpenBrowser: doors.onOpenBrowser,
    onOpenInTask,
    archive,
    deletion,
  });
}

export function tabContentGroups(doors: TabDoors): TabActionGroups {
  const { handed, copyLink } = doors;
  if (handed === undefined || copyLink === undefined) {
    return [...(handed ?? []), ...contentActionGroups(doors)].filter((group) => group.length > 0);
  }
  return [[copyLink], ...handed, ...contentActionGroups({ ...doors, copyLink: undefined })].filter(
    (group) => group.length > 0,
  );
}

function sameAction(one: TabAction, other: TabAction | undefined): boolean {
  if (other === undefined || one.label !== other.label) return false;
  if ("panel" in one || "panel" in other) return "panel" in one && "panel" in other;
  if ("items" in one || "items" in other) {
    return (
      "items" in one &&
      "items" in other &&
      one.items.length === other.items.length &&
      one.items.every((item, at) => sameAction(item, other.items[at]))
    );
  }
  return (
    one.detail === other.detail &&
    one.disabled === other.disabled &&
    one.checked === other.checked &&
    one.danger === other.danger &&
    one.opens === other.opens &&
    one.command === other.command &&
    "onAsk" in one === "onAsk" in other
  );
}

function sameActions(a: TabActionGroups | undefined, b: TabActionGroups | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.length === b.length &&
    a.every((group, at) => {
      const other = b[at];
      return (
        other !== undefined &&
        group.length === other.length &&
        group.every((one, place) => sameAction(one, other[place]))
      );
    })
  );
}

function throughLatest(
  actions: TabActionGroups,
  latest: React.RefObject<TabActionGroups | undefined>,
): TabActionGroups {
  return actions.map((group, at) =>
    group.map((action, place) => {
      const now = () => latest.current?.[at]?.[place];
      if ("items" in action || "panel" in action) return action;
      if ("onAsk" in action) {
        return {
          ...action,
          onAsk: (opener: HTMLElement) => {
            const held = now();
            if (held !== undefined && "onAsk" in held) held.onAsk(opener);
          },
        };
      }
      return {
        ...action,
        onSelect: () => {
          const held = now();
          if (held !== undefined && "onSelect" in held) held.onSelect();
        },
      };
    }),
  );
}

export function useHandedTabActions(
  hand: HandTabActions | undefined,
  actions: TabActionGroups | undefined,
): void {
  const told = useRef(hand);
  told.current = hand;
  const latest = useRef<TabActionGroups | undefined>(actions);
  latest.current = actions;
  const handed = useRef<TabActionGroups | undefined>(undefined);
  useEffect(() => {
    if (sameActions(handed.current, actions)) return;
    handed.current = actions;
    told.current?.(actions === undefined ? undefined : throughLatest(actions, latest));
  });
  useEffect(() => () => told.current?.(undefined), []);
}

export function useTabActions(actions: TabActionGroups | undefined): void {
  useHandedTabActions(useContext(HandTabActionsContext), actions);
}

function useShownTab(
  onShown: ((shown: ShownTab | undefined) => void) | undefined,
  look: TabLook,
  content: TabActionGroups,
): void {
  const groups = useRef<TabActionGroups>(content);
  useLayoutEffect(() => {
    groups.current = content;
  });
  const { selected, label } = look;
  useEffect(() => {
    if (onShown === undefined || !selected) return;
    onShown({ label, groups: (opener) => tabActionItems(groups.current, opener) });
    return () => onShown(undefined);
  }, [onShown, selected, label]);
}

export interface TabLook {
  id?: string | undefined;
  controls?: string | undefined;
  icon: React.JSX.Element;
  label: string;
  labelReplayUnmasked?: boolean | undefined;
  detail?: string | undefined;
  detailTone?: StatusTone | undefined;
  endMark?: React.JSX.Element | undefined;
  selected: boolean;
  unread?: boolean;
  card?: React.ReactNode;
  quiet?: boolean;
  anchored?: boolean;
  preview?: boolean;
  onSelect: () => void;
  onKeep?: (() => void) | undefined;
}

export function DoorsTab({
  look,
  doors,
  editor,
  tabRef,
  onShown,
}: {
  look: TabLook;
  doors: TabDoors;
  editor?: React.ReactNode;
  tabRef?: React.RefObject<HTMLButtonElement | null> | undefined;
  onShown?: ((shown: ShownTab | undefined) => void) | undefined;
}): React.JSX.Element {
  const content = tabContentGroups(doors);
  useShownTab(onShown, look, content);
  return (
    <MenuTab
      {...look}
      editor={editor}
      tabRef={tabRef}
      onClose={doors.onClose}
      groups={(opener) => tabActionItems(tabActionGroups(doors), opener)}
      ends={doors.document}
    />
  );
}

export interface AddEntry {
  row: MenuRow;
  endMark?: React.JSX.Element | undefined;
  card?: React.ReactNode;
  onPick: () => void;
  agent?: AgentSummary | undefined;
}

export function entryRow({ row, endMark, card }: AddEntry): MenuRow {
  return { ...row, end: endMark ?? row.end, card: card ?? row.card };
}

export function AddTabButton({
  label,
  placeholder,
  noMatch,
  entries,
  onOpen,
  asked,
  answers,
  onAnswered,
}: {
  label: string;
  placeholder: string;
  noMatch: string;
  entries: readonly AddEntry[];
  onOpen: (() => void) | undefined;
  asked: boolean;
  answers: boolean;
  onAnswered: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!asked || !answers) return;
    onAnswered();
    setOpen(true);
    onOpen?.();
  }, [asked, answers, onAnswered, onOpen]);

  const close = () => {
    setOpen(false);
    opener.current?.focus();
  };
  const pick = (id: string) => {
    const entry = entries.find((each) => each.row.id === id);
    close();
    entry?.onPick();
  };

  return (
    <div ref={root} className="tab-add-anchor relative flex flex-none">
      <Tooltip label={label} command={APP_COMMAND.NEW_TAB}>
        <IconButton
          ref={opener}
          icon={<PlusIcon />}
          label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => {
            if (open) {
              close();
              return;
            }
            setOpen(true);
            onOpen?.();
          }}
        />
      </Tooltip>
      {drawn.mounted ? (
        <SearchableMenu
          leaving={drawn.leaving}
          ref={drawn.ref}
          id={menuId}
          label={label}
          placeholder={placeholder}
          rows={entries.map(entryRow)}
          value={undefined}
          noMatch={noMatch}
          align={POPOVER_ALIGN.START}
          bounds={POPOVER_BOUNDS.WINDOW}
          replayUnmasked
          onPick={pick}
          onClose={close}
          onLeave={(left) => {
            if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

export type TranscriptRead = () => Promise<CopiedTranscript | TranscriptUnread | undefined>;

export type TranscriptCopier = (read: TranscriptRead) => (copy: TranscriptCopy) => void;

export function useTranscriptCopier(): TranscriptCopier {
  const copyWithToast = useCopyToast();
  const toast = useToast();
  const unread = (cause: unknown) =>
    toast({
      words: TRANSCRIPT_UNREAD_NOTE,
      tone: STATUS_TONE.DANGER,
      hold: TOAST_HOLD.FAILED,
      failure: { surface: FAILURE_SURFACE.TRANSCRIPT_COPY, cause },
      replayUnmasked: true,
    });
  return (read) => (copy) => {
    read().then((transcript) => {
      if (transcript === undefined) return unread(FAILURE_CONDITION.UNREAD);
      if ("unread" in transcript) return unread(transcript.unread);
      return copyWithToast(transcriptMarkdown(transcript, copy), TRANSCRIPT_COPIED_NOTE);
    }, unread);
  };
}

export interface HeldTranscripts {
  agents: ReadonlyMap<string, HeldTranscript>;
  workers: ReadonlyMap<string, HeldTranscript>;
}

export type WorkerStandings = ReadonlyMap<string, AgentStatus>;

export interface TabViews {
  held: HeldTranscripts;
  standings: WorkerStandings;
  onAgentHeld: (agentId: string, held: HeldTranscript) => void;
  onWorkerHeld: (callId: string, held: HeldTranscript) => void;
  onWorkerStatus: (callId: string, status: AgentStatus) => void;
}

function sameTitles(
  a: ReadonlyMap<string, string> | undefined,
  b: ReadonlyMap<string, string> | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.size !== b.size) return false;
  for (const [key, title] of a) if (b.get(key) !== title) return false;
  return true;
}

export function useTabViews(): TabViews {
  const [standings, setStandings] = useState<WorkerStandings>(() => new Map());
  const [kept] = useState(() => ({
    agents: new Map<string, HeldTranscript>(),
    workers: new Map<string, HeldTranscript>(),
  }));
  const [held, setHeld] = useState<HeldTranscripts>(() => ({
    agents: kept.agents,
    workers: kept.workers,
  }));
  const retitled = useCallback(
    () => setHeld({ agents: kept.agents, workers: kept.workers }),
    [kept],
  );
  const onWorkerStatus = useCallback((callId: string, status: AgentStatus) => {
    setStandings((was) => (was.get(callId) === status ? was : new Map(was).set(callId, status)));
  }, []);
  const onAgentHeld = useCallback(
    (agentId: string, transcript: HeldTranscript) => {
      const was = kept.agents.get(agentId);
      kept.agents.set(agentId, transcript);
      if (!sameTitles(was?.subagentTitles, transcript.subagentTitles)) retitled();
    },
    [kept, retitled],
  );
  const onWorkerHeld = useCallback(
    (callId: string, transcript: HeldTranscript) => {
      const was = kept.workers.get(callId);
      kept.workers.set(callId, transcript);
      if (was?.title !== transcript.title) retitled();
    },
    [kept, retitled],
  );
  return useMemo(
    () => ({ held, standings, onAgentHeld, onWorkerHeld, onWorkerStatus }),
    [held, standings, onAgentHeld, onWorkerHeld, onWorkerStatus],
  );
}
