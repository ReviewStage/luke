import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import { moreText, TASK_ROW_MARK, taskRowMark } from "@luke/features/task-agents-model";
import type { TaskAgentLine, TaskPullRequestLine, TaskSummary } from "@luke/features/task-wire";
import type { Workspace } from "@luke/features/workspace-wire";
import { AttentionMark } from "@luke/panel/attention-mark";
import { WorkspaceRef } from "@luke/panel/desktop/workspace-ref";
import { useCreator, useMemberDirectory } from "@luke/panel/member-directory";
import { useActorDoor } from "@luke/panel/person-door";
import { RepositoryPicture } from "@luke/panel/repository-picture";
import { GLYPH_STATE, StateGlyph } from "@luke/panel/state-glyph";
import { RelativeTime } from "@luke/panel/tasks/relative-time";
import { useOpenLink } from "@luke/panel/tasks/use-open-link";
import {
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  HoverCardHead,
  HoverCardList,
  HoverCardRow,
  HoverCardRule,
  ProviderMark,
} from "@luke/ui";
import { ACTOR_KIND, actorName, SOMEONE_REASON } from "@luke/ui/actor-model";
import { TASK_ORDER, taskTime } from "@luke/ui/task-list-model";
import { repositoryPageUrl } from "@luke/ui/tasks-model";
import { ACTOR_SIZE, ActorMark } from "../actor-ref";
import { agentTabLabel, pullRequestNumberLabel } from "../tasks/coding-agent-model";
import { PullRequestMark } from "../tasks/pull-request-mark";
import { AgentGlyph, agentEndMark } from "../tasks/tab-look";
import type { TasksControl } from "../tasks/use-tasks-tab";
import { strandedHome } from "./move-task-dialog";

/**
 * task-card.tsx -- a sidebar task's agents at a glance: the one mark at its row's end, and the card its row hangs while the pointer rests on it.
 *
 * The mark is the working mark while an agent works on the task, drawn and
 * named as an agent's tab draws it (`state-glyph.tsx`), else the pull
 * request's mark (`pull-request-mark.tsx`), else nothing
 * (`task-agents-model.ts`). The card names the task, its repository, and
 * how long ago it was updated at its head, in a workspace others share who
 * created it, then a row for each of a few
 * agents, drawn as its tab draws it: its harness's mark wearing where it
 * stands, its tab's label, and a failure's mark at its end, with no word for where it stands, since no
 * agent anywhere else in the window says one. Then a row for each of a few
 * pull requests, its mark, and its size.
 * Each list counts what it leaves out. Everything is read from the task
 * list's row, so the card fetches nothing.
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

/** The most rows each of the card's lists draws before it counts the rest. */
const CARD_ROWS = {
  AGENTS: 3,
  PULL_REQUESTS: 2,
} as const;

/**
 * The one mark at a task row's end, before its time: the attention mark on
 * a task whose repository belongs to another of the account's workspaces,
 * which its card names (`strandedHome`); else an agent at work, else its
 * pull request, else nothing.
 */
export function TaskStatusMark({
  task,
  stranded,
}: {
  task: TaskSummary;
  /** The workspace the task's repository belongs to, where the reader may move it there. */
  stranded?: Workspace | undefined;
}): React.JSX.Element | null {
  if (stranded !== undefined) {
    return (
      <span className="task-mark-attention">
        <AttentionMark />
        <span className="visually-hidden">{`(repository belongs to ${stranded.name})`}</span>
      </span>
    );
  }
  const mark = taskRowMark(task.agents);
  switch (mark.kind) {
    case TASK_ROW_MARK.WORKING:
      return <StateGlyph state={GLYPH_STATE.WORKING} />;
    case TASK_ROW_MARK.PULL_REQUEST:
      return <PullRequestMark pullRequest={mark.pullRequest} className="task-mark-glyph" />;
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
        <RepositoryPicture
          repository={repository}
          pictures={pictures}
          fallback={<ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />}
        />
      }
      label={repository}
      onPress={() => onOpenGitHub(repositoryPageUrl(repository))}
    />
  );
}

/**
 * Who created the task, under its repository: their face and "Created by
 * Charles Pan · 3d ago", "Created by you", or a member who left saying so,
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
  const door = useActorDoor(creator);
  const left = creator.kind === ACTOR_KIND.SOMEONE && creator.reason === SOMEONE_REASON.FORMER;
  return (
    <HoverCardRow
      look={HOVER_CARD_ROW_LOOK.DETAIL}
      glyph={<ActorMark actor={creator} size={ACTOR_SIZE.MARK} />}
      label={
        <>
          {`Created by ${actorName(creator, { sentence: true })}${left ? ", who left" : ""} · `}
          <RelativeTime at={task.createdAt} now={now} hint={false} ago />
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
        label={agentTabLabel(agent, models)}
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
        glyph={<PullRequestMark pullRequest={pullRequest} className="task-mark-glyph" />}
        label={
          <>
            <span className="task-card-number">{pullRequestNumberLabel(pullRequest)}</span>{" "}
            {pullRequest.title}
          </>
        }
        end={
          <>
            <span className="agent-published-added">+{pullRequest.additions}</span>{" "}
            <span className="agent-published-removed">−{pullRequest.deletions}</span>
          </>
        }
        onPress={url === undefined ? undefined : () => openLink(url)}
      />
    </li>
  );
}

/**
 * The card a sidebar task hangs: its name, wrapped to two lines, and how
 * long ago it was updated at the head's right; its repository under the
 * name, and, where others share its workspace and the list names its
 * creator, who created it; then its agents and its pull requests, a few rows each
 * (`CARD_ROWS`), each list counting the rest the task holds. A card hung
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
}: {
  task: TaskSummary;
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
  const { agents, repository } = task;
  const { members } = useMemberDirectory();
  const agentRows = agents?.agents.slice(0, CARD_ROWS.AGENTS) ?? [];
  const pullRequestRows = agents?.pullRequests.slice(0, CARD_ROWS.PULL_REQUESTS) ?? [];
  return (
    <HoverCard data-task-card="">
      <HoverCardHead
        name={task.name}
        corner={<RelativeTime at={taskTime(task, TASK_ORDER.UPDATED)} now={now} hint={false} />}
      />
      {repository === null ? null : (
        <RepositoryDetail repository={repository} pictures={pictures} onOpenGitHub={onOpenGitHub} />
      )}
      {(shared ?? (members !== undefined && members.length > 1)) &&
      (task.createdBy !== undefined || task.ownerId !== undefined) ? (
        <CreatorDetail task={task} readerId={readerId} now={now} />
      ) : null}
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
      {focus === undefined ? null : (
        <>
          <HoverCardRule />
          <div data-task-card-focus="">
            <HoverCardRow glyph={focus.glyph} label={focus.words} />
          </div>
        </>
      )}
      {focus !== undefined || agents === undefined || agentRows.length === 0 ? null : (
        <>
          <HoverCardRule />
          <HoverCardList label="Agents" more={moreText(agents.total, agentRows.length)}>
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
      {focus !== undefined || agents === undefined || pullRequestRows.length === 0 ? null : (
        <>
          <HoverCardRule />
          <HoverCardList
            label="Pull requests"
            more={moreText(agents.pullRequestTotal, pullRequestRows.length)}
          >
            {pullRequestRows.map((pullRequest) => (
              <PullRequestLine
                key={pullRequest.url ?? pullRequest.number}
                pullRequest={pullRequest}
              />
            ))}
          </HoverCardList>
        </>
      )}
    </HoverCard>
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
  tasks: Pick<TasksControl, "agents" | "repositories" | "onShowAgent" | "me" | "workspaces">,
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
      models={tasks.agents.models ?? []}
      pictures={tasks.repositories.pictures}
      now={now}
      onOpenGitHub={tasks.repositories.openGitHub}
      onShowAgent={(agentId) => tasks.onShowAgent(task.id, agentId)}
    />
  );
}
