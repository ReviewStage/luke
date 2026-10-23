import { CHECK_SUMMARY, type CheckSummary } from "@luke/features/coding-agent-wire";
import type { TaskAgentLine, TaskPullRequestLine } from "@luke/features/task-wire";
import { HoverCard, HoverCardHead, HoverCardList, HoverCardNote } from "@luke/ui";
import { LinesChanged } from "../tasks/agent-published.js";
import { pullRequestNumberLabel, pullRequestStateLabel } from "../tasks/coding-agent-model.js";
import { PullRequestMark } from "../tasks/pull-request-mark.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { AgentLine, PullRequestLine } from "./task-card.js";

/**
 * task-part-cards.tsx -- the cards a task's List row and Board card hang on their parts, rather than one card for the whole task: a pull request's, the pull requests its marks leave out, and its agents at work.
 *
 * A row or a card already says what the task's own card would, so the
 * pointer resting on one of its parts says more about that part alone, as
 * Linear's board does: a pull request's mark hangs that pull request, its
 * title, where it stands, its checks, and its size; the count after the
 * marks hangs the pull requests it counts; and the working mark hangs the
 * task's agents, each a row that opens the task on its tab. A card names
 * every one, scrolling past a few rather than counting the rest, read from
 * what the window holds beside the task list (`use-task-work.ts`), so a
 * card fetches nothing.
 */

/** What a pull request's card says of its checks; nothing where it has none. */
const CHECKS_WORDS = {
  [CHECK_SUMMARY.PASSING]: "Checks passing",
  [CHECK_SUMMARY.PENDING]: "Checks running",
  [CHECK_SUMMARY.FAILING]: "Checks failing",
  [CHECK_SUMMARY.NONE]: undefined,
} as const satisfies Record<CheckSummary, string | undefined>;

/** The repository a pull request's GitHub address names, `owner/name`; none for a line from a service before it sent one. */
const PULL_REQUEST_REPOSITORY = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\//u;

/** A pull request's key as its card's head says it: `owner/name#42` where its address names its repository, else `#42`. */
function pullRequestKey(pullRequest: TaskPullRequestLine): string {
  const repository = pullRequest.url?.match(PULL_REQUEST_REPOSITORY)?.[1];
  return `${repository ?? ""}${pullRequestNumberLabel(pullRequest)}`;
}

/** One pull request's card: its mark and title, its key and where it stands under them, then its checks and the lines it adds and removes. */
export function PullRequestCard({
  pullRequest,
}: {
  pullRequest: TaskPullRequestLine;
}): React.JSX.Element {
  const checks = CHECKS_WORDS[pullRequest.checks];
  return (
    <HoverCard data-pull-request-card="">
      <HoverCardHead
        glyph={<PullRequestMark pullRequest={pullRequest} className="task-mark-glyph" />}
        name={pullRequest.title}
        sub={`${pullRequestKey(pullRequest)} · ${pullRequestStateLabel(pullRequest)}`}
      />
      <HoverCardNote>
        {checks === undefined ? null : `${checks} · `}
        <LinesChanged additions={pullRequest.additions} deletions={pullRequest.deletions} />
      </HoverCardNote>
    </HoverCard>
  );
}

/** The card a count of pull requests hangs: a row for each it counts, every one, scrolling past a few. */
export function MorePullRequestsCard({
  pullRequests,
}: {
  pullRequests: readonly TaskPullRequestLine[];
}): React.JSX.Element {
  return (
    <HoverCard data-more-pull-requests-card="">
      <HoverCardList label="Pull requests">
        {pullRequests.map((pullRequest) => (
          <PullRequestLine key={pullRequest.url ?? pullRequest.number} pullRequest={pullRequest} />
        ))}
      </HoverCardList>
    </HoverCard>
  );
}

/** The card the working mark hangs: a row for each of the task's agents, every one, scrolling past a few, each opening the task on its tab. */
export function TaskAgentsCard({
  taskId,
  agents,
  tasks,
}: {
  taskId: string;
  agents: readonly TaskAgentLine[];
  tasks: Pick<TasksControl, "onShowAgent"> & {
    readonly agents: Pick<TasksControl["agents"], "models">;
  };
}): React.JSX.Element {
  return (
    <HoverCard data-task-agents-card="">
      <HoverCardList label="Agents">
        {agents.map((agent) => (
          <AgentLine
            key={agent.id}
            agent={agent}
            models={tasks.agents.models ?? []}
            onShow={() => tasks.onShowAgent(taskId, agent.id)}
          />
        ))}
      </HoverCardList>
    </HoverCard>
  );
}
