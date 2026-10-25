import type { CatalogModel } from "@luke/features/models-wire";
import { TASK_ROW_MARK, taskRowMark } from "@luke/features/task-agents-model";
import type { TaskAgentLine, TaskPullRequestLine, TaskSummary } from "@luke/features/task-wire";
import type { Workspace } from "@luke/features/workspace-wire";
import {
  AVATAR_SIZE,
  Badge,
  CountParts,
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  HoverCardHead,
  HoverCardList,
  HoverCardRow,
  HoverCardRule,
  linesCount,
  TaskPriorityMark,
  TaskStatusMark as TaskStatusGlyph,
  TIME_LOOK,
  Time,
  VisuallyHidden,
} from "@luke/ui";
import { ACTOR_KIND, actorName, SOMEONE_REASON } from "@luke/ui/actor-model";
import { TASK_ORDER, taskTime } from "@luke/ui/task-list-model";
import { repositoryPageUrl } from "@luke/ui/tasks-model";
import { ACTOR_SIZE, ActorMark, UnassignedMark } from "../actor-ref.js";
import { AttentionMark } from "../attention-mark.js";
import { useCreator, useMemberDirectory, usePerson } from "../member-directory.js";
import { useActorDoor } from "../person-door.js";
import { RepositoryPicture } from "../repository-picture.js";
import { GLYPH_STATE, StateGlyph } from "../state-glyph.js";
import { WorkspaceDirectory } from "../tasks/chip-cards.js";
import { agentName, pullRequestNumberLabel } from "../tasks/coding-agent-model.js";
import { PullRequestMark } from "../tasks/pull-request-mark.js";
import { AgentGlyph, agentEndMark } from "../tasks/tab-look.js";
import {
  NO_ASSIGNEE_WORDS,
  TASK_PRIORITY_WORDS,
  TASK_STATUS_WORDS,
  TaskKey,
} from "../tasks/task-standing.js";
import { useOpenLink } from "../tasks/use-open-link.js";
import { useTaskMaker } from "../tasks/use-task-origin.js";
import { useTaskWork } from "../tasks/use-task-work.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { strandedHome } from "./move-task-dialog.js";
import { WorkspaceRef } from "./workspace-ref.js";

/**
 * task-card.tsx -- a sidebar task's agents at a glance: the one mark at its row's end, and the card its row hangs while the pointer rests on it.
 *
 * The mark is the working mark while an agent works on the task, drawn and
 * named as an agent's tab draws it (`state-glyph.tsx`), else the pull
 * request's mark (`pull-request-mark.tsx`), else nothing
 * (`task-agents-model.ts`). The card names the task, its repository, and
 * how long ago it was updated at its head, in a workspace others share who
 * created it, then a row for each of its
 * agents, drawn as its tab draws it: its harness's mark wearing where it
 * stands, its tab's label, and a failure's mark at its end, with no word for where it stands, since no
 * agent anywhere else in the window says one. Then a row for each of its
 * pull requests, its mark, and its size.
 * Each list names every one, scrolling past a few rows' height rather than
 * counting the rest. Everything is read from the task list and what the
 * window holds beside it (`use-task-work.ts`), so the card fetches nothing.
 *
 * Three of its lines are buttons, as a GitHub hover card's are: the
 * repository opens its page on GitHub, a pull request its agent's Pull
 * request tab where the window knows the agent and GitHub otherwise, and an agent
 * opens the task on its tab. Each is also offered where the card is not:
 * the task's menu opens the repository, and the agent's tab its pull
 * request. The rest are facts, left as text. Its rows are `@luke/ui`'s
 * `HoverCardRow`, set as a menu's rows are, and a pinned tab's card
 * (`sidebar-pinned-tab.tsx`) is drawn from the same rows
 * (`RepositoryDetail`, `PullRequestLine`).
 */

/**
 * The one mark at a task row's end, before its time: the attention mark on
 * a task whose repository belongs to another of the account's workspaces,
 * which its card names (`strandedHome`); else an agent at work, else its
 * pull request, else nothing.
 */
/**
 * A sidebar row's end: its repository where its group does not say it, its
 * face, its draft's pencil, its one mark, and its time, in the caption's
 * muted figures, ending on the time's last letter so times of any length
 * line up; each mark at the glyph's size a step before the next, so they
 * step out with the time while the row is hovered. A long repository is cut
 * short, so the row's own name keeps its room at the sidebar's least width;
 * the row's card names it whole.
 */
export const SIDEBAR_ROW_TIME =
  "sidebar-task-time flex flex-none items-center justify-end min-w-sidebar-row-time text-right text-caption-inline text-muted-foreground tabular-nums [&_.state-glyph]:mr-tight-gap [&_.state-glyph]:[--state-glyph-size:var(--spacing-luke-12)] [&>.actor-mark]:mr-tight-gap [&_.task-mark-glyph]:mr-tight-gap [&_.draft-mark]:mr-tight-gap [&_.draft-mark]:size-luke-12";

/** The repository a sidebar row names before its marks (`SIDEBAR_ROW_TIME`). */
export const SIDEBAR_ROW_REPOSITORY =
  "sidebar-task-repository mr-item-gap inline-block max-w-sidebar-row-repository overflow-hidden whitespace-nowrap text-muted-foreground";

/** A pull request's mark standing as a task's, at the glyph's size in the row's muted ink, its state's colour where it has one (`pull-request-mark.tsx`). */
export const TASK_MARK_GLYPH =
  "task-mark-glyph inline-block size-luke-12 flex-none text-muted-foreground";

export function TaskRowMark({
  task,
  stranded,
}: {
  task: TaskSummary;
  /** The workspace the task's repository belongs to, where the reader may move it there. */
  stranded?: Workspace | undefined;
}): React.JSX.Element | null {
  if (stranded !== undefined) {
    return (
      <span className="task-mark-attention mr-tight-gap [&_.attention-mark]:size-luke-12 [&_.attention-mark_svg]:size-attention-glyph-small">
        <AttentionMark />
        <VisuallyHidden>{`(repository belongs to ${stranded.name})`}</VisuallyHidden>
      </span>
    );
  }
  const mark = taskRowMark(task.agents);
  switch (mark.kind) {
    case TASK_ROW_MARK.WORKING:
      return <StateGlyph state={GLYPH_STATE.WORKING} />;
    case TASK_ROW_MARK.PULL_REQUEST:
      return <PullRequestMark pullRequest={mark.pullRequest} className={TASK_MARK_GLYPH} />;
    case TASK_ROW_MARK.NONE:
      return null;
  }
}

/** A repository's line under a card's name, its owner's picture before it, which opens it on GitHub. */
export function RepositoryDetail({
  repository,
  pictures,
  onOpenGitHub,
}: {
  repository: string;
  /** Whether owners' pictures are drawn at all: not in a fixture run. */
  pictures: boolean;
  onOpenGitHub: (url: string) => void;
}): React.JSX.Element {
  return (
    <HoverCardRow
      look={HOVER_CARD_ROW_LOOK.DETAIL}
      glyph={
        <RepositoryPicture repository={repository} pictures={pictures} size={AVATAR_SIZE.MARK} />
      }
      label={repository}
      onPress={() => onOpenGitHub(repositoryPageUrl(repository))}
    />
  );
}

/**
 * Who created the task, under its repository: their face and "Created by
 * Charles Pan · 3d ago", "Created by you", or a member who left saying so;
 * or, for a task Luke or an agent made, its square with the member's face on
 * its corner and "Created by Invite emails for you · from Teammate
 * invitations",
 * read against the members of the directory around the card, a press
 * opening their page where the window offers one.
 */
function CreatorDetail({
  task,
  readerId,
  now,
}: {
  task: TaskSummary;
  readerId: string | undefined;
  now: number;
}): React.JSX.Element {
  const creator = useCreator(task, readerId);
  const maker = useTaskMaker(task);
  // Note that the line opens the member it names, whoever made the task for them, since Luke and an agent have no page.
  const door = useActorDoor(creator);
  const left = creator.kind === ACTOR_KIND.SOMEONE && creator.reason === SOMEONE_REASON.FORMER;
  const by = `${actorName(creator, { sentence: true })}${left ? ", who left" : ""}`;
  return (
    <HoverCardRow
      look={HOVER_CARD_ROW_LOOK.DETAIL}
      glyph={
        <ActorMark
          actor={maker?.actor ?? creator}
          size={ACTOR_SIZE.MARK}
          forWhom={maker === undefined ? undefined : creator}
        />
      }
      label={
        <>
          {maker === undefined
            ? `Created by ${by} · `
            : `Created by ${actorName(maker.actor)} for ${by}${maker.fromTask === undefined ? "" : ` · from ${maker.fromTask}`} · `}
          <Time at={task.createdAt} now={now} hint={false} look={TIME_LOOK.AGO} />
        </>
      }
      onPress={door}
    />
  );
}

/** One agent's row, as its tab draws it (`main-tabs.tsx`): its harness's mark wearing where it stands (`AgentGlyph`), its tab's label, and a failure at its end (`agentEndMark`). */
export function AgentLine({
  agent,
  models,
  onShow,
}: {
  agent: TaskAgentLine;
  models: readonly CatalogModel[];
  onShow: () => void;
}): React.JSX.Element {
  return (
    <li data-task-card-agent="">
      <HoverCardRow
        glyph={<AgentGlyph agent={agent} />}
        label={agentName(agent, models)}
        end={agentEndMark(agent, false)}
        onPress={onShow}
      />
    </li>
  );
}

/**
 * One pull request's row: its glyph, which says where it stands, its
 * number muted before its title, and its size in green and red. It opens
 * the pull request as a link to its page does, where the service said its
 * page; a row from a service before it did is text.
 */
export function PullRequestLine({
  pullRequest,
}: {
  pullRequest: TaskPullRequestLine;
}): React.JSX.Element {
  // Its page opens as a link to it does: in its agent's Pull request tab where the place or the window knows the agent (`../tasks/use-open-link.ts`), else on GitHub.
  const openLink = useOpenLink();
  const { url } = pullRequest;
  return (
    <li data-task-card-pull-request="">
      <HoverCardRow
        glyph={<PullRequestMark pullRequest={pullRequest} className={TASK_MARK_GLYPH} />}
        label={
          <>
            <span className="task-card-number">{pullRequestNumberLabel(pullRequest)}</span>{" "}
            {pullRequest.title}
          </>
        }
        end={<CountParts parts={linesCount(pullRequest.additions, pullRequest.deletions)} />}
        onPress={url === undefined ? undefined : () => openLink(url)}
        linkHref={url}
      />
    </li>
  );
}

/**
 * The card a sidebar task hangs: its name, wrapped to two lines, and how
 * long ago it was updated at the head's right; its repository under the
 * name, and, where others share its workspace and the list names its
 * creator, who created it; then every one of its agents and its pull
 * requests, each list scrolling past a few rows' height. A card hung
 * from a place within the task, a section or a version a chip names
 * (`../tasks/chip-cards.tsx`), says that place on its own line in their
 * stead.
 */
export function TaskCard({
  task,
  models,
  pictures,
  now,
  onOpenGitHub,
  onShowAgent,
  stranded,
  shared,
  readerId,
  focus,
  workspaceName,
}: {
  task: TaskSummary;
  /** The name of the task's workspace, which its key is read under; none where the window holds no such workspace, and the card says no key. */
  workspaceName?: string | undefined;
  /** The place within the task the card is hung for, its glyph and its words, said under the head in the agents' and pull requests' stead. */
  focus?: { readonly glyph: React.ReactNode; readonly words: React.ReactNode } | undefined;
  /**
   * Whether others share the task's workspace, where the card says who
   * created it; unknown, it is whether the members read around the card
   * lists anyone else.
   */
  shared?: boolean | undefined;
  /** The reader's account id, which says "you" of their own task outside a member directory. */
  readerId?: string | undefined;
  /** The catalog as last read, which names each agent's model; empty before the first read. */
  models: readonly CatalogModel[];
  /** Whether owners' pictures are drawn at all: not in a fixture run. */
  pictures: boolean;
  /** The time the card's times are counted back from. */
  now: number;
  /** Opens a page on GitHub: the repository's, or a pull request's. */
  onOpenGitHub: (url: string) => void;
  /** Opens the task on one of its agents' tabs. */
  onShowAgent: (agentId: string) => void;
  /** The workspace the task's repository belongs to, where the reader may move it there, which the card names under the repository. */
  stranded?: Workspace | undefined;
}): React.JSX.Element {
  const { repository } = task;
  const { members } = useMemberDirectory();
  const { agents: agentRows, pullRequests: pullRequestRows } = useTaskWork(task);
  // Note that a task Luke or an agent made says so in a workspace of one too, where its member's own needs no saying.
  const creatorShown =
    (task.origin !== undefined || (shared ?? (members !== undefined && members.length > 1))) &&
    (task.createdBy !== undefined || task.ownerId !== undefined);
  return (
    <HoverCard data-task-card="">
      <TaskStanding task={task} workspaceName={workspaceName} />
      <HoverCardHead
        name={task.name}
        corner={<Time at={taskTime(task, TASK_ORDER.UPDATED)} now={now} hint={false} />}
      />
      {focus === undefined ? null : (
        <>
          <HoverCardRule />
          <div data-task-card-focus="">
            <HoverCardRow glyph={focus.glyph} label={focus.words} />
          </div>
        </>
      )}
      {focus !== undefined || agentRows.length === 0 ? null : (
        <>
          <HoverCardRule />
          <HoverCardList label="Agents">
            {agentRows.map((agent) => (
              <AgentLine
                key={agent.id}
                agent={agent}
                models={models}
                onShow={() => onShowAgent(agent.id)}
              />
            ))}
          </HoverCardList>
        </>
      )}
      {focus !== undefined || pullRequestRows.length === 0 ? null : (
        <>
          <HoverCardRule />
          <HoverCardList label="Pull requests">
            {pullRequestRows.map((pullRequest) => (
              <PullRequestLine
                key={pullRequest.url ?? pullRequest.number}
                pullRequest={pullRequest}
              />
            ))}
          </HoverCardList>
        </>
      )}
      {/* Where the task lives and who made it stand at the card's foot, under what is moving on it. */}
      {repository === null && !creatorShown && stranded === undefined ? null : (
        <>
          {focus !== undefined || agentRows.length > 0 || pullRequestRows.length > 0 ? (
            <HoverCardRule />
          ) : null}
          {repository === null ? null : (
            <RepositoryDetail
              repository={repository}
              pictures={pictures}
              onOpenGitHub={onOpenGitHub}
            />
          )}
          {creatorShown ? <CreatorDetail task={task} readerId={readerId} now={now} /> : null}
          {stranded === undefined ? null : (
            <HoverCardRow
              look={HOVER_CARD_ROW_LOOK.DETAIL}
              glyph={<AttentionMark />}
              label={
                <>
                  Repository belongs to <WorkspaceRef workspace={stranded} />
                </>
              }
            />
          )}
        </>
      )}
    </HoverCard>
  );
}

/**
 * Where a task stands, as its card leads with it: its key in plain words, as
 * every place draws it (`TaskKey`), then its status and its priority, each a
 * small chip of its mark and its words; none it has not got, as a task from
 * a service before keys, statuses, or priorities. Then who is on it, their
 * face and name, or the dashed unassigned mark and No assignee, as the
 * task's page's chip says it; the card only says, so it is no picker.
 */
function TaskStanding({
  task,
  workspaceName,
}: {
  task: TaskSummary;
  workspaceName: string | undefined;
}): React.JSX.Element | null {
  const keyed = task.number !== undefined && workspaceName !== undefined;
  // Note that a task with nothing else to stand on and no one on it, as one from a service before keys, says nothing, rather than No assignee alone.
  const bare = task.status === undefined && task.priority === undefined;
  if (!keyed && bare && task.assignee === undefined) return null;
  return (
    <div className="task-card-standing">
      <TaskKey workspaceName={workspaceName} number={task.number} />
      {task.status === undefined ? null : (
        <Badge icon={<TaskStatusGlyph status={task.status} />}>
          {TASK_STATUS_WORDS[task.status]}
        </Badge>
      )}
      {task.priority === undefined ? null : (
        <Badge icon={<TaskPriorityMark priority={task.priority} />}>
          {TASK_PRIORITY_WORDS[task.priority]}
        </Badge>
      )}
      <AssigneeChip assignee={task.assignee} />
    </div>
  );
}

/** Who a task's card says is on it: the assignee's face and name, read against the members around the card, or the dashed unassigned mark and No assignee. */
function AssigneeChip({ assignee }: { assignee: TaskSummary["assignee"] }): React.JSX.Element {
  const person = usePerson(assignee);
  return (
    <Badge
      icon={
        assignee === undefined ? (
          <UnassignedMark size={ACTOR_SIZE.MARK} decorative />
        ) : (
          <ActorMark actor={person} size={ACTOR_SIZE.MARK} />
        )
      }
    >
      {assignee === undefined ? NO_ASSIGNEE_WORDS : assignee.name}
    </Badge>
  );
}

/** Whether others share a plan's workspace, as the service counts its members; unknown from a service that counts none. */
function sharedWorkspace(
  tasks: Pick<TasksControl, "workspaces">,
  task: Pick<TaskSummary, "workspaceId">,
): boolean | undefined {
  const count = tasks.workspaces.find((each) => each.id === task.workspaceId)?.memberCount;
  return count === undefined ? undefined : count > 1;
}

/**
 * The task's card as every place naming the task hangs it, read from the
 * window's tasks: its sidebar row, its tab in its own column, and the
 * Inbox's crumb. An agent's line opens the task on that agent's tab.
 */
export function taskCardOf(
  tasks: Pick<TasksControl, "repositories" | "onShowAgent" | "me" | "workspaces"> & {
    readonly agents: Pick<TasksControl["agents"], "models">;
  },
  task: TaskSummary,
  now: number,
  focus?: React.ComponentProps<typeof TaskCard>["focus"],
): React.JSX.Element {
  return (
    <TaskCard
      task={task}
      focus={focus}
      stranded={strandedHome(tasks, task)}
      shared={sharedWorkspace(tasks, task)}
      readerId={tasks.me}
      workspaceName={tasks.workspaces.find((each) => each.id === task.workspaceId)?.name}
      models={tasks.agents.models ?? []}
      pictures={tasks.repositories.pictures}
      now={now}
      onOpenGitHub={tasks.repositories.openGitHub}
      onShowAgent={(agentId) => tasks.onShowAgent(task.id, agentId)}
    />
  );
}

/**
 * The task's card as a place standing in any workspace hangs it, a chip or
 * a ⌘K row: `taskCardOf`'s, naming its creator as the task's own workspace
 * holds them, whatever workspace the place stands in.
 */
export function homeTaskCardOf(
  tasks: Parameters<typeof taskCardOf>[0],
  task: TaskSummary,
  now: number,
  focus?: React.ComponentProps<typeof TaskCard>["focus"],
): React.JSX.Element {
  const home = tasks.workspaces.find((each) => each.id === task.workspaceId);
  const card = taskCardOf(tasks, task, now, focus);
  return home === undefined ? (
    card
  ) : (
    <WorkspaceDirectory workspace={home}>{card}</WorkspaceDirectory>
  );
}
