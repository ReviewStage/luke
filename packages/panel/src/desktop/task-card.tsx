import type { CatalogModel } from "@luke/features/models-wire";
import type { TaskAgentLine, TaskPullRequestLine, TaskSummary } from "@luke/features/task-wire";
import type { Workspace } from "@luke/features/workspace-wire";
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
  TaskAgentsMark,
  TaskPriorityMark,
  TaskStatusMark,
  TIME_LOOK,
  Time,
  Tooltip,
} from "@luke/ui";
import { ACTOR_KIND, actorName, SOMEONE_REASON } from "@luke/ui/actor-model";
import { GLYPH } from "@luke/ui/icons";
import { subTaskCount, subTasksOf, TASK_ORDER, taskTime } from "@luke/ui/task-list-model";
import { repositoryPageUrl } from "@luke/ui/tasks-model";
import { ACTOR_SIZE, ActorMark, actorCard, UnassignedMark } from "../actor-ref.js";
import { useCreator, useMemberDirectory, usePerson } from "../member-directory.js";
import { useActorDoor } from "../person-door.js";
import { RepositoryPicture } from "../repository-picture.js";
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

/**
 * task-card.tsx -- a sidebar task's agents at a glance: the one icon at its row's end, and the card its row hangs while the pointer rests on it.
 *
 * The icon is how the task's agents stand, most pressing first: a question
 * waiting on the reader, a failure, an agent at work, or the pull request
 * they left, in `@luke/ui`'s `TaskAgentsMark` (`task-agents-model.ts`). The card leads, as the
 * task board's card does, with its status's mark and its name, its key, its
 * repository, and how long ago it was updated under the name, and its
 * priority's mark and its assignee's face in the corner, icons alone, each
 * saying its words to a screen reader and to a pointer resting on it; it
 * only says where the task stands, so none of them is a picker. Then where it
 * stands among other tasks (`TaskRelations`): the task it is part of, its
 * sub-tasks, and that it is blocked. Then a row for each of its
 * agents, drawn as its tab draws it: its harness's mark wearing where it
 * stands, its tab's label, and a failure's mark at its end, with no word for where it stands, since no
 * agent anywhere else in the window says one. Then a row for each of its
 * pull requests, its mark, and its size, and at its foot, in a workspace
 * others share, who created it, and where its repository belongs to
 * another of the reader's workspaces, that workspace.
 * Each list names every one, scrolling past a few rows' height rather than
 * counting the rest. Everything is read from the task list and what the
 * window holds beside it (`use-task-work.ts`), so the card fetches nothing.
 *
 * Its list rows are buttons, as a GitHub hover card's are: a pull request
 * opens its agent's Pull request tab where the window knows the agent and
 * GitHub otherwise, and an agent opens the task on its tab; the creator's
 * line opens their page where the window offers one. The rest are facts,
 * left as text, the repository among them, which the task's menu opens. Its rows are `@luke/ui`'s
 * `HoverCardRow`, set as a menu's rows are, and a pinned tab's card
 * (`sidebar-pinned-tab.tsx`) is drawn from the same rows
 * (`RepositoryDetail`, `PullRequestLine`).
 */

/**
 * A sidebar row's end: its repository where its group does not say it, its
 * face, its draft's pencil, its one icon, and its time, in the caption's
 * muted figures, ending on the time's last letter so times of any length
 * line up; each mark at the glyph's size a step before the next, so they
 * step out with the time while the row is hovered. A long repository is cut
 * short, so the row's own name keeps its room at the sidebar's least width;
 * the row's card names it whole.
 */
export const SIDEBAR_ROW_TIME =
  "sidebar-task-time flex flex-none items-center justify-end min-w-sidebar-row-time text-right text-caption-inline text-muted-foreground tabular-nums [&_.state-glyph]:mr-tight-gap [&_.state-glyph]:[--state-glyph-size:var(--spacing-luke-12)] [&>.actor-mark]:mr-tight-gap [&_.task-agents-mark]:mr-tight-gap [&_.draft-mark]:mr-tight-gap [&_.draft-mark]:size-luke-12 [&_.blocked-mark]:mr-tight-gap [&_.blocked-mark]:size-luke-12";

/** The repository a sidebar row names before its marks (`SIDEBAR_ROW_TIME`). */
export const SIDEBAR_ROW_REPOSITORY =
  "sidebar-task-repository mr-item-gap inline-block max-w-sidebar-row-repository overflow-hidden whitespace-nowrap text-muted-foreground";

/** A pull request's mark on a card's row, at the glyph's size in the row's muted ink, its state's colour where it has one (`pull-request-mark.tsx`). */
export const TASK_MARK_GLYPH =
  "task-mark-glyph inline-block size-luke-12 flex-none text-muted-foreground";

/**
 * The one icon at a task row's end, before its time: how its agents stand
 * (`TaskAgentsMark`). Note that
 * a task whose repository belongs to another of the account's workspaces
 * wears no mark of its own here, because its card and its banner name that
 * workspace, and the row's one icon stays how its agents stand.
 */
export function TaskRowStatus({ task }: { task: TaskSummary }): React.JSX.Element | null {
  return <TaskAgentsMark agents={task.agents} />;
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
 * Who created the task, at the card's foot: their face and "Created by
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
  now: number | undefined;
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
          <Time at={task.createdAt} now={now} hint={false} look={TIME_LOOK.PROVENANCE} />
        </>
      }
      onPress={door}
    />
  );
}

/** One agent's row, as its tab draws it (`main-tabs.tsx`): its harness's mark wearing where it stands (`AgentGlyph`), its tab's label, and a failure at its end (`agentEndMark`). */
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

/** The tasks a card reads its relations from where none are handed. */
const NO_TASKS: readonly TaskSummary[] = [];

/** One task of the card's relations, as a row: its status's mark, its name, and its key, which opens it. */
function RelatedTaskLine({
  task,
  workspaceName,
  prefix,
  onOpen,
}: {
  task: TaskSummary;
  workspaceName: string | undefined;
  /** What the row says before the name, muted: "Part of". */
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

/**
 * What a card says of the task's place among others: the task it is part of,
 * a header with how many of its sub-tasks are finished over a row for each,
 * scrolling past a few rows' height, and, while another task it waits on is
 * still open, that it is blocked. Each task named opens as a press on it
 * does. Note that the summaries carry that a task is blocked and not which
 * tasks block it, so the row says no blocker: naming one is a read the card
 * does not make.
 */
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

/**
 * The card a sidebar task hangs: its status's mark and its name, wrapped to
 * two lines, its key, its repository, and how long ago it was updated under
 * the name, and its priority and assignee as marks at the head's right
 * (`TaskSub`, `TaskMarks`); then every one of its agents and its pull
 * requests, each list scrolling past a few rows' height, and, where others
 * share its workspace and the list names its creator, who created it, and
 * the workspace its repository belongs to where the reader may move it
 * there, at its foot. A card hung
 * from a place within the task, a section or a version a chip names
 * (`../tasks/chip-cards.tsx`), says that place on its own line in their
 * stead.
 */
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
  /** The name of the task's workspace, which its key is read under; none where the window holds no such workspace, and the card's sub says no key. */
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
  /** The time the card's times are counted back from; the window's minute where none is handed. */
  now: number | undefined;
  /** Opens the task on one of its agents' tabs. */
  onShowAgent: (agentId: string) => void;
  /** Every task the window holds, which the card reads its parent and its sub-tasks from (`parentTaskId`). */
  related?: readonly TaskSummary[];
  /** Opens a task the card names, its parent or one of its sub-tasks; where none is handed they stand as text. */
  onOpenTask?: ((taskId: string) => void) | undefined;
  /** The workspace the task's repository belongs to, where the reader may move it there, which the card names at its foot. */
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
  // Note that a task Luke or an agent made says so in a workspace of one too, where its member's own needs no saying.
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
      {/* Who made the task, and where its repository belongs, stand at the card's foot, under what is moving on it. */}
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

/**
 * One mark of where a task stands, as its board card draws it, named for a
 * screen reader by `words`, "Status: In progress", which a pointer resting
 * on it is told too, as the board's chip tells it, or hangs `card` in their
 * place, as an assignee's face hangs theirs. It only says: no press, no menu.
 */
function StandingMark({
  words,
  card,
  children,
}: {
  words: string;
  card?: React.ReactNode;
  /** The mark, hidden from a screen reader, which hears `words` instead. */
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

/**
 * The line under a task card's name: its key, its repository, and how long
 * ago it saw activity, "ACME-42 · acme/relay · 3h", each where it has one,
 * the time always.
 */
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

/**
 * A task card's corner: its priority's mark and who is on it, by face or the
 * dashed unassigned mark, icons alone, as the task board's card draws them
 * (`tasks-board.tsx`), a task from a service before priorities standing at
 * No priority as it does there.
 */
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
