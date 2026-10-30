import type { AgentPullRequest } from "@luke/features/agent-wire";
import { LIST_VARIANT, List, ListRow, RowHint, RowHintOptions } from "@luke/ui";
import { sameTab } from "@luke/ui/tab-strip-model";
import { agentStillWriting } from "../tasks/agent-model.js";
import { agentSubject } from "../tasks/agent-ref.js";
import { PullRequestCard, peopleOf } from "../tasks/pull-request-card.js";
import { PullRequestChip } from "../tasks/pull-request-chip.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import { openerOf } from "../tasks/use-link-standing.js";
import type { MainTabsControl } from "../tasks/use-main-tabs.js";
import { SUMMARY_GLYPH } from "./agent-archive.js";
import { agentEntries } from "./main-tabs.js";
import type { AddEntry, HeldTranscripts } from "./strip-tabs.js";

/**
 * plan-agents.tsx -- the open task's agents at the head of its plan: one row each, its tab's glyph and name, its failure where it failed, and its pull request.
 *
 * Each row is the task's agent as its "+" row and the summary draw it
 * (`agentEntries`): its tab's glyph, which gives way to the working mark
 * while it works, its tab's name, the failed mark at its end once its turn
 * failed, and the card its tab hangs. Its pull request, where it opened
 * one, stands after it as a chip of GitHub's mark in GitHub's colour for
 * where it stands and its number (`pull-request-chip.tsx`), hanging the
 * pull request's one card as its Pull request tab does, the agent whose it
 * is and who it names among what the card says (`pull-request-card.tsx`).
 * A row opens its agent as its tab's own press does,
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

/** One agent's row: its tab's look, its failed mark, and its pull request's chip where it opened one. */
function PlanAgentRow({
  entry,
  pullRequest,
  agents,
  held,
  main,
  onOpenPullRequest,
}: {
  entry: AddEntry;
  pullRequest: AgentPullRequest | undefined;
  agents: AgentsControl;
  held: HeldTranscripts;
  main: Pick<MainTabsControl, "tab" | "onChoose">;
  onOpenPullRequest: () => void;
}): React.JSX.Element {
  const { row, endMark, card } = entry;
  const agentId = row.id;
  const chosen = main.tab !== undefined && sameTab({ agent: agentId }, main.tab);
  const people =
    pullRequest === undefined
      ? undefined
      : peopleOf(agents.changesPeople.get(agentId), pullRequest);
  return (
    <RowHintOptions card={card}>
      <ListRow
        motionKey={row.id}
        leading={<span className={SUMMARY_GLYPH}>{row.icon}</span>}
        title={row.label}
        hint={card === undefined ? undefined : { Hint: RowHint, label: row.label }}
        meta={endMark}
        actions={
          pullRequest === undefined ? undefined : (
            <PullRequestChip
              pullRequest={pullRequest}
              card={
                <PullRequestCard
                  pullRequest={pullRequest}
                  lines={pullRequest}
                  files={pullRequest.changedFiles}
                  opener={people?.author ?? openerOf(pullRequest)}
                  agent={{
                    subject: agentSubject(agents, agentId, held, chosen),
                    models: agents.models,
                    onOpen: entry.onPick,
                  }}
                  reviewers={people?.reviewers}
                />
              }
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
  agents: AgentsControl;
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
            agents={agents}
            held={held}
            main={main}
            onOpenPullRequest={() => onOpenPullRequest(entry.row.id)}
          />
        ))}
      </List>
    </div>
  );
}
