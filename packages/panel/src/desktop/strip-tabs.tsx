import type { CodingAgentStatus, CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  IconButton,
  type MenuRow,
  MoreButton,
  moreLabel,
  PlusIcon,
  POPOVER_ALIGN,
  POPOVER_BOUNDS,
  SearchableMenu,
  SKELETON_SHAPE,
  Skeleton,
  STATUS_TONE,
  Tooltip,
  useMenu,
} from "@luke/ui";
import { useDisclosure } from "@luke/ui/use-disclosure";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { commandAction, PANEL_COMMAND } from "../command-items.js";
import { useCopyToast } from "../copy-feedback.js";
import type { HeldTranscript } from "../tasks/agent-tab-card.js";
import {
  type CopiedTranscript,
  TRANSCRIPT_COPY,
  type TranscriptCopy,
  transcriptMarkdown,
} from "../tasks/transcript-copy.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";
import { MenuTab } from "./tab-strip.js";

/**
 * strip-tabs.tsx -- what the task's column's strip and the side panel's draw alike: a tab with its actions, the "+" after the last tab and the menu it drops, a transcript's copy, and what the agents' tabs last drew.
 *
 * Both strips are the one `TabStrip` (tab-strip.tsx), each of its tabs a
 * `MenuTab` whose right-click offers the actions `tabActionGroups` lists:
 * Close and Close others; Pin or Unpin, and an agent's Rename,
 * beside it; an agent's Show terminal; a transcript's two copies; and an
 * agent's Archive. Those that act on what the chosen tab shows, an agent's
 * Rename, Show terminal, copies, and Archive, and a subagent's copies, its
 * strip's toolbar also offers from a ⋯ (`ToolbarTabActions`), with what the
 * tab's own body hands up while it is drawn, a Pull request tab's Refresh
 * and Open on GitHub (`useHandedTabActions`). On a phone a tab's body draws
 * no bar of its own and hands every control of it up the same way, so the
 * task's header's ⋯ offers them (`task-pane-switcher.tsx`). Each strip
 * ends in a "+" that drops the shared searchable menu over what the strip
 * may open. The columns' own modules say which tabs and rows those are
 * (`main-tabs.tsx`, `side-panel.tsx`).
 *
 * What an agent's or a delegated worker's tab last drew is held here for as
 * long as the task's page is drawn, whichever column the tab stands in, so
 * its card can preview its latest step once another tab is shown, and a
 * delegated worker's card can read its model from the call its agent's tab
 * last drew. Where a delegated worker stands is what its own tab's pages
 * say, held here for its glyph the same way.
 */

/** What the toast says once a tab's transcript, concise or full, is on the clipboard. */
const TRANSCRIPT_COPIED_NOTE = "Transcript copied";

/** What the toast says when a tab's transcript could not be read whole for a copy. */
const TRANSCRIPT_UNREAD_NOTE = "The transcript could not be copied. Try again.";

/** A tab's pin to the sidebar, as its menu offers it: whether it stands, and the press that sets it or takes it away. */
export interface TabPin {
  pinned: boolean;
  onToggle: () => void;
}

/** A tab's menu, as either strip offers it: what each action does, and those it holds beyond Close. */
export interface TabDoors {
  /** Whether the tab is the one chosen, which ⌘W closes. */
  chosen: boolean;
  /** Closes the tab; none for the plan's, which always stands. */
  onClose: (() => void) | undefined;
  /** Closes every other tab that closes, none where there is none. */
  onCloseOthers: (() => void) | undefined;
  /** The tab's pin to the sidebar, for a fixed tab's, an agent's, and a file's. */
  pin: TabPin | undefined;
  /** Copies the tab's transcript, for an agent's and a subagent's. */
  onCopy?: ((copy: TranscriptCopy) => void) | undefined;
  /** Renames what the tab shows, for the plan's and an agent's. */
  onRename?: (() => void) | undefined;
  /** Opens the agent's own Terminal tab in the side panel, adding no shell, for an agent's where a panel takes the tab. */
  onOpenTerminal?: (() => void) | undefined;
  /** Archives the agent the tab shows, for an agent's (`agent-archive.tsx`). */
  archive?: MenuAction | undefined;
  /** Deletes the agent the tab shows for good, asked first, for an agent's (`agent-delete.tsx`). */
  deletion?: MenuAction | undefined;
  /** Copies the link of what the tab shows, for a tab whose thing has one (`copy-link-item.tsx`). */
  copyLink?: MenuAction | undefined;
  /** What the tab's body offers on what it shows while it is drawn (`useHandedTabActions`), which its toolbar's ⋯ alone offers, first. */
  handed?: TabActionGroups | undefined;
}

/**
 * One action a tab's body hands its ⋯: a menu item, or one that opens a
 * menu or a field of the body's own where the ⋯ stood (`onAsk`), as a
 * phone's View options opens from its header's ⋯ (`phone-head.tsx`).
 */
export type TabAction =
  | MenuAction
  | (Omit<MenuAction, "onSelect"> & { readonly onAsk: (opener: HTMLElement) => void });

/** What a tab's body offers, in the groups a rule divides. */
export type TabActionGroups = readonly (readonly TabAction[])[];

/** Hears the actions a tab's body offers on what it shows, none once it is no longer drawn. */
export type HandTabActions = (actions: TabActionGroups | undefined) => void;

/**
 * Where a tab's body hands what it offers, as the side panel draws it
 * (`side-panel.tsx`), so a body drawn at any depth of the tab, a task's
 * Inbox's list or a terminal's, hands it without a prop through every
 * layer; none outside a panel's tab.
 */
export const HandTabActionsContext = createContext<HandTabActions | undefined>(undefined);

/** The menu items a ⋯ drops for `groups`, an item opening a menu of the body's own opening it under `opener`. */
export function tabActionItems(
  groups: readonly (readonly TabAction[])[],
  opener: HTMLElement,
): MenuAction[][] {
  return groups.map((group) =>
    group.map((action) => {
      if (!("onAsk" in action)) return action;
      const { onAsk, ...item } = action;
      return { ...item, onSelect: () => onAsk(opener) };
    }),
  );
}

/** What a tab's menu offers on what the tab shows, each empty where the tab has none. */
interface ContentActions {
  rename: MenuAction[];
  terminal: MenuAction[];
  copies: MenuAction[];
  archive: MenuAction[];
  deletion: MenuAction[];
}

/**
 * What a tab's menu offers on what the tab shows, rather than on the tab
 * itself: an agent's Rename, its Show terminal, Copy link and a transcript's two copies,
 * an agent's Archive, which takes the tab with it, and its Permanently
 * delete, alone after it.
 */
function contentActions(doors: TabDoors): ContentActions {
  const { onCopy, onRename, onOpenTerminal, archive, deletion, copyLink } = doors;
  return {
    rename: onRename === undefined ? [] : [commandAction(PANEL_COMMAND.RENAME, onRename, false)],
    terminal:
      onOpenTerminal === undefined
        ? []
        : // ⌘J opens the chosen agent tab's terminal, so only the chosen tab's item says it.
          [commandAction(PANEL_COMMAND.SHOW_TERMINAL, onOpenTerminal, doors.chosen)],
    copies: [
      ...(copyLink === undefined ? [] : [copyLink]),
      ...(onCopy === undefined
        ? []
        : [
            commandAction(
              PANEL_COMMAND.COPY_CONCISE_TRANSCRIPT,
              () => onCopy(TRANSCRIPT_COPY.CONCISE),
              false,
            ),
            commandAction(
              PANEL_COMMAND.COPY_FULL_TRANSCRIPT,
              () => onCopy(TRANSCRIPT_COPY.FULL),
              false,
            ),
          ]),
    ],
    archive: archive === undefined ? [] : [archive],
    deletion: deletion === undefined ? [] : [deletion],
  };
}

/**
 * A tab's actions in the groups a rule divides, as an editor's tab offers
 * them on a right-click: Close and Close others, the plan's tab offering
 * only the second; Pin or Unpin, which puts it in the sidebar or
 * takes it out, and a Rename beside it; for an agent's, its Show terminal;
 * Copy link, for a tab whose thing has a link, and a transcript's two
 * copies after it; then, for an agent's, its Archive, and last and alone its
 * Permanently delete. Close others stands dimmed where nothing else would close.
 */
function tabActionGroups(doors: TabDoors): MenuAction[][] {
  const { onClose } = doors;
  const close: MenuAction[] =
    onClose === undefined
      ? []
      : [
          // ⌘W closes the tab chosen, so only the chosen tab's Close says it.
          commandAction(PANEL_COMMAND.CLOSE_TAB, onClose, doors.chosen),
        ];
  const pin: MenuAction[] =
    doors.pin === undefined
      ? []
      : [
          commandAction(
            doors.pin.pinned ? PANEL_COMMAND.UNPIN_TAB : PANEL_COMMAND.PIN_TAB,
            doors.pin.onToggle,
            false,
          ),
        ];
  const { rename, terminal, copies, archive, deletion } = contentActions(doors);
  return [
    [
      ...close,
      {
        ...commandAction(PANEL_COMMAND.CLOSE_OTHER_TABS, () => doors.onCloseOthers?.(), false),
        disabled: doors.onCloseOthers === undefined,
      },
    ],
    ...[[...pin, ...rename], terminal, copies, archive, deletion].filter(
      (group) => group.length > 0,
    ),
  ];
}

/**
 * The chosen tab's actions as its toolbar's ⋯ offers them: those of its
 * right-click that act on what it shows (`contentActions`), in the same
 * groups, and none of the tab's own keeping, Close, Close others, and Pin,
 * which stay on the right-click alone. An agent's own page offers the same
 * in its toolbar's ⋯ (`desktop-agent-page.tsx`), so a taskless agent is
 * acted on as a task's is.
 */
export function contentActionGroups(doors: Omit<TabDoors, "handed">): MenuAction[][] {
  const { rename, terminal, copies, archive, deletion } = contentActions(doors);
  return [rename, terminal, copies, archive, deletion].filter((group) => group.length > 0);
}

/** The chosen tab's actions as a strip's ⋯ offers them: what its body hands up while it is drawn (`handed`), first, then `contentActionGroups`. */
export function tabContentGroups(doors: TabDoors): TabActionGroups {
  return [...(doors.handed ?? []), ...contentActionGroups(doors)].filter(
    (group) => group.length > 0,
  );
}

/** Whether two items draw alike: named, said, and standing the same. */
function sameAction(one: TabAction, other: TabAction | undefined): boolean {
  return (
    other !== undefined &&
    one.label === other.label &&
    one.detail === other.detail &&
    one.disabled === other.disabled &&
    one.checked === other.checked &&
    one.danger === other.danger &&
    one.opens === other.opens &&
    one.command === other.command &&
    "onAsk" in one === "onAsk" in other
  );
}

/** Whether two hands of actions draw alike: the same items in the same groups, in the same order. */
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

/** `actions` as handed on: each item's press reaching the body's latest, so a hand made anew on every draw is handed again only as it draws otherwise. */
function throughLatest(
  actions: TabActionGroups,
  latest: React.RefObject<TabActionGroups | undefined>,
): TabActionGroups {
  return actions.map((group, at) =>
    group.map((action, place) => {
      const now = () => latest.current?.[at]?.[place];
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
          if (held !== undefined && !("onAsk" in held)) held.onSelect();
        },
      };
    }),
  );
}

/**
 * Hands the chosen tab's toolbar ⋯ the actions its body offers on what it
 * shows (`TabDoors.handed`), again each time they draw otherwise, and none
 * once the body is no longer drawn. Note that `hand` and each item's press
 * are read through refs, so a body making its actions anew on every draw,
 * as a phone's bar handed up does, hands them again only when an item's
 * words or standing change, and a press always reaches the latest.
 */
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

/** Hands the actions to the panel tab the body is drawn in (`HandTabActionsContext`); nothing outside one. */
export function useTabActions(actions: TabActionGroups | undefined): void {
  useHandedTabActions(useContext(HandTabActionsContext), actions);
}

/**
 * The chosen tab's ⋯, drawn into its toolbar's slot (`slot`) rather than on
 * the tab, as an editor's ⋯ acts on its active editor: it drops the tab's
 * content actions (`contentActionGroups`) under itself and takes focus back
 * when its menu closes by key. Note that it is portalled from the tab rather
 * than lifted to the toolbar, because what its actions open, an agent's
 * name field and its Archive's question, stands with the tab.
 */
function ToolbarTabActions({
  label,
  groups,
  slot,
}: {
  label: string;
  groups: TabActionGroups;
  slot: HTMLElement;
}): React.JSX.Element {
  const menu = useMenu(true);
  const named = moreLabel(label);
  return createPortal(
    <>
      <MoreButton thing={label} {...menu.trigger()} />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={named}
          menu={menu.drawn}
          groups={tabActionItems(groups, menu.drawn.opener)}
          onClose={menu.close}
        />
      )}
    </>,
    slot,
  );
}

/** What a tab of either strip draws, beyond its menu. */
export interface TabLook {
  /** The id the tab stands under, which the panel it shows is labelled by (`Tab`'s). */
  id?: string | undefined;
  /** The id of the panel the tab shows (`Tab`'s). */
  controls?: string | undefined;
  icon: React.JSX.Element;
  label: string;
  /** Words after the label, dimmed (`Tab`'s). */
  detail?: string | undefined;
  /** A mark at the tab's end, in its ×'s place: a failed agent's (`Tab`'s). */
  endMark?: React.JSX.Element | undefined;
  selected: boolean;
  unread?: boolean;
  card?: React.ReactNode;
  /** Draws no fill at rest: the plan's tab while it is its column's only one. */
  quiet?: boolean;
  /** Stands first in its strip, never dragged nor dropped before. */
  anchored?: boolean;
  /** Stands as its strip's preview (`Tab`'s). */
  preview?: boolean;
  onSelect: () => void;
  /** Keeps a preview as a tab of its own (`Tab`'s). */
  onKeep?: (() => void) | undefined;
}

/**
 * One tab of either strip, whatever its kind, with its menu
 * (`tabActionGroups`), and, while it is the chosen one and acts on what it
 * shows, its ⋯ in its toolbar's `slot`. A strip passes no slot for a tab
 * whose toolbar draws a ⋯ of its own, as the task's column does the task's.
 */
export function DoorsTab({
  look,
  doors,
  editor,
  tabRef,
  slot,
}: {
  look: TabLook;
  doors: TabDoors;
  editor?: React.ReactNode;
  tabRef?: React.RefObject<HTMLButtonElement | null> | undefined;
  slot?: HTMLElement | null | undefined;
}): React.JSX.Element {
  const content = tabContentGroups(doors);
  return (
    <>
      <MenuTab
        {...look}
        editor={editor}
        tabRef={tabRef}
        onClose={doors.onClose}
        groups={tabActionGroups(doors)}
      />
      {look.selected && content.length > 0 && slot !== undefined && slot !== null ? (
        <ToolbarTabActions label={look.label} groups={content} slot={slot} />
      ) : null}
    </>
  );
}

/** One row of a "+" menu, and what picking it does. */
export interface AddEntry {
  row: MenuRow;
  /** The mark at the row's end where the row says where its work stands, as the summary and the palette draw it: a failure's (`state-glyph.tsx`). */
  endMark?: React.JSX.Element | undefined;
  /** The card the row hangs beside it while the pointer rests on it, as its tab hangs its own; none where the row has none yet. */
  card?: React.ReactNode;
  onPick: () => void;
  /** The agent the row names, for a row of the task's agents, whose menu archives it. */
  agent?: CodingAgentSummary | undefined;
}

/** An entry as a menu draws its row: its end mark and its card drawn where `MenuRow` draws them, so a "+" menu, ⌘K and the summary say the same of a row. */
export function entryRow({ row, endMark, card }: AddEntry): MenuRow {
  return { ...row, end: endMark ?? row.end, card: card ?? row.card };
}

/** How wide the block standing in a tab is while its strip is read: a typical tab's width. */
const TAB_SKELETON_WIDTH = "120px";

/** The block standing in a tab while its strip is read, at a typical tab's width. */
export function TabSkeleton(): React.JSX.Element {
  return <Skeleton shape={SKELETON_SHAPE.CONTROL} width={TAB_SKELETON_WIDTH} />;
}

/** The block standing in the "+" while its strip is read: an icon press's square, as tall as it is wide. */
export function AddTabSkeleton(): React.JSX.Element {
  return <Skeleton shape={SKELETON_SHAPE.CONTROL} width="var(--luke-control-height)" />;
}

/**
 * The "+" after a strip's last tab, and the menu it drops: the shared
 * searchable one, as the repository and model pickers drop, over the rows
 * its column lists. It hangs under the "+" in `@luke/ui`'s anchored
 * popover, from the "+"'s left edge, or from its right where what is seen
 * of the window ends before the menu would, or pushed back inside where
 * neither edge keeps it there, as a phone's row leaves a "+" mid-way along
 * it. It keeps to the window rather than the side panel, so on the desktop
 * the side panel's menu still hangs over the column beside it. Opening it
 * asks `onOpen` to read what the rows say again, as the Start menu reads
 * its models, so an agent whose tab is not shown, which
 * nothing follows, says where it stands now rather than where it last did.
 * ⌘T's ask opens it as a press does, once its column is on screen to take
 * it (`answers`).
 */
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
  /** What the "+" and its menu are called. */
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

  // Note that the ask is answered once and then let go, because the "+"
  // stands again each time its column is shown, and an ask still standing
  // would open the menu on a column shown much later.
  useEffect(() => {
    if (!asked || !answers) return;
    onAnswered();
    setOpen(true);
    onOpen?.();
  }, [asked, answers, onAnswered, onOpen]);

  // Note that we hand focus back to the "+", as a native menu returns it to
  // its trigger, because closing takes the focused field away with it.
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
    <div ref={root} className="tab-add-anchor">
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

/** A transcript read on demand for a copy, nothing where it could not be read. */
export type TranscriptRead = () => Promise<CopiedTranscript | undefined>;

/** A copy of a transcript as the strips' tabs and the sidebar's pins offer it: read, then put on the clipboard as concise or full markdown. */
export type TranscriptCopier = (read: TranscriptRead) => (copy: TranscriptCopy) => void;

/** The copy of a transcript read on demand, answered with the window's toast: copied, or not read. */
export function useTranscriptCopier(): TranscriptCopier {
  const copyWithToast = useCopyToast();
  const toast = useToast();
  const unread = () =>
    toast({ words: TRANSCRIPT_UNREAD_NOTE, tone: STATUS_TONE.DANGER, hold: TOAST_HOLD.FAILED });
  return (read) => (copy) => {
    read().then(
      (transcript) =>
        transcript === undefined
          ? unread()
          : copyWithToast(transcriptMarkdown(transcript, copy), TRANSCRIPT_COPIED_NOTE),
      unread,
    );
  };
}

/** The transcripts the agents' and the delegated workers' tabs last drew, by agent and by the call that started each worker, read as a card is hung; the same value from page to page until a title it names moves. */
export interface HeldTranscripts {
  agents: ReadonlyMap<string, HeldTranscript>;
  workers: ReadonlyMap<string, HeldTranscript>;
}

/** Where the open delegated workers stand, by the call that started each, as their tabs' pages last said. */
export type WorkerStandings = ReadonlyMap<string, CodingAgentStatus>;

/** What the agents' and the workers' tabs last drew and said, and the presses that keep it. */
export interface TabViews {
  held: HeldTranscripts;
  standings: WorkerStandings;
  /** An agent's tab drew its transcript anew, which its hover card previews. */
  onAgentHeld: (agentId: string, held: HeldTranscript) => void;
  /** A delegated worker's tab drew its transcript anew, by the call that started it. */
  onWorkerHeld: (callId: string, held: HeldTranscript) => void;
  /** A delegated worker's page said where it stands now. */
  onWorkerStatus: (callId: string, status: CodingAgentStatus) => void;
}

/** Whether two readings name the same workers by the same titles. */
function sameTitles(
  a: ReadonlyMap<string, string> | undefined,
  b: ReadonlyMap<string, string> | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.size !== b.size) return false;
  for (const [key, title] of a) if (b.get(key) !== title) return false;
  return true;
}

/**
 * What the agents' and the workers' tabs last drew and said, held for as
 * long as the task's page is drawn. Note that what a tab holds is kept in
 * maps of the page's own rather than in its state, because a card reads it
 * only as it is hung (`agentCardReading`), and a page landing in a tab would
 * otherwise draw the whole task's page again, every tab's transcript among
 * it. The held value is a new one only when a title it names moves, which a
 * subagent's tab is labelled by as it is drawn (`drawnSubagent`).
 */
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
  const onWorkerStatus = useCallback((callId: string, status: CodingAgentStatus) => {
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
  // The same views across draws while nothing held moves, so the panes they are handed to hold.
  return useMemo(
    () => ({ held, standings, onAgentHeld, onWorkerHeld, onWorkerStatus }),
    [held, standings, onAgentHeld, onWorkerHeld, onWorkerStatus],
  );
}
