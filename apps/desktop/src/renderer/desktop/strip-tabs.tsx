import type { CodingAgentStatus, CodingAgentSummary } from "@luke/features/coding-agent-wire";
import {
  CloseIcon,
  CopyIcon,
  EllipsisIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  UnpinIcon,
} from "@luke/ui";
import { ListXIcon, ScrollTextIcon, TerminalIcon } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { APP_COMMAND } from "#shared/shortcuts";
import { useCopyToast } from "../copy-feedback";
import { type MenuRow, SearchableMenu } from "../searchable-menu";
import type { HeldTranscript } from "../tasks/agent-tab-card";
import {
  type CopiedTranscript,
  TRANSCRIPT_COPY,
  type TranscriptCopy,
  transcriptMarkdown,
} from "../tasks/transcript-copy";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast";
import { Tooltip } from "../tooltip";
import { useDisclosure } from "../use-disclosure";
import { ActionMenu, type MenuAction, useActionMenu } from "./action-menu";
import { MenuTab } from "./tab-strip";

/**
 * strip-tabs.tsx -- what the plan's column's strip and the side panel's draw alike: a tab with its actions, the "+" after the last tab and the menu it drops, a transcript's copy, and what the agents' tabs last drew.
 *
 * Both strips are the one `TabStrip` (tab-strip.tsx), each of its tabs a
 * `MenuTab` whose right-click offers the actions `tabActionGroups` lists:
 * Close and Close others; Pin tab or Unpin tab, and an agent's Rename,
 * beside it; an agent's Open terminal; a transcript's two copies; and an
 * agent's Archive. Those that act on what the chosen tab shows, an agent's
 * Rename, Open terminal, copies, and Archive, and a subagent's copies, its
 * strip's toolbar also offers from a ⋯ (`ToolbarTabActions`). Each strip
 * ends in a "+" that drops the shared searchable menu over what the strip
 * may open. The columns' own modules say which tabs and rows those are
 * (`main-tabs.tsx`, `side-panel.tsx`).
 *
 * What an agent's or a delegated worker's tab last drew is held here for as
 * long as the plan's page is drawn, whichever column the tab stands in, so
 * its card can preview its latest step once another tab is shown, and a
 * delegated worker's card can read its model from the call its agent's tab
 * last drew. Where a delegated worker stands is what its own tab's pages
 * say, held here for its glyph the same way.
 */

/** What the toast says once a tab's transcript, concise or full, is on the clipboard. */
const TRANSCRIPT_COPIED_NOTE = "Transcript copied";

/** What the toast says when a tab's transcript could not be read whole for a copy. */
const TRANSCRIPT_UNREAD_NOTE = "The transcript could not be copied. Try again.";

/** Which edge of the "+" its menu hangs from: its left, or its right where the window leaves no room. */
const MENU_SIDE = {
  START: "start",
  END: "end",
} as const;

type MenuSide = (typeof MENU_SIDE)[keyof typeof MENU_SIDE];

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
  /** Copies the link of what the tab shows, for a tab whose thing has one (`copy-link-item.tsx`). */
  copyLink?: MenuAction | undefined;
}

/** What a tab's menu offers on what the tab shows, each empty where the tab has none. */
interface ContentActions {
  rename: MenuAction[];
  terminal: MenuAction[];
  copies: MenuAction[];
  archive: MenuAction[];
}

/**
 * What a tab's menu offers on what the tab shows, rather than on the tab
 * itself: an agent's Rename, its Open terminal, Copy link and a transcript's two copies,
 * and an agent's Archive, which takes the tab with it.
 */
function contentActions(doors: TabDoors): ContentActions {
  const { onCopy, onRename, onOpenTerminal, archive, copyLink } = doors;
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
 * groups, and none of the tab's own keeping, Close, Close others, and Pin
 * tab, which stay on the right-click alone.
 */
function contentActionGroups(doors: TabDoors): MenuAction[][] {
  const { rename, terminal, copies, archive } = contentActions(doors);
  return [rename, terminal, copies, archive].filter((group) => group.length > 0);
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
  const menu = useActionMenu(true);
  const named = `${label} actions`;
  return createPortal(
    <>
      <Tooltip label={named}>
        <button type="button" className="icon-button" aria-label={named} {...menu.trigger()}>
          <EllipsisIcon />
        </button>
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
 * whose toolbar draws a ⋯ of its own, as the plan's column does the plan's.
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
  /** The agent the row names, for a row of the plan's agents, whose menu archives it. */
  agent?: CodingAgentSummary | undefined;
}

/**
 * The "+" after a strip's last tab, and the menu it drops: the shared
 * searchable one, as the repository and model pickers drop, over the rows
 * its column lists. It hangs from the "+"'s left edge, or from its right
 * where the window ends before the menu would, measured before it is
 * painted. Opening it asks `onOpen` to read what the rows say again, as the
 * Start menu reads its models, so an agent whose tab is not shown, which
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
  const [side, setSide] = useState<MenuSide>(MENU_SIDE.START);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const menu = root.current?.querySelector(".searchable-menu") ?? null;
    if (!open || menu === null) return;
    const room = document.documentElement.clientWidth;
    setSide(menu.getBoundingClientRect().right > room ? MENU_SIDE.END : MENU_SIDE.START);
  }, [open]);

  // Note that the ask is answered once and then let go, because the "+"
  // stands again each time its column is shown, and an ask still standing
  // would open the menu on a column shown much later.
  useEffect(() => {
    if (!asked || !answers) return;
    onAnswered();
    setSide(MENU_SIDE.START);
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
    <div ref={root} className="tab-add-anchor" data-side={side}>
      <Tooltip label={label} command={APP_COMMAND.NEW_TAB}>
        <button
          ref={opener}
          type="button"
          className="icon-button tab-add"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => {
            if (open) {
              close();
              return;
            }
            setSide(MENU_SIDE.START);
            setOpen(true);
            onOpen?.();
          }}
        >
          <PlusIcon />
        </button>
      </Tooltip>
      {drawn.mounted ? (
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

/** What the agents' and the workers' tabs last drew and said, held for as long as the plan's page is drawn. */
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
