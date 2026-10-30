import type { AgentChangesPeople, AgentPullRequest } from "@luke/features/agent-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import type { TaskRunsOn } from "@luke/features/task-wire";
import {
  CHIP_LOOK,
  CHIP_SIZE,
  Chip,
  ChipName,
  GROUP_HEADING,
  GroupHeader,
  LIST_DENSITY,
  List,
  ListRow,
  RowHint,
  RowHintOptions,
  Tooltip,
} from "@luke/ui";
import { isAgentTab, sameTab } from "@luke/ui/tab-strip-model";
import { agentStillWriting, pullRequestNumberLabel } from "../tasks/agent-model.js";
import { type AgentSubject, agentSubject } from "../tasks/agent-ref.js";
import { PullRequestCard, peopleOf } from "../tasks/pull-request-card.js";
import { PullRequestMark, pullRequestMarkState } from "../tasks/pull-request-mark.js";
import { RunsOnPlace } from "../tasks/runs-on.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import { openerOf } from "../tasks/use-link-standing.js";
import type { MainTabsControl } from "../tasks/use-main-tabs.js";
import { SUMMARY_GLYPH } from "./agent-archive.js";
import { agentEntries } from "./main-tabs.js";
import type { AddEntry, HeldTranscripts } from "./strip-tabs.js";

/**
 * plan-agents.tsx -- the open task's agents at the head of its plan, as a group: one dense row each, its tab's glyph and name, where it runs, its failure where it failed, and its pull request.
 *
 * The agents stand under a group head, Agents and how many, which folds
 * them, folded where the page says nothing, the same shape every group of
 * the head takes, a `GroupHeader` over a dense `List`. Each row is the
 * task's agent as its "+" row and the summary draw it (`agentEntries`): its
 * tab's glyph, which gives way to the working mark while it works, its
 * tab's name, where it runs (`runs-on.tsx`), Cloud or the device, which is
 * the task's and so every row's alike, the failed mark at its end once its
 * turn failed, and the card its tab hangs. Its pull request, where it opened
 * one, stands after it as a chip of GitHub's mark in GitHub's colour for
 * where it stands and its number (`pull-request-mark.tsx`), hanging the
 * pull request's one card as its Pull request tab does, the agent whose it
 * is and who it names among what the card says (`pull-request-card.tsx`).
 * A row's press is the page's to answer (`onOpenAgent`): the side panel's
 * plan opens the agent as its tab's own press does. The chip opens the pull
 * request as the agent's own pull request chip does, in its Pull request
 * tab; it is still a link to its page, so a right-click offers its address.
 * Those at work come first, then the newest started; an archived agent is
 * not listed, and a task with no agent draws no group at all.
 */

/** What the group is called, and its list for a reader moving between lists. */
const AGENTS_LIST = "Agents";

/** What the group's count counts, said to a reader beside the figure. */
const AGENTS_NOUN = { one: "agent", many: "agents" } as const;

/** The agents in the order the list draws them: those still writing first, then the newest started, each group's order otherwise kept. */
function listedOrder(entries: readonly AddEntry[]): readonly AddEntry[] {
  const writing = (entry: AddEntry) =>
    entry.agent !== undefined && agentStillWriting(entry.agent.status);
  const started = (entry: AddEntry) => entry.agent?.createdAt ?? 0;
  return entries.toSorted(
    (a, b) => Number(writing(b)) - Number(writing(a)) || started(b) - started(a),
  );
}

/** An agent's pull request as a chip: its mark in GitHub's colour for where it stands and its number, hanging its card, opening its Pull request tab. */
function PullRequestChip({
  pullRequest,
  agent,
  people,
  onOpen,
}: {
  pullRequest: AgentPullRequest;
  /** The agent whose pull request it is, as the list names it, and how its tab opens. */
  agent: { subject: AgentSubject; models: readonly CatalogModel[] | undefined; onOpen: () => void };
  /** Who the pull request names, as its Pull request tab last read them; none before it has. */
  people: AgentChangesPeople | undefined;
  onOpen: () => void;
}): React.JSX.Element {
  const card = (
    <PullRequestCard
      pullRequest={pullRequest}
      lines={pullRequest}
      files={pullRequest.changedFiles}
      opener={people?.author ?? openerOf(pullRequest)}
      agent={agent}
      reviewers={people?.reviewers}
    />
  );
  return (
    <Tooltip label={pullRequest.title} card={card}>
      <Chip
        look={CHIP_LOOK.PILL}
        size={CHIP_SIZE.COMPACT}
        data-pull-request-state={pullRequestMarkState(pullRequest)}
        href={pullRequest.url}
        onClick={(event) => {
          // Note that the page opens in the window's Pull request tab, so the browser does not follow the address.
          event.preventDefault();
          onOpen();
        }}
      >
        <PullRequestMark pullRequest={pullRequest} />
        <ChipName>{pullRequestNumberLabel(pullRequest)}</ChipName>
      </Chip>
    </Tooltip>
  );
}

/** One agent's row: its tab's look, where it runs, its failed mark, and its pull request's chip where it opened one. */
function PlanAgentRow({
  entry,
  pullRequest,
  agents,
  held,
  tab,
  runsOn,
  onOpenPullRequest,
}: {
  entry: AddEntry;
  pullRequest: AgentPullRequest | undefined;
  agents: AgentsControl;
  held: HeldTranscripts;
  tab: MainTabsControl["tab"];
  runsOn: TaskRunsOn | undefined;
  onOpenPullRequest: () => void;
}): React.JSX.Element {
  const { row, endMark, card } = entry;
  const agentId = row.id;
  const chosen = tab !== undefined && sameTab({ agent: agentId }, tab);
  return (
    <RowHintOptions card={card}>
      <ListRow
        motionKey={row.id}
        leading={<span className={SUMMARY_GLYPH}>{row.icon}</span>}
        title={row.label}
        hint={card === undefined ? undefined : { Hint: RowHint, label: row.label }}
        meta={
          <>
            <RunsOnPlace runsOn={runsOn} />
            {endMark}
          </>
        }
        actions={
          pullRequest === undefined ? undefined : (
            <PullRequestChip
              pullRequest={pullRequest}
              agent={{
                subject: agentSubject(agents, agentId, held, chosen),
                models: agents.models,
                onOpen: entry.onPick,
              }}
              people={peopleOf(agents.changesPeople.get(agentId), pullRequest)}
              onOpen={onOpenPullRequest}
            />
          )
        }
        onPress={entry.onPick}
      />
    </RowHintOptions>
  );
}

/**
 * The task's agents at the head of its plan, under their group's head,
 * those at work first, then the newest; nothing for a task with none. A
 * row's press is handed to `onOpenAgent` by its agent's id, and
 * `onOpenPullRequest` opens an agent's pull request as its own chip does.
 */
export function PlanAgents({
  agents,
  held,
  tab,
  runsOn,
  folded = true,
  onOpenAgent,
  onOpenPullRequest,
}: {
  agents: AgentsControl;
  /** What the tabs hold, which each row's card reads as its tab's does. */
  held: HeldTranscripts;
  /** The column's chosen tab, whose agent's card follows its run. */
  tab: MainTabsControl["tab"];
  /** Where the task's agents run, which every row says. */
  runsOn: TaskRunsOn | undefined;
  /** Whether the group starts folded; folded unless the page says otherwise. */
  folded?: boolean | undefined;
  onOpenAgent: (agentId: string) => void;
  onOpenPullRequest: (agentId: string) => void;
}): React.JSX.Element | null {
  // Note that an entry's pick chooses its agent's tab, which a row hands the page as that agent's id.
  const entries = agentEntries(
    {
      tab,
      onChoose: (chosen) => {
        if (isAgentTab(chosen)) onOpenAgent(chosen.agent);
      },
    },
    agents,
    held,
  );
  if (entries.length === 0) return null;
  return (
    // Note that the group is pulled out by a row's inset on each side, so its marks stand on the title's edge and its fills hang past it.
    <div className="plan-agents -mx-row-inset mb-block-gap">
      <GroupHeader
        heading={GROUP_HEADING.NONE}
        label={AGENTS_LIST}
        count={{
          value: entries.length,
          noun: entries.length === 1 ? AGENTS_NOUN.one : AGENTS_NOUN.many,
        }}
        fold={{ defaultOpen: !folded }}
      >
        <List label={AGENTS_LIST} density={LIST_DENSITY.DENSE} moves>
          {listedOrder(entries).map((entry) => (
            <PlanAgentRow
              key={entry.row.id}
              entry={entry}
              pullRequest={agents.pullRequests.get(entry.row.id)}
              agents={agents}
              held={held}
              tab={tab}
              runsOn={runsOn}
              onOpenPullRequest={() => onOpenPullRequest(entry.row.id)}
            />
          ))}
        </List>
      </GroupHeader>
    </div>
  );
}
