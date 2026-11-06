import type { CatalogModel } from "@repo/features/models-wire";
import type { TaskAgentLine, TaskPullRequestLine, TaskSummary } from "@repo/features/task-wire";
import type { Workspace } from "@repo/features/workspace-wire";
import {
  AttentionMark,
  AVATAR_SIZE,
  BLOCKED_WORDS,
  BlockedMark,
  CountParts,
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  HoverCardHead,
  HoverCardList,
  HoverCardRow,
  HoverCardRule,
  linesCount,
  ProgressCount,
  RepositoryPicture,
  TaskAgentsMark,
  TaskPriorityMark,
  TaskStatusMark,
  TIME_LOOK,
  Time,
  Tooltip,
} from "@repo/ui";
import { ACTOR_KIND, actorName, SOMEONE_REASON } from "@repo/ui/actor-model";
import { GLYPH } from "@repo/ui/icons";
import { subTaskCount, subTasksOf, TASK_ORDER, taskTime } from "@repo/ui/task-list-model";
import { repositoryPageUrl } from "@repo/ui/tasks-model";
import { ACTOR_SIZE, ActorMark, actorCard, UnassignedMark } from "../actor-ref.js";
import { useCreator, useMemberDirectory, usePerson } from "../member-directory.js";
import { useActorDoor } from "../person-door.js";
import { agentName, pullRequestNumberLabel } from "../tasks/agent-model.js";
import { WorkspaceDirectory } from "../tasks/chip-cards.js";
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
import { priorityOf, statusOf } from "./task-row-parts.js";
import { WorkspaceRef } from "./workspace-ref.js";

export const SIDEBAR_ROW_TIME =
  "sidebar-task-time flex flex-none items-center justify-end text-right text-caption-inline text-muted-foreground tabular-nums [&>.actor-mark]:mr-tight-gap [&_.task-agents-mark]:mr-tight-gap [&_.draft-mark]:mr-tight-gap [&_.draft-mark]:size-ui-12 [&_.blocked-mark]:mr-tight-gap [&_.blocked-mark]:size-ui-12 [&>.failed-mark]:mr-tight-gap [&>.failed-mark]:size-ui-12 [&_.ui-progress-count]:mr-icon-gap [&>.ui-time]:min-w-sidebar-row-age";

export const SIDEBAR_ROW_REPOSITORY =
  "sidebar-task-repository mr-item-gap inline-flex min-w-0 max-w-sidebar-row-repository overflow-hidden whitespace-nowrap text-muted-foreground";

export const TASK_MARK_GLYPH =
  "task-mark-glyph inline-block size-ui-12 flex-none text-muted-foreground";

export function TaskRowStatus({ task }: { task: TaskSummary }): React.JSX.Element | null {
  return <TaskAgentsMark agents={task.agents} />;
}

export function RepositoryDetail({
  repository,
  pictures,
  onOpenGitHub,
}: {
  repository: string;
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

function CreatorDetail({
  task,
  readerId,
  now,
}: {
  task: TaskSummary;
  readerId: string | undefined;
  now: number | undefined;
}): React.JSX.Element {
  const creator = useCreator(task, readerId);
  const maker = useTaskMaker(task);
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
          <Time at={task.createdAt} now={now} hint={false} look={TIME_LOOK.PROVENANCE} />
        </>
      }
      onPress={door}
    />
  );
}

function AgentLine({
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

export function PullRequestLine({
  pullRequest,
}: {
  pullRequest: TaskPullRequestLine;
}): React.JSX.Element {
  const openLink = useOpenLink();
  const { url } = pullRequest;
  return (
    <li data-task-card-pull-request="">
      <HoverCardRow
        glyph={<PullRequestMark pullRequest={pullRequest} className={TASK_MARK_GLYPH} />}
        label={
          <>
            <span className="task-card-number text-muted-foreground tabular-nums">
              {pullRequestNumberLabel(pullRequest)}
            </span>{" "}
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

const NO_TASKS: readonly TaskSummary[] = [];

function RelatedTaskLine({
  task,
  workspaceName,
  prefix,
  onOpen,
}: {
  task: TaskSummary;
  workspaceName: string | undefined;
  prefix?: string | undefined;
  onOpen: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <HoverCardRow
      glyph={<TaskStatusMark status={statusOf(task)} />}
      label={
        <>
          {prefix === undefined ? null : <span className="text-muted-foreground">{prefix} </span>}
          {task.name}
        </>
      }
      end={<TaskKey workspaceName={workspaceName} number={task.number} />}
      onPress={onOpen}
    />
  );
}

function TaskRelations({
  task,
  parent,
  subTasks,
  workspaceName,
  onOpenTask,
}: {
  task: TaskSummary;
  parent: TaskSummary | undefined;
  subTasks: readonly TaskSummary[];
  workspaceName: string | undefined;
  onOpenTask: ((taskId: string) => void) | undefined;
}): React.JSX.Element {
  const count = subTaskCount(subTasks);
  return (
    <>
      {parent === undefined ? null : (
        <div data-task-card-parent="">
          <RelatedTaskLine
            task={parent}
            workspaceName={workspaceName}
            prefix="Part of"
            onOpen={onOpenTask === undefined ? undefined : () => onOpenTask(parent.id)}
          />
        </div>
      )}
      {subTasks.length === 0 ? null : (
        <>
          <HoverCardRow
            glyph={<GLYPH.SUB_TASK />}
            label="Sub-tasks"
            end={
              <ProgressCount
                done={count.finished}
                total={count.total}
                label={`${count.finished} of ${count.total} sub-tasks finished`}
              />
            }
          />
          <HoverCardList label="Sub-tasks">
            {subTasks.map((subTask) => (
              <li key={subTask.id} data-task-card-sub-task="">
                <RelatedTaskLine
                  task={subTask}
                  workspaceName={workspaceName}
                  onOpen={onOpenTask === undefined ? undefined : () => onOpenTask(subTask.id)}
                />
              </li>
            ))}
          </HoverCardList>
        </>
      )}
      {task.blocked === true ? (
        <div data-task-card-blocked="">
          <HoverCardRow
            look={HOVER_CARD_ROW_LOOK.DETAIL}
            glyph={<BlockedMark aria-hidden="true" />}
            label={BLOCKED_WORDS}
          />
        </div>
      ) : null}
    </>
  );
}

export function TaskCard({
  task,
  models,
  now,
  onShowAgent,
  stranded,
  shared,
  readerId,
  focus,
  workspaceName,
  related = NO_TASKS,
  onOpenTask,
}: {
  task: TaskSummary;
  workspaceName?: string | undefined;
  focus?: { readonly glyph: React.ReactNode; readonly words: React.ReactNode } | undefined;
  shared?: boolean | undefined;
  readerId?: string | undefined;
  models: readonly CatalogModel[];
  now: number | undefined;
  onShowAgent: (agentId: string) => void;
  related?: readonly TaskSummary[];
  onOpenTask?: ((taskId: string) => void) | undefined;
  stranded?: Workspace | undefined;
}): React.JSX.Element {
  const { members } = useMemberDirectory();
  const { agents: agentRows, pullRequests: pullRequestRows } = useTaskWork(task);
  const parent =
    task.parentTaskId === undefined || task.parentTaskId === task.id
      ? undefined
      : related.find((each) => each.id === task.parentTaskId);
  const subTasks = subTasksOf(related, task.id);
  const placed = parent !== undefined || subTasks.length > 0 || task.blocked === true;
  const creatorShown =
    (task.origin !== undefined || (shared ?? (members !== undefined && members.length > 1))) &&
    (task.createdBy !== undefined || task.ownerId !== undefined);
  return (
    <HoverCard data-task-card="">
      <HoverCardHead
        glyph={
          <StandingMark words={`Status: ${TASK_STATUS_WORDS[statusOf(task)]}`}>
            <TaskStatusMark status={statusOf(task)} />
          </StandingMark>
        }
        name={task.name}
        sub={<TaskSub task={task} workspaceName={workspaceName} now={now} />}
        corner={<TaskMarks task={task} />}
      />
      {focus === undefined ? null : (
        <>
          <HoverCardRule />
          <div data-task-card-focus="">
            <HoverCardRow glyph={focus.glyph} label={focus.words} />
          </div>
        </>
      )}
      {focus !== undefined || !placed ? null : (
        <>
          <HoverCardRule />
          <TaskRelations
            task={task}
            parent={parent}
            subTasks={subTasks}
            workspaceName={workspaceName}
            onOpenTask={onOpenTask}
          />
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
      {!creatorShown && stranded === undefined ? null : (
        <>
          {focus !== undefined || placed || agentRows.length > 0 || pullRequestRows.length > 0 ? (
            <HoverCardRule />
          ) : null}
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

function StandingMark({
  words,
  card,
  children,
}: {
  words: string;
  card?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip label={words} card={card}>
      <span
        className="task-card-mark inline-flex flex-none items-center justify-center [&>svg]:size-hover-card-glyph"
        role="img"
        aria-label={words}
      >
        {children}
      </span>
    </Tooltip>
  );
}

function TaskSub({
  task,
  workspaceName,
  now,
}: {
  task: TaskSummary;
  workspaceName: string | undefined;
  now: number | undefined;
}): React.JSX.Element {
  const keyed = task.number !== undefined && workspaceName !== undefined;
  return (
    <span>
      {keyed ? (
        <>
          <TaskKey workspaceName={workspaceName} number={task.number} />
          {" · "}
        </>
      ) : null}
      {task.repository === null ? null : `${task.repository} · `}
      <Time at={taskTime(task, TASK_ORDER.UPDATED)} now={now} hint={false} />
    </span>
  );
}

function TaskMarks({ task }: { task: TaskSummary }): React.JSX.Element {
  const person = usePerson(task.assignee);
  const priority = priorityOf(task);
  return (
    <span className="task-card-marks inline-flex items-center gap-tight-gap">
      <StandingMark words={`Priority: ${TASK_PRIORITY_WORDS[priority]}`}>
        <TaskPriorityMark priority={priority} />
      </StandingMark>
      <StandingMark
        words={`Assignee: ${task.assignee?.name ?? NO_ASSIGNEE_WORDS}`}
        card={task.assignee === undefined ? undefined : actorCard(person)}
      >
        {task.assignee === undefined ? (
          <UnassignedMark size={ACTOR_SIZE.MARK} decorative />
        ) : (
          <ActorMark actor={person} size={ACTOR_SIZE.MARK} />
        )}
      </StandingMark>
    </span>
  );
}

function sharedWorkspace(
  tasks: Pick<TasksControl, "workspaces">,
  task: Pick<TaskSummary, "workspaceId">,
): boolean | undefined {
  const count = tasks.workspaces.find((each) => each.id === task.workspaceId)?.memberCount;
  return count === undefined ? undefined : count > 1;
}

export function taskCardOf(
  tasks: Pick<
    TasksControl,
    "repositories" | "onShowAgent" | "onSelect" | "me" | "workspaces" | "tasks"
  > & {
    readonly agents: Pick<TasksControl["agents"], "models">;
  },
  task: TaskSummary,
  now: number | undefined,
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
      now={now}
      onShowAgent={(agentId) => tasks.onShowAgent(task.id, agentId)}
      related={tasks.tasks}
      onOpenTask={tasks.onSelect}
    />
  );
}

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
