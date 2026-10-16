import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentOverviewAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CHECK_STATE,
  CHECK_SUMMARY,
  type CheckState,
  type CheckSummary,
  CODING_AGENT_STATUS,
  type CodingAgentOverview,
  type CodingAgentPullRequest,
  type ConversationEntry,
  MERGE_STATE,
  type MergeState,
  PULL_REQUEST_STATE,
  type PullRequestCheck,
} from "@luke/features/coding-agent-wire";
import { githubImageOf } from "@luke/features/github-image";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { ACT_KIND } from "@luke/host/acts";
import { CopyIcon, EmptyState, ERROR_STATE_PLACEMENT, ErrorState, ProviderMark } from "@luke/ui";
import { PICTURE_STATE, usePicture } from "@luke/ui/picture-cache";
import {
  CheckIcon,
  CircleDotIcon,
  CircleSlashIcon,
  EllipsisIcon,
  GitPullRequestIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useCallback } from "react";
import { useAct } from "../act";
import { useCopyToast } from "../copy-feedback";
import { ActionMenu, type MenuAction, useActionMenu } from "../desktop/action-menu";
import { Segmented } from "../segmented";
import { SpinnerRegion } from "../spinner";
import { Tooltip } from "../tooltip";
import { AgentChangesTab, useAgentRead } from "./agent-changes-tab";
import { agentSubject, NOTHING_HELD } from "./agent-ref";
import { agentStillWriting, pullRequestNumberLabel } from "./coding-agent-model";
import { PullRequestMark } from "./pull-request-mark";
import {
  OpenedBy,
  PersonRef,
  type PullRequestAgent,
  ReviewersLine,
  ReviewStanding,
} from "./pull-request-people";
import { RelativeTime } from "./relative-time";
import { useMinute } from "./task-time";
import {
  type GitHubPictureDrawer,
  GitHubPictureLink,
  GitHubWords,
  TranscriptWords,
} from "./transcript-blocks";
import type { CodingAgentsControl } from "./use-coding-agents";
import { useOpenLink } from "./use-open-link";
import { PULL_REQUEST_VIEW, type PullRequestView } from "./use-side-panel";

/**
 * agent-pull-request-tab.tsx -- one agent's Pull request tab in the side panel: its pull request as GitHub holds it, read top to bottom as a page: where it stands, whether it would merge, its checks one by one, its description, and its conversation.
 *
 * The overview is read from GitHub afresh by the service on each ask, on
 * the App's token for the agent's repository rather than anyone's own, so
 * nothing here reads on a clock: the tab asks as it first comes on screen,
 * when the developer presses Retry or Refresh, and the moment the agent
 * ends, since that is when what it published settles (`useAgentRead`, as
 * the Changes tab reads). A refresh leaves the page drawn standing until its
 * answer lands; a read that failed says so with a retry; an agent with no
 * pull request yet says that.
 *
 * Under a bar like a File tab's, which wears the pull request's mark and the
 * word for where it stands, the switch between its overview and its files
 * (`AgentChangesTab`), and on the overview its doors (GitHub and the ⋯), the
 * page reads as a pull request's page on GitHub does, drawn in the window's
 * own parts: its title, number, and branches; who
 * opened it and when, as the Changes tab names them
 * (`pull-request-people.tsx`), with its reviewers' faces wearing where each
 * stands; while it is open, whether it would merge as it stands, in
 * GitHub's own terms; every check on its head, those that failed first,
 * then those still running, each opening its page; and its description and
 * its comments and reviews in time order, as GitHub renders them
 * (`body_html`), drawn through the transcript's own markdown drawing
 * (`GitHubWords`), with an image GitHub serves read through the service on
 * the App's token (`GitHubPicture`) and any other drawn as its link, as
 * ReviewStage/stage draws them. Every name and word here is the
 * repository's, so the tab is left out of the screen recording
 * (`ph-no-capture`).
 */

/** The tab's own words. */
const PULL_REQUEST_WORDS = {
  READING: "Reading pull request",
  FAILED: "The pull request could not be read.",
  NO_PULL_REQUEST: "No pull request yet.",
  NO_DESCRIPTION: "No description provided.",
  NO_CHECKS: "No checks have run on this pull request.",
  NO_CONVERSATION: "Nobody has commented yet.",
  /** What the conversation says of the earlier entries a read left on GitHub, by how many. */
  earlier: (count: number) => `${count} earlier ${count === 1 ? "comment" : "comments"} on GitHub`,
} as const;

/** A read that threw rather than answered, drawn as any other failed read. */
const UNANSWERED: CodingAgentOverviewAnswerView = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };

/** The word for where the pull request stands, which its bar's pill says. */
const STATE_WORDS = {
  [PULL_REQUEST_STATE.OPEN]: "Open",
  [PULL_REQUEST_STATE.DRAFT]: "Draft",
  [PULL_REQUEST_STATE.MERGED]: "Merged",
  [PULL_REQUEST_STATE.CLOSED]: "Closed",
} as const;

/** How a merge's standing reads: whether it is good news, a wait, or something to fix. */
const MERGE_TONE = {
  READY: "ready",
  WAITING: "waiting",
  BLOCKED: "blocked",
} as const;

type MergeTone = (typeof MERGE_TONE)[keyof typeof MERGE_TONE];

/** What a merge's standing says, and in what tone. */
interface MergeWords {
  readonly line: string;
  readonly tone: MergeTone;
}

/** What a merge's standing says, as GitHub's own box under a pull request says it, its base named where it matters. */
function mergeWords(merge: MergeState, base: string): MergeWords {
  switch (merge) {
    case MERGE_STATE.CLEAN:
      return { line: "Ready to merge", tone: MERGE_TONE.READY };
    case MERGE_STATE.UNSTABLE:
      return { line: "Can merge, though some checks are not passing", tone: MERGE_TONE.WAITING };
    case MERGE_STATE.BLOCKED:
      return { line: "Merging is blocked by a required review or check", tone: MERGE_TONE.BLOCKED };
    case MERGE_STATE.BEHIND:
      return { line: `Behind ${base}; it must be brought up to date`, tone: MERGE_TONE.BLOCKED };
    case MERGE_STATE.CONFLICTS:
      return { line: `Conflicts with ${base}`, tone: MERGE_TONE.BLOCKED };
    case MERGE_STATE.DRAFT:
      return { line: "A draft; mark it ready for review to merge", tone: MERGE_TONE.WAITING };
    case MERGE_STATE.UNKNOWN:
      return { line: "GitHub is still checking whether it merges", tone: MERGE_TONE.WAITING };
  }
}

/** The glyph a check wears for where it stands. */
const CHECK_GLYPHS = {
  [CHECK_STATE.FAILED]: <XIcon />,
  [CHECK_STATE.PENDING]: <CircleDotIcon />,
  [CHECK_STATE.PASSED]: <CheckIcon />,
  [CHECK_STATE.SKIPPED]: <CircleSlashIcon />,
} as const satisfies Record<CheckState, ReactNode>;

/** Where a check stands, in the words its glyph says to a reader who cannot see it and the count says. */
const CHECK_WORDS = {
  [CHECK_STATE.FAILED]: "failed",
  [CHECK_STATE.PENDING]: "running",
  [CHECK_STATE.PASSED]: "passed",
  [CHECK_STATE.SKIPPED]: "skipped",
} as const satisfies Record<CheckState, string>;

/** The order the checks' counts are said in, by where each stands: what asks for a look first, as the service lists the checks themselves. */
const CHECK_ORDER: readonly CheckState[] = [
  CHECK_STATE.FAILED,
  CHECK_STATE.PENDING,
  CHECK_STATE.PASSED,
  CHECK_STATE.SKIPPED,
];

/** How long a check ran, as "42s", "3m 5s", or "1h 2m"; none for one still running or never timed. */
function durationOf(check: PullRequestCheck): string | undefined {
  if (check.startedAt === null || check.completedAt === null) return undefined;
  const seconds = Math.max(0, Math.round((check.completedAt - check.startedAt) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** The bar's ⋯: the page read again, and the pull request's link copied. */
function PullRequestMenu({
  url,
  reading,
  onRefresh,
}: {
  url: string;
  /** Whether a read is out, which a refresh would only repeat. */
  reading: boolean;
  onRefresh: () => void;
}): React.JSX.Element {
  const label = "Pull request actions";
  const menu = useActionMenu(true);
  const copyWithToast = useCopyToast();
  const actions: MenuAction[] = [
    {
      label: "Refresh pull request",
      icon: <RotateCwIcon aria-hidden="true" />,
      disabled: reading,
      onSelect: onRefresh,
    },
    {
      label: "Copy link",
      icon: <CopyIcon />,
      onSelect: () => copyWithToast(url, "Link copied"),
    },
  ];
  return (
    <>
      <Tooltip label={label}>
        <button type="button" className="icon-button" aria-label={label} {...menu.trigger()}>
          <EllipsisIcon />
        </button>
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu label={label} menu={menu.drawn} groups={[actions]} onClose={menu.close} />
      )}
    </>
  );
}

/** What the bar draws of the pull request: its mark's three, and its page. */
type BarPullRequest = Pick<CodingAgentPullRequest, "number" | "state" | "checks" | "url">;

/** The checks as one word, as the pull request's mark wears it: a failure beats a wait beats a pass. */
function checksSummaryOf(checks: readonly PullRequestCheck[]): CheckSummary {
  if (checks.some((check) => check.state === CHECK_STATE.FAILED)) return CHECK_SUMMARY.FAILING;
  if (checks.some((check) => check.state === CHECK_STATE.PENDING)) return CHECK_SUMMARY.PENDING;
  return checks.length === 0 ? CHECK_SUMMARY.NONE : CHECK_SUMMARY.PASSING;
}

/**
 * The pull request the bar draws: the overview's, once a read of it has
 * landed, since it is the newest and the page under the bar says the same;
 * else what the agent published, as last read for the plan, while the
 * overview is unread or its read failed.
 */
function barPullRequestOf(
  overview: CodingAgentOverviewAnswerView | undefined,
  published: CodingAgentPullRequest | undefined,
): BarPullRequest | undefined {
  if (overview === undefined || "failure" in overview || overview.pullRequest === null) {
    return published;
  }
  const { number, state, url, checks } = overview.pullRequest;
  return { number, state, url, checks: checksSummaryOf(checks) };
}

/** The words the bar's switch says for each view. */
const VIEW_OPTIONS = [
  { value: PULL_REQUEST_VIEW.OVERVIEW, label: "Overview" },
  { value: PULL_REQUEST_VIEW.FILES, label: "Files changed" },
] as const;

/**
 * The bar across the tab: the pill saying where the pull request stands,
 * in its colour, as last read of what the agent published, then the switch
 * between its overview and its files; on the overview, GitHub's page and the
 * ⋯ at its end, where the files' own bar stands under it otherwise.
 */
function PullRequestBar({
  published,
  view,
  onView,
  overview,
}: {
  published: BarPullRequest | undefined;
  view: PullRequestView;
  onView: (view: PullRequestView) => void;
  /** The overview's doors, drawn while it is the view shown and the agent has a pull request. */
  overview: { readonly reading: boolean; readonly onRefresh: () => void } | undefined;
}): React.JSX.Element {
  const { tell } = useAct();
  return (
    <header className="file-view-bar pull-request-bar">
      {published === undefined ? null : (
        <span className="pull-request-state" data-pull-request-state={published.state}>
          <PullRequestMark pullRequest={published} />
          {STATE_WORDS[published.state]}
        </span>
      )}
      <Segmented legend="Pull request view" options={VIEW_OPTIONS} value={view} onChange={onView} />
      {published === undefined || overview === undefined ? null : (
        <div className="file-view-actions">
          <Tooltip label="Open on GitHub">
            <button
              type="button"
              className="icon-button"
              aria-label="Open on GitHub"
              onClick={() => tell(ACT_KIND.GITHUB_OPEN, { url: published.url })}
            >
              <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />
            </button>
          </Tooltip>
          <PullRequestMenu
            url={published.url}
            reading={overview.reading}
            onRefresh={overview.onRefresh}
          />
        </div>
      )}
    </header>
  );
}

/** A section of the page: its heading, what it counts beside it, and what it holds. */
function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section className="pull-request-section" aria-label={title}>
      <h3 className="pull-request-heading">
        {title}
        {count === undefined ? null : <span className="pull-request-count">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

/** One check: its glyph for where it stands, its name, its App, and how long it ran; a press opens its page where it has one. */
function CheckRow({ check }: { check: PullRequestCheck }): React.JSX.Element {
  const openLink = useOpenLink();
  const duration = durationOf(check);
  const { url } = check;
  const inner = (
    <>
      <span
        className="pull-request-check-glyph"
        data-check-state={check.state}
        role="img"
        aria-label={CHECK_WORDS[check.state]}
      >
        {CHECK_GLYPHS[check.state]}
      </span>
      <span className="pull-request-check-name">{check.name}</span>
      {check.app === null ? null : <span className="pull-request-quiet">{check.app}</span>}
      {duration === undefined ? null : (
        <span className="pull-request-quiet pull-request-check-time">{duration}</span>
      )}
    </>
  );
  return (
    <li>
      {url === null ? (
        <span className="pull-request-check">{inner}</span>
      ) : (
        <button type="button" className="pull-request-check" onClick={() => openLink(url)}>
          {inner}
        </button>
      )}
    </li>
  );
}

/** Every check, in the order the service ranks them, failures first, under a count of each standing. */
function Checks({ checks }: { checks: readonly PullRequestCheck[] }): React.JSX.Element {
  const counts = CHECK_ORDER.flatMap((state) => {
    const count = checks.filter((check) => check.state === state).length;
    return count === 0 ? [] : [`${count} ${CHECK_WORDS[state]}`];
  });
  return (
    <Section title="Checks" count={counts.length === 0 ? undefined : counts.join(", ")}>
      {checks.length === 0 ? (
        <p className="pull-request-quiet pull-request-none">{PULL_REQUEST_WORDS.NO_CHECKS}</p>
      ) : (
        <ul className="pull-request-checks">
          {checks.map((check, at) => (
            // Note that two checks may share a name across Apps, so a row is keyed by its place too.
            <CheckRow key={`${at}`} check={check} />
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Whether the pull request would merge as it stands, in its tone's colour; drawn only while it is open. */
function MergeLine({ pullRequest }: { pullRequest: CodingAgentOverview }): React.JSX.Element {
  const { line, tone } = mergeWords(pullRequest.merge, pullRequest.base);
  return (
    <p className="pull-request-merge" data-merge-tone={tone}>
      {tone === MERGE_TONE.READY ? <CheckIcon aria-hidden="true" /> : null}
      {tone === MERGE_TONE.BLOCKED ? <XIcon aria-hidden="true" /> : null}
      {tone === MERGE_TONE.WAITING ? <CircleDotIcon aria-hidden="true" /> : null}
      {line}
    </p>
  );
}

/**
 * One picture GitHub's rendering names, read through the service on the
 * App's token as the agent's (`githubImageOf`), drawn from its `data:` URL
 * once read, a quiet box while it is, and its link where GitHub answered
 * none the window draws.
 */
function GitHubPicture({
  agentId,
  src,
  alt,
}: {
  agentId: string;
  src: string;
  alt: string;
}): React.JSX.Element {
  const { act } = useAct();
  const read = useCallback(
    (owner: string, address: string) =>
      act(ACT_KIND.CODING_AGENTS_GITHUB_IMAGE, { agentId: owner, src: address }),
    [act],
  );
  const state = usePicture(agentId, src, read);
  if (state.kind === PICTURE_STATE.READY) {
    return <img className="pull-request-picture" src={state.url} alt={alt} />;
  }
  if (state.kind === PICTURE_STATE.READING) {
    return <span className="pull-request-picture-waiting" role="img" aria-label={alt} />;
  }
  return <GitHubPictureLink src={src} alt={alt} />;
}

/** How the tab draws a picture GitHub's rendering names: one it may read through the service as the agent's, and none else. */
function usePictureDrawer(agentId: string): GitHubPictureDrawer {
  return useCallback(
    (src, alt) =>
      githubImageOf(src) === undefined ? undefined : (
        <GitHubPicture agentId={agentId} src={src} alt={alt} />
      ),
    [agentId],
  );
}

/** Words GitHub rendered, or, where it rendered none the read could carry, the words as markdown. */
function EntryWords({
  entry,
  picture,
}: {
  entry: ConversationEntry;
  picture: GitHubPictureDrawer;
}): React.JSX.Element | null {
  if (entry.html !== null) {
    return (
      <div className="pull-request-words">
        <GitHubWords html={entry.html} picture={picture} />
      </div>
    );
  }
  return entry.body === "" ? null : (
    <div className="pull-request-words">
      <TranscriptWords text={entry.body} />
    </div>
  );
}

/** One comment or review: who, where a review left them, and when; then their words. */
function EntryCard({
  entry,
  agent,
  now,
  picture,
}: {
  entry: ConversationEntry;
  agent: PullRequestAgent;
  now: number;
  picture: GitHubPictureDrawer;
}): React.JSX.Element {
  return (
    <li className="pull-request-entry">
      <span className="changes-comment-head">
        <PersonRef person={entry.by} agent={agent} />
        {entry.state === undefined ? null : <ReviewStanding state={entry.state} />}
        <RelativeTime className="changes-comment-time" at={entry.at} now={now} />
      </span>
      <EntryWords entry={entry} picture={picture} />
    </li>
  );
}

/** The page under the bar: the title, who opened it and its reviewers, whether it merges, its checks, its description, and its conversation. */
function PullRequestPage({
  agentId,
  pullRequest,
  agent,
}: {
  agentId: string;
  pullRequest: CodingAgentOverview;
  agent: PullRequestAgent;
}): React.JSX.Element {
  const now = useMinute();
  const openLink = useOpenLink();
  const picture = usePictureDrawer(agentId);
  const { author, reviewers, conversation, earlier, mergedAt } = pullRequest;
  const open =
    pullRequest.state === PULL_REQUEST_STATE.OPEN || pullRequest.state === PULL_REQUEST_STATE.DRAFT;
  return (
    <div className="pull-request-page">
      <h2 className="pull-request-title">
        {pullRequest.title}{" "}
        <span className="pull-request-number">{pullRequestNumberLabel(pullRequest)}</span>
      </h2>
      <Tooltip label={`${pullRequest.head} into ${pullRequest.base}`}>
        <p className="pull-request-branches">
          <bdi>{pullRequest.base}</bdi>
          {" ← "}
          <bdi>{pullRequest.head}</bdi>
        </p>
      </Tooltip>
      <div className="changes-people pull-request-people">
        {author === undefined ? null : (
          <OpenedBy person={author} writtenAs={pullRequest.writtenAs} agent={agent} />
        )}
        {/* Note that a merged one says when it merged, which is the moment that matters once it has. */}
        <span className="pull-request-quiet">
          {mergedAt === null ? null : "Merged "}
          <RelativeTime at={mergedAt ?? pullRequest.createdAt} now={now} ago />
        </span>
        {reviewers.length === 0 ? null : <ReviewersLine reviewers={reviewers} agent={agent} />}
      </div>
      {open ? <MergeLine pullRequest={pullRequest} /> : null}
      <Checks checks={pullRequest.checks} />
      <Section title="Description">
        {pullRequest.html === "" ? (
          <p className="pull-request-quiet pull-request-none">
            {PULL_REQUEST_WORDS.NO_DESCRIPTION}
          </p>
        ) : (
          <div className="pull-request-words">
            <GitHubWords html={pullRequest.html} picture={picture} />
          </div>
        )}
      </Section>
      <Section
        title="Conversation"
        count={earlier + conversation.length === 0 ? undefined : earlier + conversation.length}
      >
        {/* The earlier entries a read left on GitHub are counted where they would stand, first. */}
        {earlier === 0 ? null : (
          <button
            type="button"
            className="pull-request-more pull-request-earlier"
            onClick={() => openLink(pullRequest.url)}
          >
            {PULL_REQUEST_WORDS.earlier(earlier)}
          </button>
        )}
        {conversation.length === 0 ? (
          earlier === 0 ? (
            <p className="pull-request-quiet pull-request-none">
              {PULL_REQUEST_WORDS.NO_CONVERSATION}
            </p>
          ) : null
        ) : (
          <ol className="pull-request-conversation">
            {conversation.map((entry) => (
              <EntryCard key={entry.url} entry={entry} agent={agent} now={now} picture={picture} />
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

/** The overview read and drawn: a wait, a failure with its retry, no pull request yet, or the page. */
function OverviewView({
  agentId,
  read,
  agent,
}: {
  agentId: string;
  read: {
    readonly answer: CodingAgentOverviewAnswerView | undefined;
    readonly out: boolean;
    readonly ask: () => void;
  };
  agent: PullRequestAgent;
}): React.JSX.Element {
  const { answer, out, ask } = read;
  // A failure gives way to the wait as soon as it is asked again; a page drawn stands until the answer lands.
  if (answer === undefined || (out && "failure" in answer)) {
    return <SpinnerRegion label={PULL_REQUEST_WORDS.READING} />;
  }
  if ("failure" in answer) {
    return (
      <div className="side-panel-empty">
        <ErrorState onRetry={ask} placement={ERROR_STATE_PLACEMENT.CENTRED}>
          {PULL_REQUEST_WORDS.FAILED}
        </ErrorState>
      </div>
    );
  }
  if (answer.pullRequest === null) {
    return (
      <EmptyState icon={<GitPullRequestIcon />}>{PULL_REQUEST_WORDS.NO_PULL_REQUEST}</EmptyState>
    );
  }
  return <PullRequestPage agentId={agentId} pullRequest={answer.pullRequest} agent={agent} />;
}

/**
 * One agent's Pull request tab: the bar, then the view it shows, the
 * overview or the files (`AgentChangesTab`). Both stand once shown, the one
 * not shown hidden, so switching back and forth draws what each last read
 * rather than asking GitHub again; each reads first as it is first shown.
 */
export function AgentPullRequestTab({
  agentId,
  control,
  shown,
  repository,
  tree,
  view,
  onView,
}: {
  agentId: string;
  control: CodingAgentsControl;
  /** Whether the panel is on screen, which is when the tab reads. */
  shown: boolean;
  /** The plan's repository, which the files' breadcrumbs name; none names the path plain. */
  repository: string | null;
  /** Whether the tree beside File tabs and the files is open, and its toggle. */
  tree: { readonly open: boolean; readonly onToggle: () => void };
  view: PullRequestView;
  onView: (view: PullRequestView) => void;
}): React.JSX.Element {
  const status = control.agents?.find((each) => each.id === agentId)?.status;
  const ended = !agentStillWriting(status ?? CODING_AGENT_STATUS.RUNNING);
  const onOverview = view === PULL_REQUEST_VIEW.OVERVIEW;
  const read = useAgentRead(agentId, shown && onOverview, ended, control.readOverview, UNANSWERED);
  // Luke's own bot is the agent whose pull request it is, wherever the pull request names it.
  const agent = {
    subject: agentSubject(control, agentId, NOTHING_HELD, false),
    models: control.models,
  };
  return (
    <div className="file-view pull-request-tab ph-no-capture">
      <PullRequestBar
        published={barPullRequestOf(read.answer, control.pullRequests.get(agentId))}
        view={view}
        onView={onView}
        overview={onOverview ? { reading: read.out, onRefresh: read.ask } : undefined}
      />
      <div className="pull-request-view" hidden={!onOverview}>
        <OverviewView agentId={agentId} read={read} agent={agent} />
      </div>
      <div className="pull-request-view" hidden={onOverview}>
        <AgentChangesTab
          agentId={agentId}
          control={control}
          shown={shown && !onOverview}
          repository={repository}
          tree={tree}
        />
      </div>
    </div>
  );
}
