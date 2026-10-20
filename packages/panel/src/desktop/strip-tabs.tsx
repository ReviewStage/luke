import type { CodingAgentStatus, CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  AnchoredPopover,
  CloseIcon,
  CopyIcon,
  EllipsisIcon,
  IconButton,
  PencilIcon,
  PinIcon,
  PlusIcon,
  POPOVER_ALIGN,
  POPOVER_BOUNDS,
  UnpinIcon,
  useMenu,
} from "@luke/ui";
import { useDisclosure } from "@luke/ui/use-disclosure";
import { ListXIcon, PlayIcon, ScrollTextIcon, TerminalIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCopyToast } from "../copy-feedback.js";
import { type MenuRow, SearchableMenu } from "../searchable-menu.js";
import type { HeldTranscript } from "../tasks/agent-tab-card.js";
import {
  type CopiedTranscript,
  TRANSCRIPT_COPY,
  type TranscriptCopy,
  transcriptMarkdown,
} from "../tasks/transcript-copy.js";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast.js";
import { Tooltip } from "../tooltip.js";
import { ActionMenu, type MenuAction } from "./action-menu.js";
import { MenuTab } from "./tab-strip.js";

/**
 * strip-tabs.tsx -- what the task's column's strip and the side panel's draw alike: a tab with its actions, the "+" after the last tab and the menu it drops, a transcript's copy, and what the agents' tabs last drew.
 *
 * Both strips are the one `TabStrip` (tab-strip.tsx), each of its tabs a
 * `MenuTab` whose right-click offers the actions `tabActionGroups` lists:
 * Close and Close others; Pin tab or Unpin tab, and an agent's Rename,
 * beside it; an agent's Open terminal; a transcript's two copies; and an
 * agent's Archive. Those that act on what the chosen tab shows, an agent's
 * Rename, Open terminal, copies, and Archive, and a subagent's copies, its
 * strip's toolbar also offers from a ⋯ (`ToolbarTabActions`), with what the
 * tab's own body hands up while it is drawn, a Pull request tab's Refresh
 * and Open on GitHub (`useHandedTabActions`). Each strip
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
  /** Runs the agent's pushed branch in a terminal of this Mac in the side panel, for an agent's where a panel takes the tab and its task names a repository. */
  onOpenOnMac?: (() => void) | undefined;
  /** Archives the agent the tab shows, for an agent's (`agent-archive.tsx`). */
  archive?: MenuAction | undefined;
  /** Copies the link of what the tab shows, for a tab whose thing has one (`copy-link-item.tsx`). */
  copyLink?: MenuAction | undefined;
  /** What the tab's body offers on what it shows while it is drawn (`useHandedTabActions`), which its toolbar's ⋯ alone offers, first. */
  handed?: MenuAction[] | undefined;
}

/** Hears the actions a tab's body offers on what it shows, none once it is no longer drawn. */
export type HandTabActions = (actions: MenuAction[] | undefined) => void;

/** What a tab's menu offers on what the tab shows, each empty where the tab has none. */
interface ContentActions {
  rename: MenuAction[];
  terminal: MenuAction[];
  copies: MenuAction[];
  archive: MenuAction[];
}

/**
 * What a tab's menu offers on what the tab shows, rather than on the tab
 * itself: an agent's Rename, its Open terminal and Run, Copy link and a transcript's two copies,
 * and an agent's Archive, which takes the tab with it.
 */
function contentActions(doors: TabDoors): ContentActions {
  const { onCopy, onRename, onOpenTerminal, onOpenOnMac, archive, copyLink } = doors;
  return {
    rename:
      onRename === undefined ? [] : [{ label: "Rename", icon: <PencilIcon />, onSelect: onRename }],
    terminal:
      onOpenTerminal === undefined
        ? []
        : [
            {
              label: "Open terminal",
              icon: <TerminalIcon />,
              onSelect: onOpenTerminal,
              // ⌘J opens the chosen agent tab's terminal, so only the chosen tab's item says it.
              ...(doors.chosen ? { command: APP_COMMAND.SHOW_TERMINAL } : undefined),
            },
            ...(onOpenOnMac === undefined
              ? []
              : [{ label: "Run", icon: <PlayIcon />, onSelect: onOpenOnMac }]),
          ],
    copies: [
      ...(copyLink === undefined ? [] : [copyLink]),
      ...(onCopy === undefined
        ? []
        : [
            {
              label: "Copy concise transcript",
              icon: <CopyIcon />,
              onSelect: () => onCopy(TRANSCRIPT_COPY.CONCISE),
            },
            {
              label: "Copy full transcript",
              icon: <ScrollTextIcon />,
              onSelect: () => onCopy(TRANSCRIPT_COPY.FULL),
            },
          ]),
    ],
    archive: archive === undefined ? [] : [archive],
  };
}

/**
 * A tab's actions in the groups a rule divides, as an editor's tab offers
 * them on a right-click: Close and Close others, the plan's tab offering
 * only the second; Pin tab or Unpin tab, which puts it in the sidebar or
 * takes it out, and a Rename beside it; for an agent's, its Open terminal;
 * Copy link, for a tab whose thing has a link, and a transcript's two
 * copies after it; and last, for an agent's, its Archive. Close others stands dimmed where nothing else would close.
 */
function tabActionGroups(doors: TabDoors): MenuAction[][] {
  const { onClose } = doors;
  const close: MenuAction[] =
    onClose === undefined
      ? []
      : [
          {
            label: "Close",
            icon: <CloseIcon />,
            onSelect: onClose,
            // ⌘W closes the tab chosen, so only the chosen tab's Close says it.
            ...(doors.chosen ? { command: APP_COMMAND.CLOSE_TAB } : undefined),
          },
        ];
  const pin: MenuAction[] =
    doors.pin === undefined
      ? []
      : [
          doors.pin.pinned
            ? { label: "Unpin tab", icon: <UnpinIcon />, onSelect: doors.pin.onToggle }
            : { label: "Pin tab", icon: <PinIcon />, onSelect: doors.pin.onToggle },
        ];
  const { rename, terminal, copies, archive } = contentActions(doors);
  return [
    [
      ...close,
      {
        label: "Close others",
        icon: <ListXIcon />,
        onSelect: () => doors.onCloseOthers?.(),
        disabled: doors.onCloseOthers === undefined,
      },
    ],
    ...[[...pin, ...rename], terminal, copies, archive].filter((group) => group.length > 0),
  ];
}

/**
 * The chosen tab's actions as its toolbar's ⋯ offers them: those of its
 * right-click that act on what it shows (`contentActions`), in the same
 * groups, after what its body hands up while it is drawn (`handed`), and
 * none of the tab's own keeping, Close, Close others, and Pin tab, which
 * stay on the right-click alone.
 */
function contentActionGroups(doors: TabDoors): MenuAction[][] {
  const { rename, terminal, copies, archive } = contentActions(doors);
  return [doors.handed ?? [], rename, terminal, copies, archive].filter(
    (group) => group.length > 0,
  );
}

/**
 * Hands the chosen tab's toolbar ⋯ the actions its body offers on what it
 * shows (`TabDoors.handed`), again each time they change, and none once
 * the body is no longer drawn. Note that `hand` is read through a ref, so
 * a door made anew on each render hands nothing more; `actions` is what a
 * change is heard by, so a caller keeps it the same while it means the same.
 */
export function useHandedTabActions(
  hand: HandTabActions | undefined,
  actions: MenuAction[] | undefined,
): void {
  const told = useRef(hand);
  told.current = hand;
  useEffect(() => {
    told.current?.(actions);
  }, [actions]);
  useEffect(() => () => told.current?.(undefined), []);
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
  groups: MenuAction[][];
  slot: HTMLElement;
}): React.JSX.Element {
  const menu = useMenu(true);
  const named = `${label} actions`;
  return createPortal(
    <>
      <Tooltip label={named}>
        <IconButton icon={<EllipsisIcon />} label={named} {...menu.trigger()} />
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu label={named} menu={menu.drawn} groups={groups} onClose={menu.close} />
      )}
    </>,
    slot,
  );
}

/** What a tab of either strip draws, beyond its menu. */
export interface TabLook {
  icon: React.JSX.Element;
  label: string;
  /** Words after the label, dimmed (`Tab`'s). */
  detail?: string | undefined;
  /** A mark at the tab's end, in its ×'s place: a failed agent's (`Tab`'s). */
  endMark?: React.JSX.Element | undefined;
  selected: boolean;
  unread?: boolean;
  tooltip?: string | undefined;
  card?: React.ReactNode;
  keyshortcuts?: string | undefined;
  /** Draws no fill at rest: the plan's tab while it is its column's only one. */
  quiet?: boolean;
  /** Stands first in its strip, never dragged nor dropped before. */
  anchored?: boolean;
  onSelect: () => void;
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
  const content = contentActionGroups(doors);
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
  onPick: () => void;
  /** The agent the row names, for a row of the task's agents, whose menu archives it. */
  agent?: CodingAgentSummary | undefined;
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
        <AnchoredPopover align={POPOVER_ALIGN.START} bounds={POPOVER_BOUNDS.WINDOW}>
          <SearchableMenu
            leaving={drawn.leaving}
            ref={drawn.ref}
            id={menuId}
            className="tab-add-menu"
            label={label}
            placeholder={placeholder}
            rows={entries.map((entry) => entry.row)}
            value={undefined}
            noMatch={noMatch}
            onPick={pick}
            onClose={close}
            onLeave={(left) => {
              if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
            }}
          />
        </AnchoredPopover>
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
    toast({ words: TRANSCRIPT_UNREAD_NOTE, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });
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

/** The transcripts the agents' and the delegated workers' tabs last drew, by agent and by the call that started each worker. */
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

/** What the agents' and the workers' tabs last drew and said, held for as long as the task's page is drawn. */
export function useTabViews(): TabViews {
  const [standings, setStandings] = useState<WorkerStandings>(() => new Map());
  const [held, setHeld] = useState<HeldTranscripts>(() => ({
    agents: new Map(),
    workers: new Map(),
  }));
  const onWorkerStatus = useCallback((callId: string, status: CodingAgentStatus) => {
    setStandings((was) => (was.get(callId) === status ? was : new Map(was).set(callId, status)));
  }, []);
  const onAgentHeld = useCallback((agentId: string, transcript: HeldTranscript) => {
    setHeld((was) => ({ ...was, agents: new Map(was.agents).set(agentId, transcript) }));
  }, []);
  const onWorkerHeld = useCallback((callId: string, transcript: HeldTranscript) => {
    setHeld((was) => ({ ...was, workers: new Map(was.workers).set(callId, transcript) }));
  }, []);
  return { held, standings, onAgentHeld, onWorkerHeld, onWorkerStatus };
}
