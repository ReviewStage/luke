import type { CodingAgentPullRequest } from "@luke/features/coding-agent-wire";
import {
  CHIP_LOOK,
  CHIP_SIZE,
  Chip,
  ChipName,
  LIST_VARIANT,
  List,
  ListRow,
  RowHint,
  RowHintOptions,
  Tooltip,
} from "@luke/ui";
import { agentStillWriting, pullRequestNumberLabel } from "../tasks/coding-agent-model.js";
import { PullRequestMark, pullRequestMarkState } from "../tasks/pull-request-mark.js";
import type { CodingAgentsControl } from "../tasks/use-coding-agents.js";
import type { MainTabsControl } from "../tasks/use-main-tabs.js";
import { SUMMARY_GLYPH } from "./agent-archive.js";
import { agentEntries } from "./main-tabs.js";
import type { AddEntry, HeldTranscripts } from "./strip-tabs.js";
import { PullRequestCard } from "./task-part-cards.js";

/**
 * plan-agents.tsx -- the open task's agents at the head of its plan: one row each, its tab's glyph and name, its failure where it failed, and its pull request.
 *
 * Each row is the task's agent as its "+" row and the summary draw it
 * (`agentEntries`): its tab's glyph, which gives way to the working mark
 * while it works, its tab's name, the failed mark at its end once its turn
 * failed, and the card its tab hangs. Its pull request, where it opened
 * one, stands after it as a chip of GitHub's mark in GitHub's colour for
 * where it stands and its number (`pull-request-mark.tsx`), hanging the
 * pull request's card. A row opens its agent as its tab's own press does,
 * and the chip opens the pull request as the agent's own pull request chip
 * does, in its Pull request tab; it is still a link to its page, so a
 * right-click offers its address. Those at work come first, then the
 * newest started; an archived agent is not listed, and a task with no
 * agent draws no list at all.
 */

/** What the list is named for a reader moving between lists. */
const AGENTS_LIST = "Agents";

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
  onOpen,
}: {
  pullRequest: CodingAgentPullRequest;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <Tooltip label={pullRequest.title} card={<PullRequestCard pullRequest={pullRequest} />}>
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

/** One agent's row: its tab's look, its failed mark, and its pull request's chip where it opened one. */
function PlanAgentRow({
  entry,
  pullRequest,
  onOpenPullRequest,
}: {
  entry: AddEntry;
  pullRequest: CodingAgentPullRequest | undefined;
  onOpenPullRequest: () => void;
}): React.JSX.Element {
  const { row, endMark, card } = entry;
  return (
    <RowHintOptions card={card} cardBeside>
      <ListRow
        motionKey={row.id}
        leading={<span className={SUMMARY_GLYPH}>{row.icon}</span>}
        title={row.label}
        hint={card === undefined ? undefined : { Hint: RowHint, label: row.label }}
        meta={endMark}
        actions={
          pullRequest === undefined ? undefined : (
            <PullRequestChip pullRequest={pullRequest} onOpen={onOpenPullRequest} />
          )
        }
        onPress={entry.onPick}
      />
    </RowHintOptions>
  );
}

/**
 * The task's agents at the head of its plan, those at work first, then the
 * newest; nothing for a task with none. A row opens its agent through
 * `main`, as its tab's press does, and `onOpenPullRequest` an agent's pull
 * request as its own chip does.
 */
export function PlanAgents({
  agents,
  held,
  main,
  onOpenPullRequest,
}: {
  agents: CodingAgentsControl;
  /** What the tabs hold, which each row's card reads as its tab's does. */
  held: HeldTranscripts;
  /** The column's chosen tab, whose agent's card follows its run, and how a tab of the column is opened. */
  main: Pick<MainTabsControl, "tab" | "onChoose">;
  onOpenPullRequest: (agentId: string) => void;
}): React.JSX.Element | null {
  const entries = agentEntries(main, agents, held);
  if (entries.length === 0) return null;
  return (
    <div className="plan-agents mb-block-gap">
      <List label={AGENTS_LIST} variant={LIST_VARIANT.CARD} moves>
        {listedOrder(entries).map((entry) => (
          <PlanAgentRow
            key={entry.row.id}
            entry={entry}
            pullRequest={agents.pullRequests.get(entry.row.id)}
            onOpenPullRequest={() => onOpenPullRequest(entry.row.id)}
          />
        ))}
      </List>
    </div>
  );
}
