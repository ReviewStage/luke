import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentCallFailure,
} from "@luke/features/coding-agent-view";
import {
  CHANGES_BOUNDS,
  CHECK_STATE,
  CHECK_SUMMARY,
  type CheckState,
  type CheckSummary,
  CODING_AGENT_STATUS,
  type CodingAgentOverviewChecks,
  type CodingAgentOverviewConversation,
  type CodingAgentOverviewPullRequest,
  type CodingAgentPullRequest,
  type ConversationEntry,
  MERGE_STATE,
  type MergeState,
  PULL_REQUEST_STATE,
  type PullRequestCheck,
  type PullRequestReviewer,
  REVIEW_STATE,
  type ReviewThread,
} from "@luke/features/coding-agent-wire";
import { githubImageOf } from "@luke/features/github-image";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { ACT_KIND } from "@luke/host/acts";
import { CopyIcon, ProviderMark } from "@luke/ui";
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
import { Fold, FoldBody, FoldChevron, FoldSummary } from "../ai-elements/fold";
import { useCopyToast } from "../copy-feedback";
import { ActionMenu, type MenuAction, useActionMenu } from "../desktop/action-menu";
import { EmptyState } from "../empty-state";
import { READ_FAILURE_PLACE, ReadFailure } from "../read-failure";
import { Segmented } from "../segmented";
import { Skeleton, SkeletonRegion } from "../skeleton";
import { SpinnerRegion } from "../spinner";
import { Tooltip } from "../tooltip";
import { AgentChangesTab, useAgentRead } from "./agent-changes-tab";
import { threadPreview } from "./changes-model";
import { agentStillWriting, pullRequestNumberLabel } from "./coding-agent-model";
import { PierreDiff, useDiffLook } from "./file-diff";
import { PullRequestMark } from "./pull-request-mark";
import { OpenedBy, PersonRef, ReviewersLine, ReviewStanding } from "./pull-request-people";
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
 * the Changes tab reads). It is read in three reads asked at once, each
 * landing on its own: the pull request itself (its description, branches,
 * mergeability, and people), its checks, and its conversation. What Luke
 * already holds of the pull request, what the agent published, draws the
 * bar and the title at once; each section stands as a skeleton until its
 * read lands, and says so with its own Retry where its read failed. Refresh
 * reads all three again, each section drawn standing until its answer
 * lands; an agent with no pull request yet says that.
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
 * ReviewStage/stage draws them. A review carries the threads on lines it
 * started, each headed by its file and lines over the end of the hunk it was
 * made on, drawn as Files changed draws a diff with its own lines lit
 * (`file-diff.tsx`), then its comments; one
 * resolved or outdated by a later push is folded closed under its head,
 * which says which, until opened. Every name and word here is the
 * repository's, so the tab is left out of the screen recording
 * (`ph-no-capture`).
 */

/** The tab's own words. */
const PULL_REQUEST_WORDS = {
  READING: "Reading pull request",
  READING_CHECKS: "Reading checks",
  READING_DESCRIPTION: "Reading description",
  READING_CONVERSATION: "Reading conversation",
  FAILED: "The pull request could not be read.",
  CHECKS_FAILED: "The checks could not be read.",
  CONVERSATION_FAILED: "The conversation could not be read.",
  NO_PULL_REQUEST: "No pull request yet.",
  NO_DESCRIPTION: "No description provided.",
  NO_CHECKS: "No checks have run on this pull request.",
  NO_CONVERSATION: "Nobody has commented yet.",
  /** What the conversation says of the earlier entries a read left on GitHub, by how many. */
  earlier: (count: number) => `${count} earlier ${count === 1 ? "comment" : "comments"} on GitHub`,
  /** What a review thread says of the replies a read left on GitHub, by how many. */
  moreReplies: (count: number) => `${count} more ${count === 1 ? "reply" : "replies"} on GitHub`,
  RESOLVED: "Resolved",
  OUTDATED: "Outdated",
} as const;

/** The lines a review thread is on, as its head names them: where it stands now, else where it was made; none for a thread on the whole file. */
function threadLines(thread: ReviewThread): string | undefined {
  const line = thread.line ?? thread.originalLine;
  const start = thread.line === null ? thread.originalStartLine : thread.startLine;
  if (line === null) return undefined;
  return start === null || start === line ? `line ${line}` : `lines ${start}–${line}`;
}

/** A read that threw rather than answered, drawn as any other failed read. */
const UNANSWERED = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/** Where one of the overview's reads stands, as its section draws it: on its way, failed, answering that there is no pull request, or landed. */
const PART = {
  PENDING: "pending",
  FAILED: "failed",
  NONE: "none",
  LANDED: "landed",
} as const;

type Part<A> =
  | { readonly kind: typeof PART.PENDING }
  | { readonly kind: typeof PART.FAILED }
  | { readonly kind: typeof PART.NONE }
  | { readonly kind: typeof PART.LANDED; readonly value: A };

/** One of the overview's reads as `useAgentRead` holds it. */
interface PartRead<A> {
  readonly answer:
    | { readonly pullRequest: A | null }
    | { readonly failure: CodingAgentCallFailure }
    | undefined;
  readonly out: boolean;
  readonly ask: () => void;
}

/** Where one read stands. Note that a failure gives way to the wait as soon as it is asked again, while a part drawn stands until its answer lands. */
function partOf<A>(read: PartRead<A>): Part<A> {
  const { answer, out } = read;
  if (answer === undefined || (out && "failure" in answer)) return { kind: PART.PENDING };
  if ("failure" in answer) return { kind: PART.FAILED };
  return answer.pullRequest === null
    ? { kind: PART.NONE }
    : { kind: PART.LANDED, value: answer.pullRequest };
}

/** What a landed part holds; none while it is on its way or failed. */
function landed<A>(part: Part<A>): A | undefined {
  return part.kind === PART.LANDED ? part.value : undefined;
}

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
 * The pull request the bar draws: what the agent published, as last read
 * for the plan, from the first frame, each of its words replaced by the
 * overview's own as its read lands, since that is the newest and the page
 * under the bar says the same: where it stands by the pull request's read,
 * and its checks by theirs. None while neither has been read.
 */
function barPullRequestOf(
  pullRequest: CodingAgentOverviewPullRequest | undefined,
  checks: CodingAgentOverviewChecks | undefined,
  published: CodingAgentPullRequest | undefined,
): BarPullRequest | undefined {
  const held = pullRequest ?? published;
  if (held === undefined) return undefined;
  const { number, state, url } = held;
  const summary = checks === undefined ? published?.checks : checksSummaryOf(checks.checks);
  return { number, state, url, checks: summary ?? CHECK_SUMMARY.NONE };
}

/**
 * Who the pull request names as its reviewers: where each stands by their
 * reviews, as its conversation's read says, with those it still asks for a
 * review, as its own read says, standing asked whatever they said before,
 * as GitHub shows a re-requested reviewer; up to the bound.
 */
function reviewersOf(
  requested: readonly CodingAgentOverviewPullRequest["requested"][number][],
  standings: readonly PullRequestReviewer[],
): readonly PullRequestReviewer[] {
  const by = new Map<string, PullRequestReviewer>();
  for (const reviewer of standings) by.set(reviewer.by.login, reviewer);
  for (const person of requested)
    by.set(person.login, { by: person, state: REVIEW_STATE.REQUESTED });
  return [...by.values()].slice(0, CHANGES_BOUNDS.MAX_PEOPLE);
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
function MergeLine({
  pullRequest,
}: {
  pullRequest: CodingAgentOverviewPullRequest;
}): React.JSX.Element {
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

/** Quiet blocks where a part's words will stand, one per width given, which `label` names to a reader. */
function PartSkeleton({
  label,
  widths,
  className,
}: {
  label: string;
  widths: readonly string[];
  className?: string;
}): React.JSX.Element {
  return (
    <SkeletonRegion
      label={label}
      className={className ? `pull-request-skeleton ${className}` : "pull-request-skeleton"}
    >
      {widths.map((width, at) => (
        // oxlint-disable-next-line react/no-array-index-key -- a skeleton's blocks never move.
        <Skeleton key={at} width={width} />
      ))}
    </SkeletonRegion>
  );
}

/** A part whose read failed: its sentence and its own Retry, where the part would have stood. */
function PartFailure({ line, onRetry }: { line: string; onRetry: () => void }): React.JSX.Element {
  return (
    <div className="pull-request-failure">
      <ReadFailure line={line} onRetry={onRetry} />
    </div>
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
  entry: Pick<ConversationEntry, "html" | "body">;
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

/**
 * One review thread: its file and lines at its head, with whether it was
 * resolved or a later push outdated it, which folds it closed until opened;
 * then the lines it is on, as Files changed draws a diff, its own lines lit
 * (`threadPreview`), and its comments, oldest first, as the conversation
 * draws an entry, with the replies a read left on GitHub counted after them.
 */
function ThreadCard({
  thread,
  now,
  picture,
}: {
  thread: ReviewThread;
  now: number;
  picture: GitHubPictureDrawer;
}): React.JSX.Element {
  // A preview is a hunk's end in a card, drawn unified with its lines tinted whole, as stage-cli draws one.
  const look = { ...useDiffLook(false), changedWords: false };
  const openLink = useOpenLink();
  const preview = threadPreview(thread);
  const lines = threadLines(thread);
  const labels = [
    ...(thread.resolved ? [PULL_REQUEST_WORDS.RESOLVED] : []),
    ...(thread.outdated ? [PULL_REQUEST_WORDS.OUTDATED] : []),
  ];
  const last = thread.comments.at(-1);
  return (
    <li className="pull-request-thread">
      <Fold defaultOpen={labels.length === 0}>
        <FoldSummary className="pull-request-thread-head">
          <Tooltip label={thread.path}>
            <span className="pull-request-thread-path">
              <bdi>{thread.path}</bdi>
            </span>
          </Tooltip>
          {lines === undefined ? null : <span className="pull-request-quiet">{lines}</span>}
          {labels.map((label) => (
            <span key={label} className="pull-request-thread-label">
              {label}
            </span>
          ))}
          <FoldChevron />
        </FoldSummary>
        <FoldBody>
          {preview === undefined ? null : (
            <PierreDiff
              patch={preview.patch}
              look={look}
              selected={preview.selected}
              excerpt
              className="diff-view pull-request-thread-lines"
            />
          )}
          <ol className="pull-request-thread-comments">
            {thread.comments.map((comment) => (
              <li key={comment.url} className="pull-request-thread-comment">
                <span className="changes-comment-head">
                  <PersonRef person={comment.by} />
                  <RelativeTime className="changes-comment-time" at={comment.at} now={now} />
                </span>
                <EntryWords entry={comment} picture={picture} />
              </li>
            ))}
          </ol>
          {thread.more === 0 || last === undefined ? null : (
            <button
              type="button"
              className="pull-request-more pull-request-thread-more"
              onClick={() => openLink(last.url)}
            >
              {PULL_REQUEST_WORDS.moreReplies(thread.more)}
            </button>
          )}
        </FoldBody>
      </Fold>
    </li>
  );
}

/** One comment or review: who, where a review left them, and when; then their words, and the review threads a review started. */
function EntryCard({
  entry,
  now,
  picture,
}: {
  entry: ConversationEntry;
  now: number;
  picture: GitHubPictureDrawer;
}): React.JSX.Element {
  const threads = entry.threads ?? [];
  return (
    <li className="pull-request-entry">
      <span className="changes-comment-head">
        <PersonRef person={entry.by} />
        {entry.state === undefined ? null : <ReviewStanding state={entry.state} />}
        <RelativeTime className="changes-comment-time" at={entry.at} now={now} />
      </span>
      <EntryWords entry={entry} picture={picture} />
      {threads.length === 0 ? null : (
        <ol className="pull-request-threads">
          {threads.map((thread, at) => (
            // Note that a thread is keyed by its first comment's page, which no other thread shares, or its place.
            <ThreadCard
              key={thread.comments[0]?.url ?? `${at}`}
              thread={thread}
              now={now}
              picture={picture}
            />
          ))}
        </ol>
      )}
    </li>
  );
}

/** The overview's three reads, each as it stands, with the door that asks each again. */
interface OverviewParts {
  readonly pullRequest: Part<CodingAgentOverviewPullRequest>;
  readonly checks: Part<CodingAgentOverviewChecks>;
  readonly conversation: Part<CodingAgentOverviewConversation>;
  readonly ask: {
    readonly pullRequest: () => void;
    readonly checks: () => void;
    readonly conversation: () => void;
  };
}

/** Under the title: the branches, who opened it and when, its reviewers, and, while it is open, whether it merges; a skeleton while its read is out, and its failure with Retry. */
function PullRequestHead({ parts, now }: { parts: OverviewParts; now: number }): React.JSX.Element {
  const { pullRequest: part, conversation } = parts;
  if (part.kind === PART.PENDING) {
    return (
      <PartSkeleton
        label={PULL_REQUEST_WORDS.READING}
        widths={["40%", "65%"]}
        className="pull-request-head-skeleton"
      />
    );
  }
  if (part.kind !== PART.LANDED) {
    return <PartFailure line={PULL_REQUEST_WORDS.FAILED} onRetry={parts.ask.pullRequest} />;
  }
  const pullRequest = part.value;
  const { author, mergedAt } = pullRequest;
  const reviewers = reviewersOf(pullRequest.requested, landed(conversation)?.reviewers ?? []);
  const open =
    pullRequest.state === PULL_REQUEST_STATE.OPEN || pullRequest.state === PULL_REQUEST_STATE.DRAFT;
  return (
    <>
      <Tooltip label={`${pullRequest.head} into ${pullRequest.base}`}>
        <p className="pull-request-branches">
          <bdi>{pullRequest.base}</bdi>
          {" ← "}
          <bdi>{pullRequest.head}</bdi>
        </p>
      </Tooltip>
      <div className="changes-people pull-request-people">
        {author === undefined ? null : <OpenedBy person={author} />}
        {/* Note that a merged one says when it merged, which is the moment that matters once it has. */}
        <span className="pull-request-quiet">
          {mergedAt === null ? null : "Merged "}
          <RelativeTime at={mergedAt ?? pullRequest.createdAt} now={now} ago />
        </span>
        {reviewers.length === 0 ? null : <ReviewersLine reviewers={reviewers} />}
      </div>
      {open ? <MergeLine pullRequest={pullRequest} /> : null}
    </>
  );
}

/** The checks section as its read stands: every check once landed, a skeleton of rows while out, its failure with Retry. */
function ChecksPart({ parts }: { parts: OverviewParts }): React.JSX.Element {
  const part = parts.checks;
  if (part.kind === PART.LANDED) return <Checks checks={part.value.checks} />;
  return (
    <Section title="Checks">
      {part.kind === PART.PENDING ? (
        <PartSkeleton
          label={PULL_REQUEST_WORDS.READING_CHECKS}
          widths={["55%", "45%", "50%"]}
          className="pull-request-checks-skeleton"
        />
      ) : (
        <PartFailure line={PULL_REQUEST_WORDS.CHECKS_FAILED} onRetry={parts.ask.checks} />
      )}
    </Section>
  );
}

/** The description, as the pull request's read carries it; a skeleton while that read is out, and nothing where it failed, whose failure stands under the title. */
function DescriptionPart({
  part,
  picture,
}: {
  part: Part<CodingAgentOverviewPullRequest>;
  picture: GitHubPictureDrawer;
}): React.JSX.Element | null {
  if (part.kind === PART.FAILED || part.kind === PART.NONE) return null;
  return (
    <Section title="Description">
      {part.kind === PART.PENDING ? (
        <PartSkeleton
          label={PULL_REQUEST_WORDS.READING_DESCRIPTION}
          widths={["90%", "75%", "82%", "40%"]}
        />
      ) : part.value.html === "" ? (
        <p className="pull-request-quiet pull-request-none">{PULL_REQUEST_WORDS.NO_DESCRIPTION}</p>
      ) : (
        <div className="pull-request-words">
          <GitHubWords html={part.value.html} picture={picture} />
        </div>
      )}
    </Section>
  );
}

/** The conversation as its read stands: its entries once landed, the earlier ones counted first; a skeleton while out, its failure with Retry. */
function ConversationPart({
  parts,
  url,
  now,
  picture,
}: {
  parts: OverviewParts;
  /** The pull request's page, which the earlier entries left on GitHub open. */
  url: string | undefined;
  now: number;
  picture: GitHubPictureDrawer;
}): React.JSX.Element {
  const openLink = useOpenLink();
  const part = parts.conversation;
  if (part.kind !== PART.LANDED) {
    return (
      <Section title="Conversation">
        {part.kind === PART.PENDING ? (
          <PartSkeleton
            label={PULL_REQUEST_WORDS.READING_CONVERSATION}
            widths={["35%", "85%", "70%"]}
          />
        ) : (
          <PartFailure
            line={PULL_REQUEST_WORDS.CONVERSATION_FAILED}
            onRetry={parts.ask.conversation}
          />
        )}
      </Section>
    );
  }
  const { conversation, earlier } = part.value;
  return (
    <Section
      title="Conversation"
      count={earlier + conversation.length === 0 ? undefined : earlier + conversation.length}
    >
      {/* The earlier entries a read left on GitHub are counted where they would stand, first. */}
      {earlier === 0 || url === undefined ? null : (
        <button
          type="button"
          className="pull-request-more pull-request-earlier"
          onClick={() => openLink(url)}
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
            <EntryCard key={entry.url} entry={entry} now={now} picture={picture} />
          ))}
        </ol>
      )}
    </Section>
  );
}

/** The page under the bar: the title, as read or as held, then each part as its read stands: the head, the checks, the description, and the conversation. */
function PullRequestPage({
  agentId,
  title,
  parts,
}: {
  agentId: string;
  /** The title and number, as the pull request's read says or, until it lands, as Luke held them; none where neither has. */
  title: Pick<CodingAgentPullRequest, "title" | "number" | "url"> | undefined;
  parts: OverviewParts;
}): React.JSX.Element {
  const now = useMinute();
  const picture = usePictureDrawer(agentId);
  return (
    <div className="pull-request-page">
      {title === undefined ? (
        <PartSkeleton
          label={PULL_REQUEST_WORDS.READING}
          widths={["60%"]}
          className="pull-request-title"
        />
      ) : (
        <h2 className="pull-request-title">
          {title.title} <span className="pull-request-number">{pullRequestNumberLabel(title)}</span>
        </h2>
      )}
      <PullRequestHead parts={parts} now={now} />
      <ChecksPart parts={parts} />
      <DescriptionPart part={parts.pullRequest} picture={picture} />
      <ConversationPart parts={parts} url={title?.url} now={now} picture={picture} />
    </div>
  );
}

/**
 * The overview as its reads stand: no pull request yet where a read says
 * so; while nothing is held or read of the pull request, a wait, or, where
 * every read failed, one failure whose Retry reads all three; else the
 * page, each part as its read stands.
 */
function OverviewView({
  agentId,
  parts,
  published,
  onRetry,
}: {
  agentId: string;
  parts: OverviewParts;
  published: CodingAgentPullRequest | undefined;
  onRetry: () => void;
}): React.JSX.Element {
  const all = [parts.pullRequest, parts.checks, parts.conversation];
  if (all.some((part) => part.kind === PART.NONE)) {
    return (
      <EmptyState icon={<GitPullRequestIcon />}>{PULL_REQUEST_WORDS.NO_PULL_REQUEST}</EmptyState>
    );
  }
  // Note that with nothing held, only a part landing says there is a pull request to draw.
  if (published === undefined && !all.some((part) => part.kind === PART.LANDED)) {
    if (all.some((part) => part.kind === PART.PENDING)) {
      return <SpinnerRegion label={PULL_REQUEST_WORDS.READING} />;
    }
    return (
      <div className="side-panel-empty">
        <ReadFailure
          line={PULL_REQUEST_WORDS.FAILED}
          onRetry={onRetry}
          place={READ_FAILURE_PLACE.CENTRED}
        />
      </div>
    );
  }
  return (
    <PullRequestPage
      agentId={agentId}
      title={landed(parts.pullRequest) ?? published}
      parts={parts}
    />
  );
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
  const reads = shown && onOverview;
  // The three are asked at once as the overview is first shown, each landing on its own.
  const pullRequestRead = useAgentRead(
    agentId,
    reads,
    ended,
    control.readOverviewPullRequest,
    UNANSWERED,
  );
  const checksRead = useAgentRead(agentId, reads, ended, control.readOverviewChecks, UNANSWERED);
  const conversationRead = useAgentRead(
    agentId,
    reads,
    ended,
    control.readOverviewConversation,
    UNANSWERED,
  );
  const ask = {
    pullRequest: pullRequestRead.ask,
    checks: checksRead.ask,
    conversation: conversationRead.ask,
  };
  const refresh = () => {
    ask.pullRequest();
    ask.checks();
    ask.conversation();
  };
  const parts: OverviewParts = {
    pullRequest: partOf(pullRequestRead),
    checks: partOf(checksRead),
    conversation: partOf(conversationRead),
    ask,
  };
  const reading = pullRequestRead.out || checksRead.out || conversationRead.out;
  const published = control.pullRequests.get(agentId);
  return (
    <div className="file-view pull-request-tab ph-no-capture">
      <PullRequestBar
        published={barPullRequestOf(landed(parts.pullRequest), landed(parts.checks), published)}
        view={view}
        onView={onView}
        overview={onOverview ? { reading, onRefresh: refresh } : undefined}
      />
      <div className="pull-request-view" hidden={!onOverview}>
        <OverviewView agentId={agentId} parts={parts} published={published} onRetry={refresh} />
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
