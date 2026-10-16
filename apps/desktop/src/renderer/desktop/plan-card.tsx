import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import { moreText, TASK_ROW_MARK, taskRowMark } from "@luke/features/task-agents-model";
import type { TaskAgentLine, TaskPullRequestLine, TaskSummary } from "@luke/features/task-wire";
import type { Workspace } from "@luke/features/workspace-wire";
import { ProviderMark } from "@luke/ui";
import { ACTOR_KIND, actorName, SOMEONE_REASON } from "@luke/ui/actor-model";
import { TASK_ORDER, taskTime } from "@luke/ui/task-list-model";
import { repositoryPageUrl } from "@luke/ui/tasks-model";
import { ACTOR_SIZE, ActorMark } from "../actor-ref";
import { AttentionMark } from "../attention-mark";
import { CardHead, CardRule, HoverCard } from "../hover-card";
import { useCreator, useMemberDirectory } from "../member-directory";
import { useActorDoor } from "../person-door";
import { agentTabLabel, pullRequestNumberLabel } from "../planning/coding-agent-model";
import { PullRequestMark } from "../planning/pull-request-mark";
import { RelativeTime } from "../planning/relative-time";
import { AgentGlyph, agentEndMark } from "../planning/tab-look";
import type { PlansControl } from "../planning/use-plans-tab";
import { RepositoryPicture } from "../repository-picture";
import { GLYPH_STATE, StateGlyph } from "../state-glyph";
import { Tooltip } from "../tooltip";
import { strandedHome } from "./move-plan-dialog";
import { WorkspaceRef } from "./workspace-ref";

/**
 * plan-card.tsx -- a sidebar plan's agents at a glance: the one mark at its row's end, and the card its row hangs while the pointer rests on it.
 *
 * The mark is the working mark while an agent works on the plan, drawn and
 * named as an agent's tab draws it (`state-glyph.tsx`), else the pull
 * request's mark (`pull-request-mark.tsx`), else nothing
 * (`plan-agents-model.ts`). The card names the plan, its repository, and
 * how long ago it was updated at its head, in a workspace others share who
 * created it, then a row for each of a few
 * agents, drawn as its tab draws it: its harness's mark wearing where it
 * stands, its tab's label, and a failure's mark at its end, with no word for where it stands, since no
 * agent anywhere else in the window says one. Then a row for each of a few
 * pull requests, its mark, and its size.
 * Each list counts what it leaves out. Everything is read from the plan
 * list's row, so the card fetches nothing.
 *
 * Three of its lines are buttons, as a GitHub hover card's are: the
 * repository and a pull request open their pages on GitHub, and an agent
 * opens the plan on its tab. Each is also offered where the card is not:
 * the plan's menu opens the repository, and the agent's tab its pull
 * request. The rest are facts, left as text. Its rows are set as a menu's
 * rows are, and a pinned tab's card (`sidebar-pinned-tab.tsx`) is drawn
 * from the same rows (`CardDetail`, `RepositoryDetail`, `PullRequestLine`).
 */

/** The most rows each of the card's lists draws before it counts the rest. */
const CARD_ROWS = {
  AGENTS: 3,
  PULL_REQUESTS: 2,
} as const;

/**
 * The one mark at a plan row's end, before its time: the attention mark on
 * a plan whose repository belongs to another of the account's workspaces,
 * which its card names (`strandedHome`); else an agent at work, else its
 * pull request, else nothing.
 */
export function PlanStatusMark({
  plan,
  stranded,
}: {
  plan: TaskSummary;
  /** The workspace the plan's repository belongs to, where the reader may move it there. */
  stranded?: Workspace | undefined;
}): React.JSX.Element | null {
  if (stranded !== undefined) {
    return (
      <span className="plan-mark-attention">
        <AttentionMark />
        <span className="visually-hidden">{`(repository belongs to ${stranded.name})`}</span>
      </span>
    );
  }
  const mark = taskRowMark(plan.agents);
  switch (mark.kind) {
    case TASK_ROW_MARK.WORKING:
      return <StateGlyph state={GLYPH_STATE.WORKING} />;
    case TASK_ROW_MARK.PULL_REQUEST:
      return <PullRequestMark pullRequest={mark.pullRequest} className="plan-mark-glyph" />;
    case TASK_ROW_MARK.NONE:
      return null;
  }
}

/**
 * One row of a card's lists, set as a menu's row is: its glyph, its words,
 * and what stands at its end. It is a button where a press does something,
 * and text where nothing does, in the same place either way.
 */
function CardLine({
  glyph,
  label,
  end,
  onPress,
}: {
  glyph: React.ReactNode;
  label: React.ReactNode;
  end?: React.ReactNode;
  onPress?: (() => void) | undefined;
}): React.JSX.Element {
  const line = (
    <>
      <span className="plan-card-glyph">{glyph}</span>
      <span className="plan-card-label">{label}</span>
      {end}
    </>
  );
  return onPress === undefined ? (
    <span className="plan-card-line">{line}</span>
  ) : (
    <button type="button" className="plan-card-line" onClick={onPress}>
      {line}
    </button>
  );
}

/** One of the quieter lines under a card's name, which a press opens: a plan, or a repository on GitHub. */
export function CardDetail({
  glyph,
  label,
  onPress,
}: {
  glyph: React.ReactNode;
  label: string;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <button type="button" className="plan-card-detail" onClick={onPress}>
      <span className="plan-card-glyph">{glyph}</span>
      <span className="plan-card-label">{label}</span>
    </button>
  );
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
    <CardDetail
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
  plan,
  readerId,
  now,
}: {
  plan: TaskSummary;
  readerId: string | undefined;
  now: number;
}): React.JSX.Element {
  const creator = useCreator(plan, readerId);
  const door = useActorDoor(creator);
  const left = creator.kind === ACTOR_KIND.SOMEONE && creator.reason === SOMEONE_REASON.FORMER;
  const words = (
    <>
      <span className="plan-card-glyph">
        <ActorMark actor={creator} size={ACTOR_SIZE.MARK} />
      </span>
      <span className="plan-card-label">
        {`Created by ${actorName(creator, { sentence: true })}${left ? ", who left" : ""} · `}
        <RelativeTime at={plan.createdAt} now={now} hint={false} ago />
      </span>
    </>
  );
  return door === undefined ? (
    <span className="plan-card-detail plan-card-creator">{words}</span>
  ) : (
    <button type="button" className="plan-card-detail plan-card-creator" onClick={door}>
      {words}
    </button>
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
    <li data-plan-card-agent="">
      <CardLine
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
 * the pull request on GitHub, where the service said its page; a row from
 * a service before it did is text.
 */
export function PullRequestLine({
  pullRequest,
  onOpenGitHub,
}: {
  pullRequest: TaskPullRequestLine;
  onOpenGitHub: (url: string) => void;
}): React.JSX.Element {
  const { url } = pullRequest;
  return (
    <li data-plan-card-pull-request="">
      <CardLine
        glyph={<PullRequestMark pullRequest={pullRequest} className="plan-mark-glyph" />}
        label={
          <>
            <span className="plan-card-number">{pullRequestNumberLabel(pullRequest)}</span>{" "}
            {pullRequest.title}
          </>
        }
        end={
          <span className="plan-card-corner">
            <span className="agent-published-added">+{pullRequest.additions}</span>{" "}
            <span className="agent-published-removed">−{pullRequest.deletions}</span>
          </span>
        }
        onPress={url === undefined ? undefined : () => onOpenGitHub(url)}
      />
    </li>
  );
}

/** A count of what a list leaves out, under its rows; nothing where it leaves nothing out. */
function More({ total, shown }: { total: number; shown: number }): React.JSX.Element | null {
  const words = moreText(total, shown);
  return words === undefined ? null : <li className="plan-card-more">{words}</li>;
}

/**
 * The card a sidebar plan hangs: its name, wrapped to two lines, and how
 * long ago it was updated at the head's right; its repository under the
 * name, and, where others share its workspace and the list names its
 * creator, who created it; then its agents and its pull requests, a few rows each
 * (`CARD_ROWS`), each list counting the rest the plan holds.
 */
export function PlanCard({
  plan,
  models,
  pictures,
  now,
  onOpenGitHub,
  onShowAgent,
  stranded,
  shared,
  readerId,
}: {
  plan: TaskSummary;
  /**
   * Whether others share the plan's workspace, where the card says who
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
  /** Opens the plan on one of its agents' tabs. */
  onShowAgent: (agentId: string) => void;
  /** The workspace the plan's repository belongs to, where the reader may move it there, which the card names under the repository. */
  stranded?: Workspace | undefined;
}): React.JSX.Element {
  const { agents, repository } = plan;
  const { members } = useMemberDirectory();
  const agentRows = agents?.agents.slice(0, CARD_ROWS.AGENTS) ?? [];
  const pullRequestRows = agents?.pullRequests.slice(0, CARD_ROWS.PULL_REQUESTS) ?? [];
  return (
    <HoverCard data-plan-card="">
      <CardHead
        name={plan.name}
        corner={<RelativeTime at={taskTime(plan, TASK_ORDER.UPDATED)} now={now} hint={false} />}
      />
      {repository === null ? null : (
        <RepositoryDetail repository={repository} pictures={pictures} onOpenGitHub={onOpenGitHub} />
      )}
      {(shared ?? (members !== undefined && members.length > 1)) &&
      (plan.createdBy !== undefined || plan.ownerId !== undefined) ? (
        <CreatorDetail plan={plan} readerId={readerId} now={now} />
      ) : null}
      {stranded === undefined ? null : (
        <span className="plan-card-detail">
          <span className="plan-card-glyph">
            <AttentionMark />
          </span>
          <span className="plan-card-label">
            Repository belongs to <WorkspaceRef workspace={stranded} />
          </span>
        </span>
      )}
      {agents === undefined || agentRows.length === 0 ? null : (
        <>
          <CardRule />
          <ul className="plan-card-rows" aria-label="Agents">
            {agentRows.map((agent) => (
              <AgentLine
                key={agent.id}
                agent={agent}
                models={models}
                onShow={() => onShowAgent(agent.id)}
              />
            ))}
            <More total={agents.total} shown={agentRows.length} />
          </ul>
        </>
      )}
      {agents === undefined || pullRequestRows.length === 0 ? null : (
        <>
          <CardRule />
          <ul className="plan-card-rows" aria-label="Pull requests">
            {pullRequestRows.map((pullRequest) => (
              <PullRequestLine
                key={pullRequest.url ?? pullRequest.number}
                pullRequest={pullRequest}
                onOpenGitHub={onOpenGitHub}
              />
            ))}
            <More total={agents.pullRequestTotal} shown={pullRequestRows.length} />
          </ul>
        </>
      )}
    </HoverCard>
  );
}

/** Whether others share a plan's workspace, as the service counts its members; unknown from a service that counts none. */
function sharedWorkspace(
  plans: Pick<PlansControl, "workspaces">,
  plan: Pick<TaskSummary, "workspaceId">,
): boolean | undefined {
  const count = plans.workspaces.find((each) => each.id === plan.workspaceId)?.memberCount;
  return count === undefined ? undefined : count > 1;
}

/**
 * The plan's card as every place naming the plan hangs it, read from the
 * window's plans: its sidebar row, its tab in its own column, and the
 * Inbox's crumb. An agent's line opens the plan on that agent's tab.
 */
export function planCardOf(
  plans: Pick<PlansControl, "agents" | "repositories" | "onShowAgent" | "me" | "workspaces">,
  plan: TaskSummary,
  now: number,
): React.JSX.Element {
  return (
    <PlanCard
      plan={plan}
      stranded={strandedHome(plans, plan)}
      shared={sharedWorkspace(plans, plan)}
      readerId={plans.me}
      models={plans.agents.models ?? []}
      pictures={plans.repositories.pictures}
      now={now}
      onOpenGitHub={plans.repositories.openGitHub}
      onShowAgent={(agentId) => plans.onShowAgent(plan.id, agentId)}
    />
  );
}

/**
 * A plan named in place: what it is drawn as, its document glyph and its
 * name as the place sets them, as one button that hangs the plan's card
 * while the pointer rests on it and opens the plan on a press, as
 * `AgentRef` names an agent. Note that the Inbox list's plan heading, whose
 * press folds it, and ⌘K's plan rows, whose card's buttons the modal
 * palette would leave unpressable, name the plan without one.
 */
export function PlanRef({
  plan,
  card,
  onOpen,
  className,
  children,
}: {
  plan: Pick<TaskSummary, "name">;
  /** The plan's card (`planCardOf`). */
  card: React.ReactNode;
  onOpen: () => void;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip label={plan.name} card={card}>
      <button type="button" className={className} data-plan-ref="" onClick={onOpen}>
        {children}
      </button>
    </Tooltip>
  );
}
