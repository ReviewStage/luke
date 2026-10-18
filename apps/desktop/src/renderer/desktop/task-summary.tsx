import type { CodingAgentSummary } from "@luke/features/coding-agent-wire";
import {
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  IconButton,
  LIST_DENSITY,
  List,
  ListRow,
  useMenu,
} from "@luke/ui";
import { sameTab, TAB_WORDS } from "@luke/ui/tab-strip-model";
import { useClipped } from "@luke/ui/use-clipped";
import { useDisclosure } from "@luke/ui/use-disclosure";
import { shownFiles } from "@luke/voice/code-pane-model";
import { ChevronsLeftIcon, ChevronsRightIcon, ListIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { agentPlace, useCopyLinkItem } from "../copy-link-item";
import { ChangesCard, peopleOf } from "../tasks/agent-changes-tab";
import { agentCardReading, agentSubject } from "../tasks/agent-ref";
import { AgentTabCard } from "../tasks/agent-tab-card";
import { agentTabLabel } from "../tasks/coding-agent-model";
import { FileCard, newestFileNote } from "../tasks/file-ref";
import { type InboxBoardView, NEEDS_YOU } from "../tasks/inbox-model";
import { PageCard } from "../tasks/page-card";
import type { CodingAgentsControl } from "../tasks/use-coding-agents";
import { MAIN_TAB } from "../tasks/use-main-tabs";
import type { TasksControl } from "../tasks/use-tasks-tab";
import { workRowsOf } from "../tasks/work-model";
import { RowHint, RowHintOptions, Tooltip } from "../tooltip";
import { ActionMenu } from "./action-menu";
import { ArchivedAgents, useAgentArchive } from "./agent-archive";
import { AGENTS_SECTION, agentEntries, INBOX_ROW, inboxEntry } from "./main-tabs";
import {
  ADD_SECTION,
  type ChangesOffer,
  changesOffers,
  panelEntries,
  taskWorkers,
  workerCardReading,
} from "./side-panel";
import type { AddEntry, HeldTranscripts } from "./strip-tabs";

/**
 * task-summary.tsx -- the open task's summary at its column's right: everything the task's two "+" menus open, at a glance, pinned beside the document or folded to a rail of glyphs that expands in place as a card.
 *
 * The summary lists what the side panel's "+" and the task's column's "+"
 * open, in their rows' words and glyphs (`panelEntries`, `inboxEntry`,
 * `agentEntries`), under quiet headings: the task's Inbox, counting what
 * waits on the developer, and the panel's kinds the task has used, its
 * coding agents, each agent's pull request whose Changes tab the panel
 * opens, its subagents, and the files Luke showed on it. An agent or a subagent wears where it stands on its glyph,
 * and a failure at the row's end, as its tab does, since no tab stands
 * beside the row to say it, and a file is drawn in a row the
 * file tree's own: its type's coloured icon, height, and type size. A row
 * opens what it names exactly as its "+" row does: a kind, a subagent, or a
 * file opens the side panel on its tab, and an agent chooses its tab in the
 * column. An agent's row offers Archive agent on a right-click, and the
 * agents archived are folded under Archived at the foot of Coding agents
 * (`agent-archive.tsx`).
 *
 * A plan with nothing yet to list draws no summary at all, rail, card, or
 * toolbar button, rather than one saying so; it stands once the plan holds
 * its first row.
 *
 * It is drawn expanded or collapsed wherever the column has room for its
 * rail. Expanded and
 * where the column has room to keep the document at its measure beside it,
 * side panel open or shut, it stands pinned at the column's right, as
 * Cursor's does: borderless on the column's own ground, the document or the
 * agent's transcript, and the call bar's row under them, centred again in
 * the room it leaves, with a chevron at its top right, shown while the
 * pointer or the keys are on it, that collapses it from the very spot the
 * rail's expands it. Collapsed, or where the column has no such room, it is
 * a rail of the panel's kinds alone, each naming itself in its hint, under a
 * chevron that pins it again where it fits and otherwise hangs the whole
 * summary as a card over the rail's own footprint, the rail expanding in
 * place, with its own chevron back on the spot the rail's stood. The card
 * goes on that chevron, on Escape, on a row chosen, or on a press anywhere
 * outside it, which still lands where it was pressed. A column too narrow to
 * spare the rail's room draws no rail at all: the toolbar's button, which
 * hangs the same card, is its one way in. Whether it is pinned
 * is the window's preference, kept in the renderer's storage as the
 * sidebar's fold is, and a fixture run keeps none.
 *
 * Pinning or collapsing it changes the column's layout at once: the content
 * glides to its new middle and the summary to its new edge (pane-motion.tsx).
 */

/**
 * The storage key the pin is kept under. Note that a `false` kept from when
 * unpinning hid the summary now reads collapsed, the nearest thing to hidden
 * the summary still has.
 */
const SUMMARY_PINNED_KEY = "luke.summary-pinned";

/**
 * The least width of the task's column, in CSS pixels, at which the summary
 * can stand pinned rather than as a rail: the document's measure and its page
 * insets either side (`@luke/ui`'s `--luke-page-measure`, 720, and
 * `--luke-page-inset`, 40) beside the column's own `--summary-width`, 240, so
 * making room for it never reads the document under its measure. Note that
 * the column is measured whole, the summary included, and the side panel
 * beside it is not, so an open panel narrows what is measured and the
 * summary's own width never moves it.
 */
const SUMMARY_WIDE = 1040;

/**
 * The least width of the task's column, in CSS pixels, at which the summary
 * stands as a rail rather than not at all. Note that below it the rail's
 * 56px and the document's page insets either side, 80, would leave the words
 * under 344px, and the toolbar's button hangs the same card the rail does.
 */
const SUMMARY_RAILED = 480;

/** How the summary stands in the plan's column: pinned, a rail, or not drawn where the column has no room for one. */
const SUMMARY_MODE = {
  COLUMN: "column",
  RAIL: "rail",
  NONE: "none",
} as const;

type SummaryMode = (typeof SUMMARY_MODE)[keyof typeof SUMMARY_MODE];

/** What hung the card, which takes the focus back when Escape or its chevron takes the card down. */
const CARD_FROM = {
  TOOLBAR: "toolbar",
  RAIL: "rail",
} as const;

type CardFrom = (typeof CARD_FROM)[keyof typeof CARD_FROM];

/** The heading over the side panel's kinds, which their "+" menu lists under none. */
const TABS_SECTION = "Tabs";

/** The summary's headings, in the order it lists them. */
const SECTION_ORDER = [
  TABS_SECTION,
  AGENTS_SECTION,
  ADD_SECTION.PULL_REQUESTS,
  ADD_SECTION.SUBAGENTS,
  ADD_SECTION.FILES,
  ADD_SECTION.PAGES,
] as const;

/** The controls that hang the card, so a press on one toggles it rather than dismissing it first. */
const OPENER = "[data-summary-opener]";

/** What a row of the card opens over the window, drawn outside the card, so a press in it is no press outside: an agent's menu, its Archive's question, and a row's hover card. */
const OPENED_FROM_CARD = '[role="menu"], [role="alertdialog"], [role="tooltip"]';

/**
 * Whether the summary stands pinned where it fits, rather than collapsed to
 * its rail, and the press that turns it; and whether the task's column, as
 * last measured, has room for it pinned, which the column reports. Both are
 * held by the shell, whose panes glide as either turns how the summary
 * stands, the column's measure included.
 */
export interface SummaryPin {
  pinned: boolean;
  onToggle: () => void;
  wide: boolean;
  onMeasured: (wide: boolean) => void;
}

/** The kept pin, or pinned where there is none or storage refuses the read. */
function readPinned(): boolean {
  try {
    return window.localStorage.getItem(SUMMARY_PINNED_KEY) !== "false";
  } catch {
    return true;
  }
}

/**
 * The pin, kept across launches. A fixture run starts pinned and keeps
 * nothing, so its frames never wear a developer's own choice.
 */
export function useSummaryPin(fixtureMode: boolean): SummaryPin {
  const [kept, setKept] = useState(readPinned);
  const [staged, setStaged] = useState(true);
  const [wide, setWide] = useState(true);
  const onToggle = useCallback(
    () => (fixtureMode ? setStaged : setKept)((was) => !was),
    [fixtureMode],
  );
  // A write that fails costs only the preference, so it is not worth a word on screen.
  useEffect(() => {
    try {
      window.localStorage.setItem(SUMMARY_PINNED_KEY, String(kept));
    } catch {
      // The summary keeps working on the pin it holds.
    }
  }, [kept]);
  return { pinned: fixtureMode ? staged : kept, onToggle, wide, onMeasured: setWide };
}

/** How the summary stands now, whether its card hangs, and the presses that change either. */
export interface SummaryLayout {
  mode: SummaryMode;
  /** Whether the summary lists anything, without which neither it nor the toolbar's button is drawn. */
  holds: boolean;
  /** Whether the column has room for the summary pinned, which is what the toolbar's button turns. */
  wide: boolean;
  /** What hung the card, while it hangs. */
  card: CardFrom | undefined;
  /** The toolbar's button: the card while it hangs, else the pin where the summary fits, else the card. */
  onToggle: () => void;
  /** The rail's chevron, which does what the toolbar's button does. */
  onExpand: () => void;
  onDismiss: () => void;
}

/**
 * How the summary stands in the task's `column`, measured whole: pinned
 * while it is pinned and the column holds it beside the document's measure,
 * a rail where the column spares the rail's room, and not drawn otherwise,
 * nor while it `holds` nothing to list. A card hangs only where the summary
 * is not pinned, and only while the column is drawn and the summary holds
 * something, so the summary pinned, a side panel `covering` the column, or
 * its last row gone takes it down. A column not laid out, hidden or not yet
 * drawn, measures nothing and changes nothing.
 */
export function useSummaryLayout(
  pin: SummaryPin,
  column: HTMLElement | null,
  covering: boolean,
  holds: boolean,
): SummaryLayout {
  const { wide, onMeasured } = pin;
  const [hung, setHung] = useState<CardFrom | undefined>(undefined);
  const [railed, setRailed] = useState(true);
  useLayoutEffect(() => {
    if (column === null) return;
    const measure = () => {
      const width = column.getBoundingClientRect().width;
      if (width <= 0) return;
      onMeasured(width >= SUMMARY_WIDE);
      setRailed(width >= SUMMARY_RAILED);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    return () => observer.disconnect();
  }, [column, onMeasured]);
  const mode = !holds
    ? SUMMARY_MODE.NONE
    : wide && pin.pinned
      ? SUMMARY_MODE.COLUMN
      : railed
        ? SUMMARY_MODE.RAIL
        : SUMMARY_MODE.NONE;
  // Note that the card's keys are heard on the window, so a card the
  // column no longer shows is let go rather than left taking Escape.
  const gone = mode === SUMMARY_MODE.COLUMN || covering || !holds;
  if (gone && hung !== undefined) setHung(undefined);
  const card = gone ? undefined : hung;
  const expand = (from: CardFrom) => {
    if (card !== undefined) setHung(undefined);
    else if (wide) pin.onToggle();
    else setHung(from);
  };
  const onDismiss = useCallback(() => setHung(undefined), []);
  return {
    mode,
    holds,
    wide,
    card,
    onToggle: () => expand(CARD_FROM.TOOLBAR),
    onExpand: () => expand(CARD_FROM.RAIL),
    onDismiss,
  };
}

/** The attributes of a control that hangs the card: whether it hangs, and which it is. */
function cardControl(layout: SummaryLayout, cardId: string) {
  return {
    "aria-haspopup": "dialog" as const,
    "aria-expanded": layout.card !== undefined,
    "aria-controls": layout.card === undefined ? undefined : cardId,
  };
}

/**
 * The toolbar's button, after the ⋯ menu, drawn on while the summary is
 * expanded, pinned or hung, and not drawn while the summary holds nothing.
 * While the card hangs, or where the summary does not fit, it hangs the
 * card over the rail or takes it down; otherwise it pins the summary or
 * collapses it to its rail, and says which it is.
 */
export function SummaryButton({
  layout,
  cardId,
}: {
  layout: SummaryLayout;
  cardId: string;
}): React.JSX.Element | null {
  if (!layout.holds) return null;
  const pins = layout.wide && layout.card === undefined;
  const label = pins ? "Toggle pinned summary" : "Toggle summary";
  const state = pins
    ? { pressed: layout.mode === SUMMARY_MODE.COLUMN }
    : cardControl(layout, cardId);
  // Note that the box carries the opener's mark, which the shared button takes no attribute for.
  return (
    <span className="summary-toggle" data-summary-opener={CARD_FROM.TOOLBAR}>
      <Tooltip label={label}>
        <IconButton icon={<ListIcon />} label={label} {...state} onClick={layout.onToggle} />
      </Tooltip>
    </span>
  );
}

/** A row of the summary: its "+" row, and the card it hangs where the rest of the window hangs one for the same thing. */
interface SummaryEntry extends AddEntry {
  card?: ReactNode;
}

/** A heading and the rows under it. */
interface SummarySection<Entry extends AddEntry = SummaryEntry> {
  heading: string;
  entries: readonly Entry[];
}

/**
 * The Inbox row's card, in a tab card's look: its name, how many items wait
 * on the developer at its right, and under them the title of the newest
 * that waits, or of the latest settled where none does.
 */
function InboxCard({ inbox }: { inbox: InboxBoardView }): React.JSX.Element {
  const waiting = inbox.open.length;
  const latest = waiting > 0 ? inbox.open.at(-1) : inbox.settled[0];
  return (
    <HoverCard data-tab-card="">
      <HoverCardHead
        name={TAB_WORDS.INBOX}
        corner={
          waiting === 0
            ? NEEDS_YOU.NONE
            : `${waiting} ${waiting === 1 ? NEEDS_YOU.COUNT.one : NEEDS_YOU.COUNT.many}`
        }
      />
      {latest === undefined ? null : <HoverCardNote>{latest.title}</HoverCardNote>}
    </HoverCard>
  );
}

/**
 * The card each row hangs, the one its tab hangs where it has one: an
 * agent's its tab's card, read from what its tab last held; a subagent's
 * its tab's card, from the session the task's work holds; a file's its path
 * and Luke's note; a pull request's its title, number, and what it
 * changes, under the agent whose it is; a page's a preview of its newest
 * version; the Inbox's what waits. The panel's kinds hang none, as their
 * tabs hang none, since their names say all there is.
 */
function withCards(
  entries: readonly AddEntry[],
  input: {
    tasks: TasksControl;
    inbox: InboxBoardView;
    held: HeldTranscripts;
    workers: ReturnType<typeof taskWorkers>;
    files: readonly string[];
    changes: readonly ChangesOffer[];
    repository: string | null;
    /** Opens an agent's tab in the plan's column, handing it the keys, as a pull request's card offers. */
    onOpenAgent: (agentId: string) => void;
  },
): SummaryEntry[] {
  const { tasks, inbox, held, workers, files, changes, repository, onOpenAgent } = input;
  const { agents, mainTabs } = tasks;
  const models = agents.models ?? [];
  const shown = tasks.shownCode ?? [];
  return entries.map((entry) => {
    const { row, agent } = entry;
    if (agent !== undefined) {
      const label = agentTabLabel(agent, agents.models);
      const chosen = sameTab({ agent: agent.id }, mainTabs.tab);
      const read = agentCardReading(agent, label, held, chosen, agents);
      return { ...entry, card: <AgentTabCard name={label} models={models} read={read} /> };
    }
    if (row.id === INBOX_ROW) return { ...entry, card: <InboxCard inbox={inbox} /> };
    if (row.section === ADD_SECTION.SUBAGENTS) {
      const worker = workers.find((each) => each.call.id === row.id);
      const untitled = worker?.session?.title === undefined;
      const read = () => workerCardReading(worker, held);
      const card = (
        <AgentTabCard name={row.label} untitled={untitled} models={models} read={read} />
      );
      return { ...entry, card };
    }
    if (row.section === ADD_SECTION.PULL_REQUESTS) {
      // Note that a pull request's row is named by its page (`panelEntries`).
      const offer = changes.find((each) => each.pullRequest.url === row.id);
      if (offer === undefined) return entry;
      const chosen = sameTab({ agent: offer.agent.id }, mainTabs.tab);
      const subject = agentSubject(agents, offer.agent.id, held, chosen);
      const card = (
        <ChangesCard
          subject={subject}
          models={agents.models}
          pullRequest={offer.pullRequest}
          people={peopleOf(agents.changesPeople.get(offer.agent.id), offer.pullRequest)}
          onOpenAgent={() => onOpenAgent(offer.agent.id)}
        />
      );
      return { ...entry, card };
    }
    if (row.section === ADD_SECTION.PAGES) {
      // Note that a page's row is named by the page's id (`panelEntries`).
      const page = tasks.pages?.find((each) => each.id === row.id);
      const taskId = tasks.activeTaskId;
      if (page === undefined || taskId === undefined) return entry;
      return { ...entry, card: <PageCard taskId={taskId} page={page} /> };
    }
    // Note that a file's row is named by its place in the files listed (`panelEntries`).
    const path = row.section === ADD_SECTION.FILES ? files[Number(row.id)] : undefined;
    if (path === undefined) return entry;
    const note = newestFileNote(shown, path, { repository, commit: undefined });
    return { ...entry, card: <FileCard path={path} note={note} /> };
  });
}

/**
 * The rows the summary lists, before their cards: the plan's Inbox leads,
 * counting what waits on the developer, while it holds an item, waiting or
 * settled, or its tab is open, as a panel's kind stands once the plan has
 * used it; then the panel's kinds and what they hold, then the agents.
 */
function summaryRows(tasks: TasksControl, inbox: InboxBoardView) {
  const { sidePanel, mainTabs, agents, work } = tasks;
  const workers = taskWorkers(workRowsOf(work.conversation, work.callLive));
  const files = shownFiles(tasks.shownCode ?? []);
  const changes = changesOffers(agents, sidePanel.changes);
  const inboxHolds = inbox.open.length + inbox.settled.length > 0;
  const inboxRow =
    inboxHolds || mainTabs.tabs.includes(MAIN_TAB.INBOX)
      ? [inboxEntry(() => mainTabs.onChoose(MAIN_TAB.INBOX), inbox.open.length)]
      : [];
  const rows = [
    ...inboxRow,
    ...panelEntries({
      panel: sidePanel,
      kinds: sidePanel.used,
      workers,
      files,
      changes,
      pages: tasks.pages ?? [],
    }),
    ...agentEntries(mainTabs, agents),
  ];
  return { rows, workers, files, changes };
}

/** `entries` under their headings in their order, each heading only where it has a row. */
function sectionsOf<Entry extends AddEntry>(
  entries: readonly Entry[],
  agents: CodingAgentsControl,
): SummarySection<Entry>[] {
  // Coding agents stands while only archived agents are left, so their fold has a heading.
  const archived = (agents.archived?.length ?? 0) > 0;
  return SECTION_ORDER.flatMap((heading) => {
    const own = entries.filter((entry) => (entry.row.section ?? TABS_SECTION) === heading);
    const kept = own.length > 0 || (heading === AGENTS_SECTION && archived);
    return kept ? [{ heading, entries: own }] : [];
  });
}

/** What the summary lists, under its headings in their order, each row with the card it hangs. */
function summarySections(
  tasks: TasksControl,
  inbox: InboxBoardView,
  held: HeldTranscripts,
  repository: string | null,
  onOpenAgent: (agentId: string) => void,
): SummarySection[] {
  const { rows, workers, files, changes } = summaryRows(tasks, inbox);
  const paths = files.map((ref) => ref.path);
  const entries = withCards(rows, {
    tasks,
    inbox,
    held,
    workers,
    files: paths,
    changes,
    repository,
    onOpenAgent,
  });
  return sectionsOf(entries, tasks.agents);
}

/** Whether the plan's summary lists anything, which is whether it and its toolbar button are drawn at all. */
export function summaryHolds(tasks: TasksControl, inbox: InboxBoardView): boolean {
  return sectionsOf(summaryRows(tasks, inbox).rows, tasks.agents).length > 0;
}

/**
 * A row of the column or the card: its glyph, its label, and what tells it
 * apart, a file's folder, as its "+" row says it, after the label on its
 * line, then a failed agent's mark or the Inbox's count. A row with a card
 * hangs it on hover beside the row, before its start where the window ends
 * past it, as the sidebar's rows hang theirs. The files Luke showed keep the
 * file tree's own rows (`TreeRow`).
 */
function SummaryRow({
  entry,
  onPick,
  onContextMenu,
}: {
  entry: SummaryEntry;
  onPick: () => void;
  onContextMenu?: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  return (
    <RowHintOptions card={entry.card} cardBeside>
      <ListRow
        leading={<span className="task-summary-glyph">{entry.row.icon}</span>}
        title={entry.row.label}
        description={entry.row.detail}
        meta={entry.endMark}
        hint={entry.card === undefined ? undefined : { Hint: RowHint, label: entry.row.label }}
        onPress={onPick}
        onContextMenu={onContextMenu}
      />
    </RowHintOptions>
  );
}

/** A file's row, in the file tree's own: its type's glyph, its name, and its folder after it, faded at its end where it is cut short, its card hung on hover. */
function TreeRow({ entry, onPick }: { entry: SummaryEntry; onPick: () => void }) {
  const [words, clipped] = useClipped();
  const row = (
    <button type="button" className="task-summary-row" onClick={onPick}>
      <span className="task-summary-glyph">{entry.row.icon}</span>
      <span ref={words} className="task-summary-label" data-overflow={String(clipped)}>
        {entry.row.label}
        {entry.row.detail === undefined ? null : (
          <span className="task-summary-detail">{entry.row.detail}</span>
        )}
      </span>
      {entry.endMark}
    </button>
  );
  return (
    <li>
      {entry.card === undefined ? (
        row
      ) : (
        <Tooltip label={entry.row.label} card={entry.card} cardBeside>
          {row}
        </Tooltip>
      )}
    </li>
  );
}

/** An agent's row, whose right-click offers Copy link and Archive agent, asking first while the agent still works. */
function AgentSummaryRow({
  entry,
  agent,
  agents,
  shown,
  onPick,
}: {
  entry: SummaryEntry;
  agent: CodingAgentSummary;
  agents: CodingAgentsControl;
  shown: boolean;
  onPick: () => void;
}) {
  const archive = useAgentArchive(agent, agents, shown);
  const menu = useMenu(shown);
  const copyLink = useCopyLinkItem()(agentPlace(agent));
  return (
    <>
      <SummaryRow entry={entry} onPick={onPick} onContextMenu={menu.contextMenu()} />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label="Agent actions"
          menu={menu.drawn}
          groups={copyLink === undefined ? [[archive.action]] : [[copyLink], [archive.action]]}
          onClose={menu.close}
        />
      )}
      {archive.dialog}
    </>
  );
}

/** A row of the rail: its glyph alone, naming itself to a reader and in its hint, a file's hint its whole path, which its "+" row is searched by. */
function RailRow({ entry }: { entry: AddEntry }) {
  return (
    <li>
      <Tooltip label={entry.row.terms?.[0] ?? entry.row.label}>
        <IconButton
          icon={<span className="task-summary-glyph">{entry.row.icon}</span>}
          label={entry.row.label}
          onClick={entry.onPick}
        />
      </Tooltip>
    </li>
  );
}

/** The summary's headings and rows, as the column and the card list them, an agent's row with its menu and the archived agents' fold under Coding agents; `onPicked` hears a row chosen before it opens. */
function SummaryList({
  sections,
  agents,
  shown,
  onPicked,
}: {
  sections: readonly SummarySection[];
  agents: CodingAgentsControl;
  /** Whether the summary is on screen, which a row's menu and its question stand on. */
  shown: boolean;
  onPicked?: () => void;
}): React.JSX.Element {
  return (
    <>
      {sections.map(({ heading, entries }) => (
        <div key={heading} className="task-summary-section">
          <p className="section-heading">{heading}</p>
          {heading === ADD_SECTION.FILES ? (
            <ul className="task-summary-rows" aria-label={heading} data-tree="true">
              {entries.map((entry) => (
                <TreeRow
                  key={entry.row.id}
                  entry={entry}
                  onPick={() => {
                    onPicked?.();
                    entry.onPick();
                  }}
                />
              ))}
            </ul>
          ) : (
            <List label={heading} density={LIST_DENSITY.DENSE}>
              {entries.map((entry) => {
                const onPick = () => {
                  onPicked?.();
                  entry.onPick();
                };
                return entry.agent === undefined ? (
                  <SummaryRow key={entry.row.id} entry={entry} onPick={onPick} />
                ) : (
                  <AgentSummaryRow
                    key={entry.row.id}
                    entry={entry}
                    agent={entry.agent}
                    agents={agents}
                    shown={shown}
                    onPick={onPick}
                  />
                );
              })}
            </List>
          )}
          {heading === AGENTS_SECTION ? <ArchivedAgents agents={agents} shown={shown} /> : null}
        </div>
      ))}
    </>
  );
}

/**
 * The card, hung over the rail's footprint, its top and right edges the
 * rail's, over whatever the column shows, and its chevron, drawn while the
 * pointer is on the card, on the very spot of the rail's own, so the
 * pointer that expanded it collapses it without moving. It takes the focus
 * as it hangs, so the keys reach its rows, and gives it to the control that
 * hung it when Escape or its chevron takes it down. A press anywhere
 * outside it takes it down too, and still lands where it was pressed, but
 * one on a control that hangs it is that control's to answer. Taken down,
 * it is held drawn through its exit, `leaving`, inert and hearing nothing.
 */
function SummaryCard({
  id,
  from,
  sections,
  agents,
  onDismiss,
  leaving,
  ref: hold,
}: {
  id: string;
  from: CardFrom;
  sections: readonly SummarySection[];
  agents: CodingAgentsControl;
  onDismiss: () => void;
  leaving: boolean;
  /** Hands the card's element to the hold that draws it through its exit. */
  ref: (element: HTMLElement | null) => void;
}): React.JSX.Element {
  const card = useRef<HTMLDivElement>(null);
  const drawn = useCallback(
    (node: HTMLDivElement | null) => {
      card.current = node;
      hold(node);
    },
    [hold],
  );
  // Hung again while it was leaving, it takes the focus again.
  useLayoutEffect(() => {
    if (leaving) return;
    const element = card.current;
    (element?.querySelector<HTMLElement>("li > button") ?? element)?.focus({
      preventScroll: true,
    });
  }, [leaving]);
  const collapse = useCallback(() => {
    const opener = document.querySelector<HTMLElement>(`[data-summary-opener="${from}"]`);
    onDismiss();
    // The toolbar's opener is a box around its button, which takes the focus back.
    (opener?.querySelector<HTMLElement>("button") ?? opener)?.focus({ preventScroll: true });
  }, [from, onDismiss]);
  useEffect(() => {
    if (leaving) return;
    const press = (event: PointerEvent) => {
      const { target } = event;
      if (!(target instanceof Element) || card.current?.contains(target)) return;
      if (target.closest(OPENER) === null && target.closest(OPENED_FROM_CARD) === null) onDismiss();
    };
    // Note that the window's own Escape mutes a call or steps back a layer
    // (app.tsx), so the card keeps the press, as a menu does, before it is
    // heard there.
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // A menu or a question a row opened is the nearest layer, and takes its Escape itself.
      if (event.target instanceof Element && event.target.closest(OPENED_FROM_CARD) !== null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      collapse();
    };
    window.addEventListener("pointerdown", press, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", press, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [collapse, onDismiss, leaving]);
  return (
    <div
      ref={drawn}
      id={id}
      className="task-summary-card"
      role="dialog"
      aria-label="Summary"
      tabIndex={-1}
      data-leaving={leaving ? "true" : undefined}
      inert={leaving}
    >
      <span className="task-summary-collapse">
        <Tooltip label="Collapse summary">
          <IconButton icon={<ChevronsRightIcon />} label="Collapse summary" onClick={collapse} />
        </Tooltip>
      </span>
      <SummaryList sections={sections} agents={agents} shown onPicked={onDismiss} />
    </div>
  );
}

/**
 * The summary's own chevron at its top right, the one control of the column
 * and the rail, so a press on it keeps the focus as the summary turns. On
 * the rail it expands the summary as the toolbar's button does; pinned it
 * collapses the summary to the rail as that button does, kept as its press
 * is, drawn while the pointer or the keys are on the summary, on the very
 * spot of the rail's own, so the pointer that pinned it collapses it again
 * without moving.
 */
function SummaryChevron({
  layout,
  cardId,
}: {
  layout: SummaryLayout;
  cardId: string;
}): React.JSX.Element {
  const pinned = layout.mode === SUMMARY_MODE.COLUMN;
  const label = pinned ? "Collapse summary" : "Expand summary";
  const hangs = !pinned && !(layout.wide && layout.card === undefined);
  // Note that the box carries the opener's mark, which the shared button takes no attribute for.
  return (
    <span
      className="task-summary-chevron"
      data-summary-opener={pinned ? undefined : CARD_FROM.RAIL}
    >
      <Tooltip label={label}>
        <IconButton
          icon={pinned ? <ChevronsRightIcon /> : <ChevronsLeftIcon />}
          label={label}
          {...(hangs ? cardControl(layout, cardId) : {})}
          onClick={pinned ? layout.onToggle : layout.onExpand}
        />
      </Tooltip>
    </span>
  );
}

/**
 * The summary in the plan's column, pinned or as its rail, or nothing where
 * the column spares no rail, and the card while it hangs. The rail lists the panel's kinds alone, one glyph after
 * another under its chevron at one even step, since a glyph tells an agent,
 * a subagent, or a file from its neighbours by nothing a reader could tell
 * at a glance.
 */
export function TaskSummary({
  tasks,
  layout,
  cardId,
  inbox,
  held,
  repository,
  onOpenAgent,
}: {
  tasks: TasksControl;
  layout: SummaryLayout;
  cardId: string;
  /** The task's inbox, whose items stand its Inbox row and whose waiting ones it counts. */
  inbox: InboxBoardView;
  /** What the agents' tabs last drew, which their rows' cards preview as their tabs' cards do. */
  held: HeldTranscripts;
  /** The task's repository, whose showings alone a file row's card reads its note from. */
  repository: string | null;
  /** Opens an agent's tab in the plan's column, handing it the keys, as a pull request's card offers. */
  onOpenAgent: (agentId: string) => void;
}): React.JSX.Element {
  const sections = summarySections(tasks, inbox, held, repository, onOpenAgent);
  // The rail draws the panel's kinds alone, so the Inbox leading Tabs is left off it.
  const kinds = (sections.find(({ heading }) => heading === TABS_SECTION)?.entries ?? []).filter(
    (entry) => entry.row.id !== INBOX_ROW,
  );
  // The card is drawn through its exit, from the control that last hung it.
  const [hungFrom, setHungFrom] = useState(layout.card);
  if (layout.card !== undefined && layout.card !== hungFrom) setHungFrom(layout.card);
  const card = useDisclosure(layout.card !== undefined);
  return (
    <>
      {layout.mode === SUMMARY_MODE.NONE ? null : (
        <aside className="task-summary scroll-fade" aria-label="Summary" data-mode={layout.mode}>
          <SummaryChevron layout={layout} cardId={cardId} />
          {layout.mode === SUMMARY_MODE.COLUMN ? (
            <SummaryList sections={sections} agents={tasks.agents} shown={tasks.shown} />
          ) : kinds.length === 0 ? null : (
            <ul className="task-summary-rows" aria-label={TABS_SECTION}>
              {kinds.map((entry) => (
                <RailRow key={entry.row.id} entry={entry} />
              ))}
            </ul>
          )}
        </aside>
      )}
      {!card.mounted || hungFrom === undefined ? null : (
        <SummaryCard
          id={cardId}
          from={hungFrom}
          sections={sections}
          agents={tasks.agents}
          onDismiss={layout.onDismiss}
          leaving={card.leaving}
          ref={card.ref}
        />
      )}
    </>
  );
}
