import type { CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { sameTab, TAB_WORDS } from "@luke/ui/tab-strip-model";
import { shownFiles } from "@luke/voice/code-pane-model";
import { ListIcon } from "lucide-react";
import type { ReactNode } from "react";
import { agentPlace, useCopyLinkItem } from "../copy-link-item";
import { EmptyState } from "../empty-state";
import { CardHead, CardNote, HoverCard } from "../hover-card";
import { ChangesCard, peopleOf } from "../tasks/agent-changes-tab";
import { agentCardReading, agentSubject } from "../tasks/agent-ref";
import { AgentTabCard } from "../tasks/agent-tab-card";
import { agentTabLabel } from "../tasks/coding-agent-model";
import { FileCard, newestFileNote } from "../tasks/file-ref";
import { type InboxBoardView, NEEDS_YOU } from "../tasks/inbox-model";
import type { CodingAgentsControl } from "../tasks/use-coding-agents";
import { MAIN_TAB } from "../tasks/use-main-tabs";
import { SIDE_PANEL_TAB } from "../tasks/use-side-panel";
import type { TasksControl } from "../tasks/use-tasks-tab";
import { workRowsOf } from "../tasks/work-model";
import { Tooltip } from "../tooltip";
import { useClipped } from "../use-clipped";
import { ActionMenu, useActionMenu } from "./action-menu";
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
 * task-summary.tsx -- the open plan's Summary tab in the side panel: everything the plan's two "+" menus open, at a glance.
 *
 * The summary lists what the side panel's "+" and the plan's column's "+"
 * open, in their rows' words and glyphs (`panelEntries`, `inboxEntry`,
 * `agentEntries`), under quiet headings: the plan's Inbox, counting what
 * waits on the developer, and the panel's other kinds the plan has used, its
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
 * It is one of the panel's fixed tabs, first in the strip
 * (`use-side-panel.ts`), so it shares the window's right with nothing: an
 * earlier version pinned it beside the document as a surface of its own,
 * which the panel squeezed to a rail and closing the panel pinned again. A
 * plan with nothing yet to list says so in its place.
 */

/** The heading over the side panel's kinds, which their "+" menu lists under none. */
const TABS_SECTION = "Tabs";

/** What the Summary tab says while the plan holds nothing to list. */
const NOTHING_LISTED = "Nothing on this plan yet.";

/** The summary's headings, in the order it lists them. */
const SECTION_ORDER = [
  TABS_SECTION,
  AGENTS_SECTION,
  ADD_SECTION.CHANGES,
  ADD_SECTION.SUBAGENTS,
  ADD_SECTION.FILES,
  ADD_SECTION.PAGES,
] as const;

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
      <CardHead
        name={TAB_WORDS.INBOX}
        corner={
          waiting === 0
            ? NEEDS_YOU.NONE
            : `${waiting} ${waiting === 1 ? NEEDS_YOU.COUNT.one : NEEDS_YOU.COUNT.many}`
        }
      />
      {latest === undefined ? null : <CardNote>{latest.title}</CardNote>}
    </HoverCard>
  );
}

/**
 * The card each row hangs, the one its tab hangs where it has one: an
 * agent's its tab's card, read from what its tab last held; a subagent's
 * its tab's card, from the session the plan's work holds; a file's its path
 * and Luke's note; a pull request's its title, number, and what it
 * changes, under the agent whose it is; the Inbox's what waits. The panel's kinds hang none, as their
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
    if (row.section === ADD_SECTION.CHANGES) {
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
function summaryRows(plans: TasksControl, inbox: InboxBoardView) {
  const { sidePanel, mainTabs, agents, work } = plans;
  const workers = taskWorkers(workRowsOf(work.conversation, work.callLive));
  const files = shownFiles(plans.shownCode ?? []);
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
      // The Summary is the tab this list stands in, so it lists the panel's other kinds.
      kinds: sidePanel.used.filter((kind) => kind !== SIDE_PANEL_TAB.SUMMARY),
      workers,
      files,
      changes,
      pages: plans.pages ?? [],
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

/**
 * A row of the summary: its glyph, its label, and what tells it
 * apart, a file's folder, as its "+" row says it, faded at its end where it
 * is cut short, then a failed agent's mark or the Inbox's count. A row with
 * a card hangs it on hover beside the row, before its start where the
 * window ends past it, as the sidebar's rows hang theirs.
 */
function SummaryRow({
  entry,
  onPick,
  onContextMenu,
}: {
  entry: SummaryEntry;
  onPick: () => void;
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const [words, clipped] = useClipped();
  const row = (
    <button
      type="button"
      className="task-summary-row"
      onClick={onPick}
      onContextMenu={onContextMenu}
    >
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
  const menu = useActionMenu(shown);
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

/** The summary's headings and rows, an agent's row with its menu and the archived agents' fold under Coding agents. */
function SummaryList({
  sections,
  agents,
  shown,
}: {
  sections: readonly SummarySection[];
  agents: CodingAgentsControl;
  /** Whether the summary is on screen, which a row's menu and its question stand on. */
  shown: boolean;
}): React.JSX.Element {
  return (
    <>
      {sections.map(({ heading, entries }) => (
        <div key={heading} className="task-summary-section">
          <p className="section-heading">{heading}</p>
          <ul
            className="task-summary-rows"
            aria-label={heading}
            data-tree={String(heading === ADD_SECTION.FILES)}
          >
            {entries.map((entry) =>
              entry.agent === undefined ? (
                <SummaryRow key={entry.row.id} entry={entry} onPick={entry.onPick} />
              ) : (
                <AgentSummaryRow
                  key={entry.row.id}
                  entry={entry}
                  agent={entry.agent}
                  agents={agents}
                  shown={shown}
                  onPick={entry.onPick}
                />
              ),
            )}
          </ul>
          {heading === AGENTS_SECTION ? <ArchivedAgents agents={agents} shown={shown} /> : null}
        </div>
      ))}
    </>
  );
}

/**
 * The Summary tab's content: the plan's summary under its headings, or a line
 * saying the plan holds nothing yet to list.
 */
export function TaskSummary({
  tasks,
  inbox,
  held,
  repository,
  onOpenAgent,
}: {
  tasks: TasksControl;
  /** The plan's inbox, whose items stand its Inbox row and whose waiting ones it counts. */
  inbox: InboxBoardView;
  /** What the agents' tabs last drew, which their rows' cards preview as their tabs' cards do. */
  held: HeldTranscripts;
  /** The plan's repository, whose showings alone a file row's card reads its note from. */
  repository: string | null;
  /** Opens an agent's tab in the plan's column, handing it the keys, as a pull request's card offers. */
  onOpenAgent: (agentId: string) => void;
}): React.JSX.Element {
  const sections = summarySections(tasks, inbox, held, repository, onOpenAgent);
  if (sections.length === 0) {
    return <EmptyState icon={<ListIcon />}>{NOTHING_LISTED}</EmptyState>;
  }
  return (
    <div className="task-summary scroll-fade">
      <SummaryList sections={sections} agents={tasks.agents} shown={tasks.shown} />
    </div>
  );
}
