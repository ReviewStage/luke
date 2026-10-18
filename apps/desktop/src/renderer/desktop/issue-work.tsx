import { PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import type { Issue } from "@luke/features/issue-wire";
import type { TaskPullRequestLine, TaskSummary } from "@luke/features/task-wire";
import { ComposeIcon, DocumentIcon, INLINE_REF_LOOK } from "@luke/ui";
import { BotIcon } from "lucide-react";
import { createContext, useContext } from "react";
import { InlineRef } from "../inline-ref";
import { pullRequestNumberLabel } from "../tasks/coding-agent-model";
import { PullRequestMark } from "../tasks/pull-request-mark";
import type { MenuAction } from "./action-menu";

/**
 * issue-work.tsx -- the work an issue is taken up in: its Start task…, and the tasks started from it, as its page lists them.
 *
 * Start task… opens New task on the issue, named by its title and in its
 * workspace, and the task it starts is linked to the issue
 * (`new-task-dialog.tsx`); Start agent… opens the same card as a new
 * agent's, which starts the task without planning and an agent on it at
 * once, and the service moves the issue into progress as that agent starts. The issue's page lists the tasks of the listed
 * workspace started from it, archived ones among them, newest started first
 * whatever the sidebar's pins put first, each a chip that opens
 * its task; an issue no task was started from lists none and draws no row.
 * Beside each task stand its pull requests as Factory draws them, each a
 * mark for where it stands and its number, opening where Factory's row
 * opens it, the ones the task list did not carry counted in a pill that
 * opens the task, and the issue's card draws the one that matters most
 * after its priority, as a task's sidebar mark picks it. The Issues page hands these doors down once, so a card's menu, a row's,
 * and the issue's own page offer the same ones.
 */

/** What the Issues page hands its cards, rows, and issue page to take an issue up in a task. */
export interface IssueWork {
  /** Opens New task on the issue, which the task it starts is linked to; with `agent`, a new agent's card, which starts an agent on that task at once. */
  readonly onStartTask: (issue: Issue, identifier: string, agent?: boolean) => void;
  /** The listed tasks started from the issue, newest started first. */
  readonly tasksOf: (issueId: string) => readonly TaskSummary[];
  /** Opens a task. */
  readonly onOpenTask: (taskId: string) => void;
  /** Opens one of a task's pull requests where Factory's row opens it: its agent's Pull request tab, else GitHub, else the task. */
  readonly onOpenPullRequest: (task: TaskSummary, pullRequest: TaskPullRequestLine) => void;
}

const IssueWorkContext = createContext<IssueWork | undefined>(undefined);

/** Hands the Issues page's doors to every card, row, and issue page under it. */
export const IssueWorkProvider = IssueWorkContext.Provider;

/** The pull request states still to be acted on, which a card's mark is drawn for first. */
const STANDING_STATES: ReadonlySet<TaskPullRequestLine["state"]> = new Set([
  PULL_REQUEST_STATE.OPEN,
  PULL_REQUEST_STATE.DRAFT,
]);

/**
 * The pull request that matters most of the tasks started from the issue,
 * as a task's sidebar mark picks one (`task-agents-model.ts`): one still
 * open or a draft first, else a merged one, else a closed one, the newest
 * task's first within each. The service lists each task's still-open ones
 * first, so the one picked is always among those it carries.
 */
function leadPullRequest(tasks: readonly TaskSummary[]): TaskPullRequestLine | undefined {
  const all = tasks.flatMap((task) => task.agents?.pullRequests ?? []);
  return (
    all.find((each) => STANDING_STATES.has(each.state)) ??
    all.find((each) => each.state === PULL_REQUEST_STATE.MERGED) ??
    all[0]
  );
}

/** How many of a task's pull requests the list did not carry, which open with the task; nothing where it carried each. */
function MorePullRequests({
  task,
  onOpen,
}: {
  task: TaskSummary;
  onOpen: () => void;
}): React.JSX.Element | null {
  const more = (task.agents?.pullRequestTotal ?? 0) - (task.agents?.pullRequests.length ?? 0);
  if (more <= 0) return null;
  return (
    <InlineRef
      look={INLINE_REF_LOOK.PILL}
      label={`${more} more`}
      pressLabel={`Open ${task.name} for ${more} more pull requests`}
      onPress={onOpen}
    />
  );
}

/** Start task… and Start agent… for the issue, where the page offers them; none outside the Issues page. */
export function useStartItems(issue: Issue, identifier: string): MenuAction[] {
  const work = useContext(IssueWorkContext);
  if (work === undefined) return [];
  return [
    {
      label: "Start task…",
      icon: <ComposeIcon />,
      onSelect: () => work.onStartTask(issue, identifier),
    },
    {
      label: "Start agent…",
      icon: <BotIcon />,
      onSelect: () => work.onStartTask(issue, identifier, true),
    },
  ];
}

/** The tasks started from the issue, each a chip that opens it, under its status and priority; nothing while none was. */
export function IssueWorkRow({ issue }: { issue: Issue }): React.JSX.Element | null {
  const work = useContext(IssueWorkContext);
  const tasks = work?.tasksOf(issue.id) ?? [];
  if (work === undefined || tasks.length === 0) return null;
  return (
    <section className="issue-work" aria-label="Tasks">
      <span className="issue-work-label">Tasks</span>
      {tasks.map((task) => (
        <span key={task.id} className="issue-work-task">
          <InlineRef
            look={INLINE_REF_LOOK.PILL}
            glyph={<DocumentIcon />}
            label={task.name}
            pressLabel={`Open ${task.name}`}
            onPress={() => work.onOpenTask(task.id)}
          />
          {(task.agents?.pullRequests ?? []).map((pullRequest) => (
            <InlineRef
              key={pullRequest.number}
              look={INLINE_REF_LOOK.PILL}
              glyph={<PullRequestMark pullRequest={pullRequest} />}
              label={pullRequestNumberLabel(pullRequest)}
              pressLabel={`Open pull request ${pullRequestNumberLabel(pullRequest)}, ${pullRequest.title}`}
              onPress={() => work.onOpenPullRequest(task, pullRequest)}
              data-pull-request-state={pullRequest.state}
            />
          ))}
          <MorePullRequests task={task} onOpen={() => work.onOpenTask(task.id)} />
        </span>
      ))}
    </section>
  );
}

/**
 * The pull request that matters most of the tasks started from the issue,
 * as its card draws it after its priority: its mark for where it stands and
 * its number, and how many more stand beside it where any do; nothing while
 * none was opened.
 */
export function IssueCardPullRequest({ issue }: { issue: Issue }): React.JSX.Element | null {
  const work = useContext(IssueWorkContext);
  const tasks = work?.tasksOf(issue.id) ?? [];
  const lead = leadPullRequest(tasks);
  if (lead === undefined) return null;
  const total = tasks.reduce((sum, task) => sum + (task.agents?.pullRequestTotal ?? 0), 0);
  const more = total - 1;
  return (
    <span className="issue-card-pull-request" data-pull-request-state={lead.state}>
      <PullRequestMark pullRequest={lead} />
      <span>{pullRequestNumberLabel(lead)}</span>
      {more > 0 ? <span className="issue-card-pull-request-more">{`+${more}`}</span> : null}
    </span>
  );
}
