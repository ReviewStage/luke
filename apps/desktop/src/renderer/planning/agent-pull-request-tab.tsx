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
  type ConversationEntry,
  MERGE_STATE,
  type MergeState,
  PULL_REQUEST_STATE,
  type PullRequestCheck,
} from "@luke/features/coding-agent-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { ACT_KIND } from "@luke/host/acts";
import { CopyIcon, ProviderMark } from "@luke/ui";
import {
  CheckIcon,
  CircleDotIcon,
  CircleSlashIcon,
  EllipsisIcon,
  FileDiffIcon,
  GitPullRequestIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useAct } from "../act";
import { useCopyToast } from "../copy-feedback";
import { ActionMenu, type MenuAction, useActionMenu } from "../desktop/action-menu";
import { EmptyState } from "../empty-state";
import { READ_FAILURE_PLACE, ReadFailure } from "../read-failure";
import { SpinnerRegion } from "../spinner";
import { Tooltip } from "../tooltip";
import { useAgentRead } from "./agent-changes-tab";
import { agentSubject, NOTHING_HELD } from "./agent-ref";
import { agentStillWriting, pullRequestNumberLabel } from "./coding-agent-model";
import { useMinute } from "./plan-time";
import { PullRequestMark } from "./pull-request-mark";
import {
  OpenedBy,
  PersonRef,
  type PullRequestAgent,
  ReviewersLine,
  ReviewStanding,
} from "./pull-request-people";
import { RelativeTime } from "./relative-time";
import { TranscriptWords } from "./transcript-blocks";
import type { CodingAgentsControl } from "./use-coding-agents";
import { useOpenLink } from "./use-open-link";

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
 * word for where it stands, its branches, and its doors (the agent's Changes
 * tab, GitHub, and the ⋯), the page reads as a pull request's page on
 * GitHub does, drawn in the window's own parts: its title and number; who
 * opened it and when, as the Changes tab names them
 * (`pull-request-people.tsx`), with its reviewers' faces wearing where each
 * stands; while it is open, whether it would merge as it stands, in
 * GitHub's own terms; every check on its head, those that failed first,
 * then those still running, each opening its page; its description as
 * markdown, drawn as a transcript's words are (`TranscriptWords`); and its
 * comments and reviews in time order. Every name and word here is the
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
  CUT: "Read the rest on GitHub",
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

/** The order the checks are listed in, by where each stands: what asks for a look first. */
const CHECK_ORDER: readonly CheckState[] = [
  CHECK_STATE.FAILED,
  CHECK_STATE.PENDING,
  CHECK_STATE.PASSED,
  CHECK_STATE.SKIPPED,
];

/** The checks as one word, as the pull request's mark wears it: a failure beats a wait beats a pass. */
function checksSummaryOf(checks: readonly PullRequestCheck[]): CheckSummary {
  if (checks.some((check) => check.state === CHECK_STATE.FAILED)) return CHECK_SUMMARY.FAILING;
  if (checks.some((check) => check.state === CHECK_STATE.PENDING)) return CHECK_SUMMARY.PENDING;
  return checks.length === 0 ? CHECK_SUMMARY.NONE : CHECK_SUMMARY.PASSING;
}

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

/** The bar over the page: the mark and the word for where it stands, its branches, and its doors. */
function PullRequestBar({
  pullRequest,
  checks,
  reading,
  onRefresh,
  onOpenChanges,
}: {
  pullRequest: CodingAgentOverview;
  checks: CheckSummary;
  reading: boolean;
  onRefresh: () => void;
  onOpenChanges: () => void;
}): React.JSX.Element {
  const { tell } = useAct();
  const { state, base, head } = pullRequest;
  return (
    <header className="file-view-bar pull-request-bar">
      <span className="pull-request-state" data-pull-request-state={state}>
        <PullRequestMark pullRequest={{ number: pullRequest.number, state, checks }} />
        {STATE_WORDS[state]}
      </span>
      <Tooltip label={`${head} into ${base}`}>
        <span className="pull-request-branches">
          <bdi>{base}</bdi>
          {" ← "}
          <bdi>{head}</bdi>
        </span>
      </Tooltip>
      <div className="file-view-actions">
        <Tooltip label="Show changes">
          <button
            type="button"
            className="icon-button"
            aria-label="Show changes"
            onClick={onOpenChanges}
          >
            <FileDiffIcon aria-hidden="true" />
          </button>
        </Tooltip>
        <Tooltip label="Open on GitHub">
          <button
            type="button"
            className="icon-button"
            aria-label="Open on GitHub"
            onClick={() => tell(ACT_KIND.GITHUB_OPEN, { url: pullRequest.url })}
          >
            <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />
          </button>
        </Tooltip>
        <PullRequestMenu url={pullRequest.url} reading={reading} onRefresh={onRefresh} />
      </div>
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

/** Every check, what asks for a look first, under a count of each standing. */
function Checks({ checks }: { checks: readonly PullRequestCheck[] }): React.JSX.Element {
  const listed = CHECK_ORDER.flatMap((state) => checks.filter((check) => check.state === state));
  const counts = CHECK_ORDER.flatMap((state) => {
    const count = checks.filter((check) => check.state === state).length;
    return count === 0 ? [] : [`${count} ${CHECK_WORDS[state]}`];
  });
  return (
    <Section title="Checks" count={counts.length === 0 ? undefined : counts.join(", ")}>
      {listed.length === 0 ? (
        <p className="pull-request-quiet pull-request-none">{PULL_REQUEST_WORDS.NO_CHECKS}</p>
      ) : (
        <ul className="pull-request-checks">
          {listed.map((check, at) => (
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

/** One comment or review: who, where a review left them, and when; then their words. */
function EntryCard({
  entry,
  agent,
  now,
}: {
  entry: ConversationEntry;
  agent: PullRequestAgent;
  now: number;
}): React.JSX.Element {
  const openLink = useOpenLink();
  return (
    <li className="pull-request-entry">
      <span className="changes-comment-head">
        <PersonRef person={entry.by} agent={agent} />
        {entry.state === undefined ? null : <ReviewStanding state={entry.state} />}
        <RelativeTime className="changes-comment-time" at={entry.at} now={now} />
      </span>
      {entry.body === "" ? null : (
        <div className="pull-request-words">
          <TranscriptWords text={entry.body} />
        </div>
      )}
      {entry.cut ? (
        <button type="button" className="pull-request-more" onClick={() => openLink(entry.url)}>
          {PULL_REQUEST_WORDS.CUT}
        </button>
      ) : null}
    </li>
  );
}

/** The page under the bar: the title, who opened it and its reviewers, whether it merges, its checks, its description, and its conversation. */
function PullRequestPage({
  pullRequest,
  agent,
}: {
  pullRequest: CodingAgentOverview;
  agent: PullRequestAgent;
}): React.JSX.Element {
  const now = useMinute();
  const { author, reviewers, conversation, mergedAt } = pullRequest;
  const open =
    pullRequest.state === PULL_REQUEST_STATE.OPEN || pullRequest.state === PULL_REQUEST_STATE.DRAFT;
  return (
    <div className="pull-request-page">
      <h2 className="pull-request-title">
        {pullRequest.title}{" "}
        <span className="pull-request-number">{pullRequestNumberLabel(pullRequest)}</span>
      </h2>
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
        {pullRequest.body.trim() === "" ? (
          <p className="pull-request-quiet pull-request-none">
            {PULL_REQUEST_WORDS.NO_DESCRIPTION}
          </p>
        ) : (
          <div className="pull-request-words">
            <TranscriptWords text={pullRequest.body} />
          </div>
        )}
      </Section>
      <Section
        title="Conversation"
        count={conversation.length === 0 ? undefined : conversation.length}
      >
        {conversation.length === 0 ? (
          <p className="pull-request-quiet pull-request-none">
            {PULL_REQUEST_WORDS.NO_CONVERSATION}
          </p>
        ) : (
          <ol className="pull-request-conversation">
            {conversation.map((entry) => (
              <EntryCard key={entry.url} entry={entry} agent={agent} now={now} />
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

export function AgentPullRequestTab({
  agentId,
  control,
  shown,
  onOpenChanges,
}: {
  agentId: string;
  control: CodingAgentsControl;
  /** Whether the panel is on screen, which is when the tab reads. */
  shown: boolean;
  /** Opens the agent's Changes tab, its pull request's files. */
  onOpenChanges: () => void;
}): React.JSX.Element {
  const status = control.agents?.find((each) => each.id === agentId)?.status;
  const ended = !agentStillWriting(status ?? CODING_AGENT_STATUS.RUNNING);
  const { answer, out, ask } = useAgentRead(
    agentId,
    shown,
    ended,
    control.readOverview,
    UNANSWERED,
  );
  // Luke's own bot is the agent whose pull request it is, wherever the pull request names it.
  const agent = {
    subject: agentSubject(control, agentId, NOTHING_HELD, false),
    models: control.models,
  };
  // A failure gives way to the wait as soon as it is asked again; a page drawn stands until the answer lands.
  if (answer === undefined || (out && "failure" in answer)) {
    return <SpinnerRegion label={PULL_REQUEST_WORDS.READING} />;
  }
  if ("failure" in answer) {
    return (
      <div className="side-panel-empty">
        <ReadFailure
          line={PULL_REQUEST_WORDS.FAILED}
          onRetry={ask}
          place={READ_FAILURE_PLACE.CENTRED}
        />
      </div>
    );
  }
  const { pullRequest } = answer;
  if (pullRequest === null) {
    return (
      <EmptyState icon={<GitPullRequestIcon />}>{PULL_REQUEST_WORDS.NO_PULL_REQUEST}</EmptyState>
    );
  }
  return (
    <div className="file-view pull-request-tab ph-no-capture">
      <PullRequestBar
        pullRequest={pullRequest}
        checks={checksSummaryOf(pullRequest.checks)}
        reading={out}
        onRefresh={ask}
        onOpenChanges={onOpenChanges}
      />
      <PullRequestPage pullRequest={pullRequest} agent={agent} />
    </div>
  );
}
