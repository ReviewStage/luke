import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@sidecar/hosted/coding-agent-wire";
import type { CatalogModel } from "@sidecar/hosted/models-wire";
import type { PlanAgentLine, PlanPullRequestLine, PlanSummary } from "@sidecar/hosted/plan-wire";
import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
} from "lucide-react";
import { GitHubMark } from "../account-marks";
import { AgentGlyph, agentEndMark } from "../planning/agent-tab";
import { agentTabLabel, pullRequestPillLabel } from "../planning/coding-agent-model";
import { moreText, PLAN_ROW_MARK, planRowMark } from "../planning/plan-agents-model";
import { sinceText } from "../planning/plan-time";
import { repositoryPageUrl } from "../planning/planning-model";
import { RepositoryPicture } from "../repository-picture";
import { WorkingMark } from "../working-mark";

/**
 * plan-card.tsx -- a sidebar plan's agents at a glance: the one mark at its row's end, and the card its row hangs while the pointer rests on it.
 *
 * The mark is the working mark while an agent works on the plan
 * (`working-mark.tsx`), held mid-lap where motion is reduced, else the pull request's glyph in GitHub's colours for
 * where it stands, red where its checks failed, else nothing
 * (`plan-agents-model.ts`). The card names the plan, its repository, and
 * how long ago it was updated at its head, then a row for each of a few
 * agents, drawn as its tab draws it: its harness's mark wearing where it
 * stands, its tab's label, and a failure's mark at its end, with no word for where it stands, since no
 * agent anywhere else in the window says one. Then a row for each of a few
 * pull requests, its glyph coloured for where it stands, and its size.
 * Each list counts what it leaves out. Everything is read from the plan
 * list's row, so the card fetches nothing.
 *
 * Three of its lines are buttons, as a GitHub hover card's are: the
 * repository and a pull request open their pages on GitHub, and an agent
 * opens the plan on its tab. Each is also offered where the card is not:
 * the plan's menu opens the repository, and the agent's tab its pull
 * request. The rest are facts, left as text.
 */

/** The most rows each of the card's lists draws before it counts the rest. */
const CARD_ROWS = {
  AGENTS: 3,
  PULL_REQUESTS: 2,
} as const;

/** The glyph a pull request is drawn with for where it stands. */
const PULL_REQUEST_GLYPH = {
  [PULL_REQUEST_STATE.OPEN]: GitPullRequestIcon,
  [PULL_REQUEST_STATE.DRAFT]: GitPullRequestDraftIcon,
  [PULL_REQUEST_STATE.MERGED]: GitMergeIcon,
  [PULL_REQUEST_STATE.CLOSED]: GitPullRequestClosedIcon,
} as const;

/** The mark an agent at work is drawn with, in the mark's own slot, so the row moves nothing as the work starts or ends. */
function WorkingGlyph({ label }: { label: string }): React.JSX.Element {
  return (
    <span className="plan-mark-glyph" data-plan-mark="working" role="img" aria-label={label}>
      <WorkingMark />
    </span>
  );
}

/** A pull request's glyph, coloured for where it stands and red where its checks failed. */
function PullRequestGlyph({
  pullRequest,
}: {
  pullRequest: PlanPullRequestLine;
}): React.JSX.Element {
  const Glyph = PULL_REQUEST_GLYPH[pullRequest.state];
  const failing = pullRequest.checks === CHECK_SUMMARY.FAILING;
  return (
    <Glyph
      className="plan-mark-glyph"
      data-plan-mark="pull-request"
      data-state={pullRequest.state}
      data-failing={String(failing)}
      role="img"
      aria-label={`${pullRequestPillLabel(pullRequest)}${failing ? ", checks failing" : ""}`}
    />
  );
}

/** The one mark at a plan row's end, before its time: an agent at work, else its pull request, else nothing. */
export function PlanStatusMark({ plan }: { plan: PlanSummary }): React.JSX.Element | null {
  const mark = planRowMark(plan.agents);
  switch (mark.kind) {
    case PLAN_ROW_MARK.WORKING:
      return <WorkingGlyph label="Agent working" />;
    case PLAN_ROW_MARK.PULL_REQUEST:
      return <PullRequestGlyph pullRequest={mark.pullRequest} />;
    case PLAN_ROW_MARK.NONE:
      return null;
  }
}

/** One agent's row, as its tab draws it (`main-tabs.tsx`): its harness's mark wearing where it stands (`AgentGlyph`), its tab's label, and a failure at its end (`agentEndMark`). */
function AgentLine({
  agent,
  models,
  onShow,
}: {
  agent: PlanAgentLine;
  models: readonly CatalogModel[];
  onShow: () => void;
}): React.JSX.Element {
  return (
    <li data-plan-card-agent="">
      <button type="button" className="plan-card-line" onClick={onShow}>
        <span className="plan-card-glyph">
          <AgentGlyph agent={agent} />
        </span>
        <span className="plan-card-label">{agentTabLabel(agent, models)}</span>
        {agentEndMark(agent, false)}
      </button>
    </li>
  );
}

/**
 * One pull request's row: its glyph, which says where it stands, its
 * number muted before its title, and its size in green and red. It opens
 * the pull request on GitHub, where the service said its page; a row from
 * a service before it did is text.
 */
function PullRequestLine({
  pullRequest,
  onOpenGitHub,
}: {
  pullRequest: PlanPullRequestLine;
  onOpenGitHub: (url: string) => void;
}): React.JSX.Element {
  const { url } = pullRequest;
  const line = (
    <>
      <span className="plan-card-glyph">
        <PullRequestGlyph pullRequest={pullRequest} />
      </span>
      <span className="plan-card-label">
        <span className="plan-card-number">#{pullRequest.number}</span> {pullRequest.title}
      </span>
      <span className="plan-card-corner">
        <span className="agent-published-added">+{pullRequest.additions}</span>{" "}
        <span className="agent-published-removed">−{pullRequest.deletions}</span>
      </span>
    </>
  );
  return (
    <li data-plan-card-pull-request="">
      {url === undefined ? (
        <span className="plan-card-line">{line}</span>
      ) : (
        <button type="button" className="plan-card-line" onClick={() => onOpenGitHub(url)}>
          {line}
        </button>
      )}
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
 * name; then its agents and its pull requests, a few rows each
 * (`CARD_ROWS`), each list counting the rest the plan holds.
 */
export function PlanCard({
  plan,
  models,
  pictures,
  now,
  onOpenGitHub,
  onShowAgent,
}: {
  plan: PlanSummary;
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
}): React.JSX.Element {
  const { agents, repository } = plan;
  const agentRows = agents?.agents.slice(0, CARD_ROWS.AGENTS) ?? [];
  const pullRequestRows = agents?.pullRequests.slice(0, CARD_ROWS.PULL_REQUESTS) ?? [];
  return (
    <div className="plan-card" data-plan-card="">
      <div className="plan-card-heading">
        <div className="plan-card-head">
          <span className="plan-card-name">{plan.name}</span>
          <time className="plan-card-time" dateTime={new Date(plan.updatedAt).toISOString()}>
            {sinceText(plan.updatedAt, now)}
          </time>
        </div>
        {repository === null ? null : (
          <button
            type="button"
            className="plan-card-repository"
            onClick={() => onOpenGitHub(repositoryPageUrl(repository))}
          >
            <RepositoryPicture
              repository={repository}
              pictures={pictures}
              fallback={<GitHubMark />}
            />
            {repository}
          </button>
        )}
      </div>
      {agents === undefined || agentRows.length === 0 ? null : (
        <ul className="plan-card-lines" aria-label="Agents">
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
      )}
      {agents === undefined || pullRequestRows.length === 0 ? null : (
        <ul className="plan-card-lines" aria-label="Pull requests">
          {pullRequestRows.map((pullRequest) => (
            <PullRequestLine
              key={pullRequest.url ?? pullRequest.number}
              pullRequest={pullRequest}
              onOpenGitHub={onOpenGitHub}
            />
          ))}
          <More total={agents.pullRequestTotal} shown={pullRequestRows.length} />
        </ul>
      )}
    </div>
  );
}
