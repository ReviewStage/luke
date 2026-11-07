import type { AgentSummary } from "@repo/features/agent-wire";
import {
  GROUP_HEADING,
  GROUP_SURFACE,
  GroupHeader,
  LIST_DENSITY,
  List,
  ListRow,
  NOTE_LINE_LOOK,
  NoteLine,
  PopoverIconButton,
  RowHint,
  RowHintOptions,
  SCROLL_SIZE,
  ScrollArea,
  SEARCH_FIELD_LOOK,
  SearchField,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { useRef, useState } from "react";
import { agentName } from "../tasks/agent-model.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import type { MainTabsControl } from "../tasks/use-main-tabs.js";
import { rowMenu } from "./action-menu.js";
import { agentMenuGroups, rowDoors, useAgentActions } from "./agent-actions.js";
import { SUMMARY_GLYPH } from "./agent-archive.js";
import { agentEntries } from "./main-tabs.js";
import type { AddEntry, HeldTranscripts } from "./strip-tabs.js";

/**
 * agent-history.tsx -- History at the end of the task's agents' tab bar: the task's agents whose tabs are closed, and those archived, in a searchable panel that opens them again.
 *
 * The button hangs a panel under it (`PopoverIconButton`), a search field at
 * its head over two groups, Closed and Archived, each the newest started
 * first, a group drawn only while it holds a row. A closed agent is one of
 * the task's agents not archived whose tab the column does not hold open.
 * Every row, a closed agent's and an archived one's alike, wears its tab's
 * look and hangs its tab's card (`agentEntries`), a right-click, a long
 * press, or the menu key opening the agent's menu as its tab's does, which
 * offers an archived agent's Unarchive; a press opens its tab again and
 * chooses it, as its tab's own press does, an archived agent's read only,
 * since looking at an agent never unarchives it. Each press puts the
 * panel away. An agent whose tab stands open is in the bar already, so it
 * is not listed; ⌘K still finds every agent. While nothing is closed or
 * archived the button stays, disabled, saying so, so the bar never shifts as
 * agents' tabs are closed and opened again.
 */

/** What the button and its panel are called. */
const HISTORY_LABEL = "Agent history";

/** What the button says while it has nothing to list. */
const NOTHING_TO_LIST = "No closed or archived agents";

/** What the search field says and is called. */
const SEARCH_LABEL = "Search agents";

/** What the panel says when the search matches nothing. */
const NO_MATCH = "No agents match";

/** The groups' headings, each also its list's name for a reader moving between lists. */
const HISTORY_GROUP = { CLOSED: "Closed", ARCHIVED: "Archived" } as const;

/** What a row's menu names its agent, an archived one's or another's. */
const ROW_THING = { AGENT: "Agent", ARCHIVED: "Archived agent" } as const;

/** Whether an agent's name holds the search, whatever its case; every agent for no search. */
function matches(agent: AgentSummary, models: AgentsControl["models"], query: string): boolean {
  const asked = query.trim().toLowerCase();
  return asked === "" || agentName(agent, models).toLowerCase().includes(asked);
}

/** An agent's row, closed or archived: its tab's glyph, name, and failure mark, hanging its tab's card, opening its tab on a press, and the agent's menu on a right-click. */
function HistoryAgentRow({
  entry,
  agent,
  agents,
  shown,
  onPick,
}: {
  entry: AddEntry;
  agent: AgentSummary;
  agents: AgentsControl;
  shown: boolean;
  onPick: () => void;
}) {
  const { row, endMark, card } = entry;
  // The agent's menu over the doors a row has, as the sidebar's agent rows offer it, but Rename,
  // since the row draws no name's field; its tab and its sidebar row rename it.
  const actions = useAgentActions(agent, agents, {
    label: row.label,
    shown,
    terminals: { onOpenTerminal: undefined },
  });
  const thing = agent.archivedAt === undefined ? ROW_THING.AGENT : ROW_THING.ARCHIVED;
  return (
    <>
      <RowHintOptions card={card}>
        <ListRow
          leading={<span className={SUMMARY_GLYPH}>{row.icon}</span>}
          title={row.label}
          titleReplayMasked
          meta={endMark}
          hint={card === undefined ? undefined : { Hint: RowHint, label: row.label }}
          onPress={onPick}
          menu={rowMenu(
            thing,
            agentMenuGroups({ ...rowDoors(actions.doors), onRename: undefined }),
            shown,
            true,
          )}
        />
      </RowHintOptions>
      {actions.dialog}
    </>
  );
}

/** The task's closed and archived agents, newest first, as History lists them for the search given. */
function historyAgents(
  main: Pick<MainTabsControl, "openAgents">,
  agents: Pick<AgentsControl, "agents" | "archived" | "models">,
  query = "",
): { closed: readonly AgentSummary[]; archived: readonly AgentSummary[] } {
  const open = main.openAgents ?? [];
  const listed = (each: AgentSummary) => matches(each, agents.models, query);
  // An agent whose tab is open is in the bar already, an archived one's among them.
  const inHistory = (each: AgentSummary) => !open.includes(each.id) && listed(each);
  const closed = (agents.agents ?? []).filter(inHistory);
  const archived = (agents.archived ?? []).filter(inHistory);
  return { closed: closed.toReversed(), archived: archived.toReversed() };
}

/** The panel History hangs: the search field, then the groups that hold a row, or a note that nothing matches. */
function HistoryPanel({
  main,
  agents,
  held,
  shown,
  search,
  onOpenAgent,
  onPicked,
}: {
  main: MainTabsControl;
  agents: AgentsControl;
  held: HeldTranscripts;
  shown: boolean;
  search: React.RefObject<HTMLInputElement | null>;
  onOpenAgent: (agentId: string) => void;
  onPicked: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const { closed, archived } = historyAgents(main, agents, query);
  // Note that every row takes its look and card from the "+" rows' one builder, so a row and its tab say the same.
  const entries = agentEntries(main, agents, held, closed);
  const archivedEntries = agentEntries(main, agents, held, archived);
  const open = (agentId: string) => {
    onPicked();
    onOpenAgent(agentId);
  };
  const rowOf = ({ agent, ...entry }: AddEntry) =>
    agent === undefined ? null : (
      <HistoryAgentRow
        key={entry.row.id}
        entry={entry}
        agent={agent}
        agents={agents}
        shown={shown}
        onPick={() => open(agent.id)}
      />
    );
  return (
    <div className="agent-history flex min-h-0 w-popover-narrow flex-col">
      <ReplayUnmask>
        <SearchField
          ref={search}
          look={SEARCH_FIELD_LOOK.MENU}
          label={SEARCH_LABEL}
          placeholder={SEARCH_LABEL}
          value={query}
          onChange={setQuery}
          onClear={() => setQuery("")}
        />
      </ReplayUnmask>
      <ScrollArea size={SCROLL_SIZE.CONTENT}>
        <div className="agent-history-groups flex flex-col gap-list-gap p-menu-inset">
          {entries.length === 0 && archived.length === 0 ? (
            <ReplayUnmask>
              <NoteLine look={NOTE_LINE_LOOK.LIST}>{NO_MATCH}</NoteLine>
            </ReplayUnmask>
          ) : null}
          {entries.length === 0 ? null : (
            <ReplayUnmask>
              <GroupHeader
                heading={GROUP_HEADING.NONE}
                surface={GROUP_SURFACE.NARROW}
                label={HISTORY_GROUP.CLOSED}
              >
                <List label={HISTORY_GROUP.CLOSED} density={LIST_DENSITY.DENSE}>
                  {entries.map((entry) => rowOf(entry))}
                </List>
              </GroupHeader>
            </ReplayUnmask>
          )}
          {archivedEntries.length === 0 ? null : (
            <ReplayUnmask>
              <GroupHeader
                heading={GROUP_HEADING.NONE}
                surface={GROUP_SURFACE.NARROW}
                label={HISTORY_GROUP.ARCHIVED}
              >
                <List label={HISTORY_GROUP.ARCHIVED} density={LIST_DENSITY.DENSE}>
                  {archivedEntries.map((entry) => rowOf(entry))}
                </List>
              </GroupHeader>
            </ReplayUnmask>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

/** History's button and the panel it hangs; see the module's head. */
export function AgentHistory({
  main,
  agents,
  held,
  shown,
  onOpenAgent,
}: {
  main: MainTabsControl;
  agents: AgentsControl;
  held: HeldTranscripts;
  /** Whether the task's page is on screen, for the panel and an archived row's menu not to outlive it. */
  shown: boolean;
  /** Opens an agent's tab in the column, a closed one's or an archived one's. */
  onOpenAgent: (agentId: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const search = useRef<HTMLInputElement | null>(null);
  const { closed, archived } = historyAgents(main, agents);
  const empty = closed.length === 0 && archived.length === 0;
  // Note that the panel goes with the page it hangs from, and with its last row.
  const standing = open && shown && !empty;
  return (
    <ReplayUnmask>
      <PopoverIconButton
        icon={<GLYPH.HISTORY />}
        label={HISTORY_LABEL}
        title={HISTORY_LABEL}
        hint={empty ? NOTHING_TO_LIST : HISTORY_LABEL}
        open={standing}
        onOpenChange={(next) => setOpen(next)}
        disabled={empty}
        initialFocus={search}
      >
        <HistoryPanel
          main={main}
          agents={agents}
          held={held}
          shown={standing}
          search={search}
          onOpenAgent={onOpenAgent}
          onPicked={() => setOpen(false)}
        />
      </PopoverIconButton>
    </ReplayUnmask>
  );
}
