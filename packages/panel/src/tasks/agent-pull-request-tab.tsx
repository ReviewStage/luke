import { githubAvatarAt, githubAvatarUrl } from "@luke/features/account-picture";
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
  DEPLOYMENT_STATE,
  type DeploymentState,
  MERGE_STATE,
  type MergeState,
  PULL_REQUEST_STATE,
  type PullRequestCheck,
  type PullRequestDeployment,
  type PullRequestReviewer,
  REVIEW_STATE,
  type ReactionGroup,
  type ReviewThread,
} from "@luke/features/coding-agent-wire";
import { githubImageOf } from "@luke/features/github-image";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { ACT_KIND } from "@luke/host/acts";
import { INLINE_DIFF } from "@luke/settings/diff-view";
import {
  AVATAR_SHAPE,
  AVATAR_SIZE,
  Avatar,
  Badge,
  Button,
  CopyIcon,
  CountParts,
  DETAIL_PAGE_INSET,
  DetailPage,
  DisclosureChevron,
  EmptyState,
  ErrorState,
  IconButton,
  LIST_DENSITY,
  LIST_VARIANT,
  List,
  ListRow,
  linesCount,
  PAGE_FRAME,
  ProviderMark,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
  Switch,
  TAB_COUNT_TONE,
  TABS_INSET,
  TabCount,
  type TabCountTone,
  type TabItem,
  Tabs,
  TEXT_BUTTON_TONE,
  TextButton,
  useMenu,
} from "@luke/ui";
import { PICTURE_STATE, usePicture } from "@luke/ui/picture-cache";
import {
  BotIcon,
  CheckIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleSlashIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  FileDiffIcon,
  GitPullRequestIcon,
  MessagesSquareIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useId, useMemo, useState } from "react";
import { useAct } from "../act.js";
import { Fold, FoldBody, FoldSummary } from "../ai-elements/fold.js";
import { appPlatform } from "../app-platform.js";
import { useCopyToast } from "../copy-feedback.js";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { Tooltip } from "../tooltip.js";
import {
  AgentChangesTab,
  type ChangesThreads,
  THREAD_PLACE,
  type ThreadPlace,
  useAgentRead,
} from "./agent-changes-tab.js";
import { threadPreview } from "./changes-model.js";
import { agentStillWriting, pullRequestNumberLabel } from "./coding-agent-model.js";
import {
  type ConversationFiltersControl,
  type ConversationHidden,
  conversationHidden,
  filteredConversation,
  useConversationFilters,
} from "./conversation-filters.js";
import { PierreDiff, useDiffLook } from "./file-diff.js";
import type { TreeShown } from "./file-view.js";
import type { PendingReview } from "./line-comment.js";
import { blockedWords, MergeActions } from "./merge-box.js";
import {
  type PullRequestComment,
  PullRequestCommentBox,
  usePullRequestComment,
} from "./pull-request-comment-box.js";
import { PullRequestLabels } from "./pull-request-labels.js";
import { ofPullRequestTab, PullRequestNumberProvider } from "./pull-request-number.js";
import { HeaderReviewers, OpenedBy, PersonRef, ReviewStanding } from "./pull-request-people.js";
import {
  LabelPicker,
  ReviewerPicker,
  type ReviewOptions,
  useReviewOptions,
} from "./pull-request-pickers.js";
import { Reactions } from "./pull-request-reactions.js";
import { PullRequestReview } from "./pull-request-review.js";
import { PullRequestStack } from "./pull-request-stack.js";
import { ThreadActions, ThreadWritesProvider } from "./pull-request-thread-actions.js";
import {
  PullRequestStateMenu,
  PullRequestTitle,
  PullRequestWriteNote,
  type PullRequestWrites,
  usePullRequestWrites,
} from "./pull-request-writes.js";
import { RelativeTime } from "./relative-time.js";
import { useMinute } from "./task-time.js";
import {
  type GitHubPictureDrawer,
  GitHubPictureLink,
  GitHubWords,
  TranscriptWords,
} from "./transcript-blocks.js";
import type { CodingAgentsControl } from "./use-coding-agents.js";
import { useOpenLink } from "./use-open-link.js";
import { PULL_REQUEST_VIEW, type PullRequestView } from "./use-side-panel.js";
import { useWorkingNow, workingTime } from "./working-time.js";

/**
 * agent-pull-request-tab.tsx -- one agent's Pull request tab in the side panel: its pull request as GitHub holds it, laid out as stage-cli's pull request page: a fixed header, then tabs for its conversation, its checks, and its files.
 *
 * The overview is read from GitHub afresh by the service on each ask, on
 * the App's token for the agent's repository rather than anyone's own, so
 * nothing here reads on a clock: each read is asked as what draws it first
 * comes on screen, when the developer presses Retry or Refresh, and the
 * moment the agent ends, since that is when what it published settles
 * (`useAgentRead`, as the Changes tab reads). It is three reads, each
 * landing on its own: the pull request itself (its description, branches,
 * mergeability, and people) and its conversation, whose reviews say where
 * each reviewer the header draws stands, both asked as the tab is shown;
 * and its checks, as the Checks tab is first shown. What Luke already holds of
 * the pull request, what the agent published, draws the bar, the title, and
 * the Files changed tab's lines at once; each part stands as a skeleton
 * until its read lands, and says so with its own Retry where its read
 * failed, the other parts and the tabs standing. Refresh reads again the
 * header's reads and the checks where their tab was shown, each part drawn
 * standing until its answer lands; an agent with no pull request yet says
 * that.
 *
 * The header stays put while the tab under it scrolls: a bar like a File
 * tab's, wearing the pull request's mark and the word for where it stands,
 * with its doors (Review while it is open, `pull-request-review.tsx`,
 * then GitHub and the ⋯); its title and number; its branches, with the
 * stack it stands in beside them (`pull-request-stack.tsx`); who opened it
 * and when, as the Changes tab names them (`pull-request-people.tsx`), with
 * its reviewers' first faces wearing where each stands, the reviewer and
 * label pickers, and its labels in their GitHub colours
 * (`pull-request-labels.tsx`) at the line's end, so a pull request with no
 * labels spends no line on them; and, while it is open,
 * whether it would merge as it stands, in
 * GitHub's own terms. Under it, a row of tabs, each its glyph, its name,
 * and a quiet count: Conversation, its description and its comments and
 * reviews in time order, as GitHub renders them (`body_html`), drawn
 * through the transcript's own markdown drawing (`GitHubWords`), with an
 * image GitHub serves read through the service on the App's token
 * (`GitHubPicture`) and any other drawn as its link, as ReviewStage/stage
 * draws them; Checks, its head's deployments, the newest of each
 * environment, each opening the address it serves, over every check on its
 * head, those that failed first, then those still running, each opening
 * its page, counted in the colour of how they went; and Files changed (`AgentChangesTab`), its own bar and
 * tree, counted by the lines it adds and removes. A review carries the
 * threads on lines it started, each headed by its file and lines over the
 * end of the hunk it was made on, drawn as Files changed draws a diff with
 * its own lines lit (`file-diff.tsx`), then its comments; one resolved or
 * outdated by a later push is folded closed under its head, which says
 * which, until opened. The description and every comment wear their
 * reactions under their words, as GitHub draws them
 * (`pull-request-reactions.tsx`). Over the conversation, stage-cli's two filters,
 * Hide bots and Hide resolved, each counting what it leaves out and kept
 * across launches (`conversation-filters.ts`). Every name and word here is
 * the repository's, so the tab is left out of the screen recording
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
  NO_MATCHING: "No matching comments.",
  HIDE_BOTS: "Hide bots",
  HIDE_RESOLVED: "Hide resolved",
  /** What Hide bots says it leaves out, by how many. */
  hiddenBots: (count: number) =>
    `Hides ${count} ${count === 1 ? "comment or review" : "comments and reviews"} by bots`,
  /** What Hide resolved says it leaves out, by how many. */
  hiddenResolved: (count: number) =>
    `Hides ${count} resolved review ${count === 1 ? "thread" : "threads"}`,
  /** What the conversation says of the earlier entries a read left on GitHub, by how many. */
  earlier: (count: number) => `${count} earlier ${count === 1 ? "comment" : "comments"} on GitHub`,
  /** What a review thread says of the replies a read left on GitHub, by how many. */
  moreReplies: (count: number) => `${count} more ${count === 1 ? "reply" : "replies"} on GitHub`,
  /** What a thread drawn on its line says of how many comments it holds. */
  commentCount: (count: number) => `${count} ${count === 1 ? "comment" : "comments"}`,
  RESOLVED: "Resolved",
  OUTDATED: "Outdated",
  /** What the folded checks' control says while folded, by how many checks there are in all. */
  showAll: (count: number) => `Show all ${count}`,
  SHOW_LESS: "Show less",
} as const;

/** The lines a review thread is on, as its head names them: where it stands now, else where it was made; none for a thread on the whole file. */
function threadLines(thread: ReviewThread): string | undefined {
  const line = thread.line ?? thread.originalLine;
  const start = thread.line === null ? thread.originalStartLine : thread.startLine;
  if (line === null) return undefined;
  return start === null || start === line ? `line ${line}` : `lines ${start}–${line}`;
}

/** What a review thread's head says of it: that it was resolved, and that a later push outdated it. */
function threadLabels(thread: ReviewThread): readonly string[] {
  return [
    ...(thread.resolved ? [PULL_REQUEST_WORDS.RESOLVED] : []),
    ...(thread.outdated ? [PULL_REQUEST_WORDS.OUTDATED] : []),
  ];
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

/** The tone and glyph a deployment wears, as a check's: ready as passed, deploying as running, failed as failed, and no longer serving as skipped. */
const DEPLOYMENT_TONE = {
  [DEPLOYMENT_STATE.READY]: CHECK_STATE.PASSED,
  [DEPLOYMENT_STATE.PENDING]: CHECK_STATE.PENDING,
  [DEPLOYMENT_STATE.FAILED]: CHECK_STATE.FAILED,
  [DEPLOYMENT_STATE.INACTIVE]: CHECK_STATE.SKIPPED,
} as const satisfies Record<DeploymentState, CheckState>;

/** Where a deployment stands, in the words its row says beside its environment. */
const DEPLOYMENT_WORDS = {
  [DEPLOYMENT_STATE.READY]: "Deployed",
  [DEPLOYMENT_STATE.PENDING]: "Deploying",
  [DEPLOYMENT_STATE.FAILED]: "Failed",
  [DEPLOYMENT_STATE.INACTIVE]: "Inactive",
} as const satisfies Record<DeploymentState, string>;

/** The order the checks' counts are said in, by where each stands: what asks for a look first, as the service lists the checks themselves. */
const CHECK_ORDER: readonly CheckState[] = [
  CHECK_STATE.FAILED,
  CHECK_STATE.PENDING,
  CHECK_STATE.PASSED,
  CHECK_STATE.SKIPPED,
];

/** How many checks stand before the list folds, as stage-cli folds its own; a check that failed or still runs never folds away. */
const CHECKS_UNFOLDED = 5;

/** The size, in CSS pixels, a check's avatar is drawn at (`AVATAR_SIZE.INLINE`), and the density GitHub is asked for it at. */
const CHECK_AVATAR_PIXELS = 16;
const CHECK_AVATAR_DENSITY = 2;

/** The least a check must have run to say how long: a skipped or neutral check, or one cancelled before it began, ran for none. */
const RAN_AT_LEAST_MS = 1_000;

/** How long a check ran, as a working count says it ("42s", "3m 5s", "1h 2m"); none for one still running, never timed, or that ran for no time. */
function durationOf(check: PullRequestCheck): string | undefined {
  if (check.startedAt === null || check.completedAt === null) return undefined;
  const ran = check.completedAt - check.startedAt;
  return ran < RAN_AT_LEAST_MS ? undefined : workingTime(ran);
}

/** How many of the checks, in the order the service ranks them, stand unfolded: the first five, and past them every one that failed or still runs. */
function unfoldedCountOf(checks: readonly PullRequestCheck[]): number {
  const asking = checks.filter(
    (check) => check.state === CHECK_STATE.FAILED || check.state === CHECK_STATE.PENDING,
  ).length;
  return Math.max(CHECKS_UNFOLDED, asking);
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
  const menu = useMenu(true);
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
        <IconButton icon={<EllipsisIcon />} label={label} {...menu.trigger()} />
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
 * and its checks by theirs, the published checks standing only for the
 * pull request they were read on. None while neither has been read.
 */
function barPullRequestOf(
  pullRequest: CodingAgentOverviewPullRequest | undefined,
  checks: CodingAgentOverviewChecks | undefined,
  published: CodingAgentPullRequest | undefined,
): BarPullRequest | undefined {
  const held = pullRequest ?? published;
  if (held === undefined) return undefined;
  const { number, state, url } = held;
  // Note that what was published says the checks of its own pull request only, never of a newer one the overview read.
  const heldChecks = published?.number === number ? published.checks : undefined;
  const summary = checks === undefined ? heldChecks : checksSummaryOf(checks.checks);
  return { number, state, url, checks: summary ?? CHECK_SUMMARY.NONE };
}

/**
 * Who the pull request names as its reviewers, as stage-cli's header names
 * them: where each stands by their reviews, as its conversation's read
 * says, with those it still asks for a review, as its own read says,
 * standing asked whatever they said before, as GitHub shows a re-requested
 * reviewer, save one whose changes asked for still stand; its author left
 * out, and Apps' bots after the people; up to the bound. Until the reviews
 * land, those it asks stand asked.
 */
function reviewersOf(
  requested: readonly CodingAgentOverviewPullRequest["requested"][number][],
  standings: readonly PullRequestReviewer[],
  author: string | undefined,
): readonly PullRequestReviewer[] {
  const by = new Map<string, PullRequestReviewer>();
  for (const reviewer of standings) by.set(reviewer.by.login, reviewer);
  for (const person of requested) {
    if (by.get(person.login)?.state === REVIEW_STATE.CHANGES_REQUESTED) continue;
    by.set(person.login, { by: person, state: REVIEW_STATE.REQUESTED });
  }
  const named = [...by.values()].filter((reviewer) => reviewer.by.login !== author);
  return [
    ...named.filter((reviewer) => !reviewer.by.bot),
    ...named.filter((reviewer) => reviewer.by.bot),
  ].slice(0, CHANGES_BOUNDS.MAX_PEOPLE);
}

/**
 * The bar across the top of the fixed header: the pill saying where the
 * pull request stands, in its colour, as last read of what the agent
 * published until the header's own read lands, which opens the changes
 * that may be made from there (`pull-request-writes.tsx`), and at its end,
 * while the pull request is open, the Review press
 * (`pull-request-review.tsx`), then GitHub's page and the ⋯.
 */
function PullRequestBar({
  published,
  writes,
  review,
  pending,
  reading,
  onRefresh,
}: {
  published: BarPullRequest | undefined;
  writes: PullRequestWrites;
  /** The review's own change, apart from the pill's, so each says its own answer where it was pressed. */
  review: PullRequestWrites;
  /** The member's own pending review, which the Review panel publishes or discards. */
  pending: PendingReview;
  /** Whether a read is out, which a refresh would only repeat. */
  reading: boolean;
  onRefresh: () => void;
}): React.JSX.Element {
  return (
    <div className="file-view-bar pull-request-bar">
      {published === undefined ? null : (
        <>
          <PullRequestStateMenu pullRequest={published} writes={writes} />
          <div className="file-view-actions">
            {published.state === PULL_REQUEST_STATE.OPEN ||
            published.state === PULL_REQUEST_STATE.DRAFT ? (
              <PullRequestReview writes={review} pending={pending} />
            ) : null}
            <Tooltip label="Open on GitHub">
              <IconButton
                icon={<ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />}
                label="Open on GitHub"
                onClick={() => appPlatform().openGitHub(published.url)}
              />
            </Tooltip>
            <PullRequestMenu url={published.url} reading={reading} onRefresh={onRefresh} />
          </div>
        </>
      )}
    </div>
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

/** How the tab reads a picture GitHub names through the service, on the App's token as the agent's (`githubImageOf`). */
function useGitHubImageRead() {
  const { act } = useAct();
  return useCallback(
    (owner: string, address: string) =>
      act(ACT_KIND.CODING_AGENTS_GITHUB_IMAGE, { agentId: owner, src: address }),
    [act],
  );
}

/** A running check's count since it started, moving each second on the window's own clock; a timer to a reader, never announced. */
function RunningTime({ startedAt }: { startedAt: number }): React.JSX.Element | null {
  const now = useWorkingNow();
  if (now === undefined) return null;
  return (
    <span role="timer" aria-live="off">
      {workingTime(now - startedAt)}
    </span>
  );
}

/** The App's square at a check's size: its picture once it loads, and its robot on the quiet tile until then and where there is none. */
function CheckSquare({ name, src }: { name: string; src: string | undefined }): React.JSX.Element {
  return (
    <Avatar
      name={name}
      {...(src === undefined ? {} : { src })}
      glyph={<BotIcon />}
      shape={AVATAR_SHAPE.SQUARE}
      size={AVATAR_SIZE.INLINE}
      tiled
      decorative
    />
  );
}

/** A check's avatar read through the service's image proxy as the agent's, drawn once read and the App's robot until then or where it answered none. */
function ProxiedCheckAvatar({
  agentId,
  name,
  src,
}: {
  agentId: string;
  name: string;
  src: string;
}): React.JSX.Element {
  const state = usePicture(agentId, src, useGitHubImageRead());
  return (
    <CheckSquare name={name} src={state.kind === PICTURE_STATE.READY ? state.url : undefined} />
  );
}

/** The picture of the App that runs a check, or of whoever posted it: one GitHub's avatar host serves drawn as it is, at its size, and any other through the service's image proxy. */
function CheckAvatar({
  agentId,
  name,
  src,
}: {
  agentId: string;
  name: string;
  src: string;
}): React.JSX.Element {
  const hosted = githubAvatarUrl(src);
  if (hosted === undefined) return <ProxiedCheckAvatar agentId={agentId} name={name} src={src} />;
  return (
    <CheckSquare
      name={name}
      src={githubAvatarAt(hosted, CHECK_AVATAR_PIXELS * CHECK_AVATAR_DENSITY)}
    />
  );
}

/** A check's or a deployment's lead: its glyph for where it stands, in that standing's tone, then its App's avatar where it has one. */
function CheckLead({
  tone,
  agentId,
  name,
  avatarUrl,
}: {
  tone: CheckState;
  agentId: string;
  /** Who the avatar is of, the App or what it deploys, which its picture is named by. */
  name: string;
  avatarUrl: string | undefined;
}): React.JSX.Element {
  return (
    <span className="pull-request-check-lead">
      <span className="pull-request-check-glyph" data-check-state={tone}>
        {CHECK_GLYPHS[tone]}
      </span>
      {avatarUrl === undefined ? null : (
        <CheckAvatar agentId={agentId} name={name} src={avatarUrl} />
      )}
    </span>
  );
}

/**
 * One check: its glyph for where it stands, its App's avatar, its name, its
 * App, and how long it ran, counting each second while it runs and is on
 * screen; a press opens its page where it has one. Note that a running
 * count stands only while the Checks tab is shown (`live`), because the
 * tab stays mounted behind `hidden`, and a count left reading the clock
 * there would tick for no one.
 */
function CheckRow({
  agentId,
  check,
  live,
}: {
  agentId: string;
  check: PullRequestCheck;
  live: boolean;
}): React.JSX.Element {
  const openLink = useOpenLink();
  const duration = durationOf(check);
  const { url, avatarUrl, startedAt } = check;
  const running = check.state === CHECK_STATE.PENDING && startedAt !== null;
  return (
    <ListRow
      leading={
        <CheckLead
          tone={check.state}
          agentId={agentId}
          name={check.app ?? check.name}
          avatarUrl={avatarUrl}
        />
      }
      title={
        <>
          {check.name}
          {/* Note that the glyph is the row's decoration, so its words are said here. */}
          <span className="luke-visually-hidden">, {CHECK_WORDS[check.state]}</span>
        </>
      }
      description={check.app ?? undefined}
      meta={running ? live ? <RunningTime startedAt={startedAt} /> : null : duration}
      onPress={url === null ? undefined : () => openLink(url)}
    />
  );
}

/**
 * Every check, in the order the service ranks them, failures first, under a
 * count of each standing. Past five the list folds, as stage-cli's does,
 * behind a control that shows them all and folds them again; a check that
 * failed or still runs stands above the fold however many there are.
 */
function Checks({
  agentId,
  checks,
  live,
}: {
  agentId: string;
  checks: readonly PullRequestCheck[];
  live: boolean;
}): React.JSX.Element {
  const [unfolded, setUnfolded] = useState(false);
  const listId = useId();
  const counts = CHECK_ORDER.flatMap((state) => {
    const count = checks.filter((check) => check.state === state).length;
    return count === 0 ? [] : [`${count} ${CHECK_WORDS[state]}`];
  });
  const folds = checks.length > unfoldedCountOf(checks);
  const shown = folds && !unfolded ? checks.slice(0, unfoldedCountOf(checks)) : checks;
  return (
    <Section title="Checks" count={counts.length === 0 ? undefined : counts.join(", ")}>
      {checks.length === 0 ? (
        <p className="pull-request-quiet pull-request-none">{PULL_REQUEST_WORDS.NO_CHECKS}</p>
      ) : (
        <>
          <div id={listId}>
            <List label="Check list" variant={LIST_VARIANT.CARD} density={LIST_DENSITY.DENSE}>
              {shown.map((check, at) => (
                // Note that two checks may share a name across Apps, so a row is keyed by its place too.
                <CheckRow key={`${at}`} agentId={agentId} check={check} live={live} />
              ))}
            </List>
          </div>
          {folds ? (
            <Button
              aria-expanded={unfolded}
              aria-controls={listId}
              onClick={() => setUnfolded((was) => !was)}
            >
              {unfolded ? PULL_REQUEST_WORDS.SHOW_LESS : PULL_REQUEST_WORDS.showAll(checks.length)}
            </Button>
          ) : null}
        </>
      )}
    </Section>
  );
}

/** Whether the pull request would merge as it stands, in its tone's colour; drawn only while it is open. */
function MergeLine({
  pullRequest,
  actions,
}: {
  pullRequest: CodingAgentOverviewPullRequest;
  /** The merge box's presses at the line's end (`merge-box.tsx`). */
  actions: ReactNode;
}): React.JSX.Element {
  const { line, tone } = mergeWords(pullRequest.merge, pullRequest.base);
  const blocked =
    pullRequest.merge === MERGE_STATE.BLOCKED ? blockedWords(pullRequest.merging) : undefined;
  return (
    <div className="pull-request-merge" data-merge-tone={tone}>
      {tone === MERGE_TONE.READY ? <CheckIcon aria-hidden="true" /> : null}
      {tone === MERGE_TONE.BLOCKED ? <XIcon aria-hidden="true" /> : null}
      {tone === MERGE_TONE.WAITING ? <CircleDotIcon aria-hidden="true" /> : null}
      <span className="pull-request-merge-words">{blocked ?? line}</span>
      {actions}
    </div>
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
    <SkeletonRegion label={label}>
      <div className={className ? `pull-request-skeleton ${className}` : "pull-request-skeleton"}>
        {widths.map((width, at) => (
          // oxlint-disable-next-line react/no-array-index-key -- a skeleton's blocks never move.
          <Skeleton key={at} width={width} />
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** A part whose read failed: its sentence and its own Retry, where the part would have stood. */
function PartFailure({ line, onRetry }: { line: string; onRetry: () => void }): React.JSX.Element {
  return (
    <div className="pull-request-failure">
      <ErrorState onRetry={onRetry}>{line}</ErrorState>
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
  const state = usePicture(agentId, src, useGitHubImageRead());
  if (state.kind === PICTURE_STATE.READY) {
    return <img className="pull-request-picture" src={state.url} alt={alt} />;
  }
  if (state.kind === PICTURE_STATE.READING) {
    return (
      <span className="pull-request-picture-waiting" role="img" aria-label={alt}>
        <Skeleton shape={SKELETON_SHAPE.BLOCK} />
      </span>
    );
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
  const look = { ...useDiffLook(false), inlineDiff: INLINE_DIFF.NONE };
  const preview = threadPreview(thread);
  const lines = threadLines(thread);
  const labels = threadLabels(thread);
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
            <Badge key={label}>{label}</Badge>
          ))}
          <span className="pull-request-thread-turn">
            <DisclosureChevron />
          </span>
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
          <ThreadComments thread={thread} now={now} picture={picture} />
        </FoldBody>
      </Fold>
    </li>
  );
}

/** A review thread's comments, oldest first, as the conversation draws an entry, with the replies a read left on GitHub counted after them, then its Reply and Resolve (`pull-request-thread-actions.tsx`), wherever the thread is drawn. */
function ThreadComments({
  thread,
  now,
  picture,
}: {
  thread: ReviewThread;
  now: number;
  picture: GitHubPictureDrawer;
}): React.JSX.Element {
  const openLink = useOpenLink();
  const last = thread.comments.at(-1);
  return (
    <>
      <ol className="pull-request-thread-comments">
        {thread.comments.map((comment) => (
          <li key={comment.url} className="pull-request-thread-comment">
            <span className="changes-comment-head">
              <PersonRef person={comment.by} />
              <RelativeTime className="changes-comment-time" at={comment.at} now={now} />
            </span>
            <EntryWords entry={comment} picture={picture} />
            <Reactions reactions={comment.reactions} subject={comment.subject} />
          </li>
        ))}
      </ol>
      {thread.more === 0 || last === undefined ? null : (
        <p className="pull-request-more pull-request-thread-more">
          <TextButton tone={TEXT_BUTTON_TONE.LINK} onClick={() => openLink(last.url)}>
            {PULL_REQUEST_WORDS.moreReplies(thread.more)}
          </TextButton>
        </p>
      )}
      <ThreadActions thread={thread} />
    </>
  );
}

/**
 * A review thread drawn on its line in Files changed, as GitHub's own diff
 * draws one: whether it was resolved or a later push outdated it, at its
 * head, which folds it closed until opened; then its comments. An outdated
 * one, whose line is gone, names the line it was made on. Minimize inline
 * comments draws a line's threads as a chip instead (`minimized-threads.tsx`).
 */
function InlineThread({
  thread,
  place,
  now,
  picture,
}: {
  thread: ReviewThread;
  /** Under its line, or above the diff, where it names the lines it is on. */
  place: ThreadPlace;
  now: number;
  picture: GitHubPictureDrawer;
}): React.JSX.Element {
  const labels = threadLabels(thread);
  const lines = place === THREAD_PLACE.ABOVE ? threadLines(thread) : undefined;
  const first = thread.comments[0];
  return (
    <div className="diff-inline-thread">
      <Fold defaultOpen={labels.length === 0}>
        <FoldSummary className="pull-request-thread-head">
          {first === undefined ? null : <PersonRef person={first.by} />}
          {lines === undefined ? null : <span className="pull-request-quiet">{lines}</span>}
          {labels.map((label) => (
            <span key={label} className="pull-request-thread-label">
              {label}
            </span>
          ))}
          <span className="pull-request-quiet">
            {PULL_REQUEST_WORDS.commentCount(thread.comments.length + thread.more)}
          </span>
          <span className="pull-request-thread-turn">
            <DisclosureChevron />
          </span>
        </FoldSummary>
        <FoldBody>
          <ThreadComments thread={thread} now={now} picture={picture} />
        </FoldBody>
      </Fold>
    </div>
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
      <Reactions reactions={entry.reactions} subject={entry.subject} />
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

/** Under the title: the branches and the stack it stands in, who opened it and when, its reviewers, the pickers and its labels, and, while it is open, whether it merges; a skeleton while its read is out, and its failure with Retry. */
function PullRequestHead({
  parts,
  now,
  repository,
  shown,
  writes,
  editing,
}: {
  parts: OverviewParts;
  now: number;
  /** The agent's repository, which the merge box keeps the method chosen by. */
  repository: string | null;
  /** Whether the panel is on screen, which a merge asked about goes with. */
  shown: boolean;
  writes: PullRequestWrites;
  /** What the reviewer and label pickers read, and whether the pull request is being read again after a change. */
  editing: { readonly options: ReviewOptions; readonly refreshing: boolean };
}): React.JSX.Element {
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
  const reviewers = reviewersOf(
    pullRequest.requested,
    landed(conversation)?.reviewers ?? [],
    author?.login,
  );
  const open =
    pullRequest.state === PULL_REQUEST_STATE.OPEN || pullRequest.state === PULL_REQUEST_STATE.DRAFT;
  return (
    <>
      <div className="pull-request-branch-row">
        <Tooltip label={`${pullRequest.head} into ${pullRequest.base}`}>
          <p className="pull-request-branches">
            <bdi>{pullRequest.base}</bdi>
            {" ← "}
            <bdi>{pullRequest.head}</bdi>
          </p>
        </Tooltip>
        <PullRequestStack stack={pullRequest.stack ?? []} number={pullRequest.number} />
      </div>
      <div className="changes-people pull-request-people">
        {author === undefined ? null : <OpenedBy person={author} />}
        {/* Note that a merged one says when it merged, which is the moment that matters once it has. */}
        <span className="pull-request-quiet">
          {mergedAt === null ? null : "Merged "}
          <RelativeTime at={mergedAt ?? pullRequest.createdAt} now={now} ago />
        </span>
        <span className="pull-request-reviewers">
          {reviewers.length === 0 ? null : <HeaderReviewers reviewers={reviewers} />}
          {open ? (
            <ReviewerPicker
              author={author?.login}
              requested={pullRequest.requested}
              requestedTeams={pullRequest.requestedTeams ?? []}
              writes={writes}
              {...editing}
            />
          ) : null}
          <LabelPicker labels={pullRequest.labels ?? []} writes={writes} {...editing} />
        </span>
        <PullRequestLabels labels={pullRequest.labels ?? []} />
      </div>
      {open ? (
        <MergeLine
          pullRequest={pullRequest}
          actions={
            <MergeActions
              pullRequest={pullRequest}
              repository={repository}
              shown={shown}
              writes={writes}
            />
          }
        />
      ) : null}
    </>
  );
}

/** One deployment: its glyph for where it stands, its App's avatar, its environment and where it stands in words; a press opens the address it serves, where it names one. */
function DeploymentRow({
  agentId,
  deployment,
}: {
  agentId: string;
  deployment: PullRequestDeployment;
}): React.JSX.Element {
  const openLink = useOpenLink();
  const { url, avatarUrl, state } = deployment;
  return (
    <ListRow
      leading={
        <CheckLead
          tone={DEPLOYMENT_TONE[state]}
          agentId={agentId}
          name={deployment.environment}
          avatarUrl={avatarUrl}
        />
      }
      title={deployment.environment}
      description={DEPLOYMENT_WORDS[state]}
      meta={
        url === null ? null : (
          <span className="pull-request-deployment-open">
            <ExternalLinkIcon aria-hidden="true" />
          </span>
        )
      }
      onPress={url === null ? undefined : () => openLink(url)}
    />
  );
}

/** The head's deployments, such as its Vercel Previews, the newest of each environment first, each opening the address it serves; nothing where it has none. */
function Deployments({
  agentId,
  deployments,
}: {
  agentId: string;
  deployments: readonly PullRequestDeployment[];
}): React.JSX.Element | null {
  if (deployments.length === 0) return null;
  return (
    <Section title="Deployments" count={deployments.length.toLocaleString()}>
      <List label="Deployment list" variant={LIST_VARIANT.CARD} density={LIST_DENSITY.DENSE}>
        {deployments.map((deployment) => (
          <DeploymentRow key={deployment.environment} agentId={agentId} deployment={deployment} />
        ))}
      </List>
    </Section>
  );
}

/** The checks section as its read stands: every check once landed, its running counts moving while the tab is shown (`live`), a skeleton of rows while out, its failure with Retry. */
function ChecksPart({
  agentId,
  parts,
  live,
}: {
  agentId: string;
  parts: OverviewParts;
  live: boolean;
}): React.JSX.Element {
  const part = parts.checks;
  if (part.kind === PART.LANDED) {
    return (
      <>
        <Deployments agentId={agentId} deployments={part.value.deployments ?? []} />
        <Checks agentId={agentId} checks={part.value.checks} live={live} />
      </>
    );
  }
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

/** The description, as the pull request's read carries it, with the reactions it wears once the conversation's read, which carries them, lands; a skeleton while its read is out, and nothing where it failed, whose failure stands under the title. */
function DescriptionPart({
  part,
  reactions,
  subject,
  picture,
}: {
  part: Part<CodingAgentOverviewPullRequest>;
  reactions: readonly ReactionGroup[] | undefined;
  /** The GraphQL id a reaction is given to the description by, which the conversation's read names. */
  subject: string | undefined;
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
      {part.kind === PART.PENDING ? null : <Reactions reactions={reactions} subject={subject} />}
    </Section>
  );
}

/** The conversation as its read stands: its entries once landed, as the filters leave them, the earlier ones counted first; a skeleton while out, its failure with Retry. */
function ConversationPart({
  parts,
  filters,
  url,
  now,
  picture,
}: {
  parts: OverviewParts;
  filters: ConversationFiltersControl["filters"];
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
  const shown = filteredConversation(conversation, filters);
  return (
    <Section
      title="Conversation"
      count={earlier + conversation.length === 0 ? undefined : earlier + conversation.length}
    >
      {/* The earlier entries a read left on GitHub are counted where they would stand, first. */}
      {earlier === 0 || url === undefined ? null : (
        <p className="pull-request-more pull-request-earlier">
          <TextButton tone={TEXT_BUTTON_TONE.LINK} onClick={() => openLink(url)}>
            {PULL_REQUEST_WORDS.earlier(earlier)}
          </TextButton>
        </p>
      )}
      {conversation.length === 0 ? (
        earlier === 0 ? (
          <p className="pull-request-quiet pull-request-none">
            {PULL_REQUEST_WORDS.NO_CONVERSATION}
          </p>
        ) : null
      ) : shown.length === 0 ? (
        <p className="pull-request-quiet pull-request-none">{PULL_REQUEST_WORDS.NO_MATCHING}</p>
      ) : (
        <ol className="pull-request-conversation">
          {shown.map((entry) => (
            <EntryCard key={entry.url} entry={entry} now={now} picture={picture} />
          ))}
        </ol>
      )}
    </Section>
  );
}

/** The fixed header's title and number, as the pull request's read says or, until it lands, as Luke held them; a skeleton where neither has. */
function HeaderTitle({
  title,
  writes,
}: {
  title: Pick<CodingAgentPullRequest, "title" | "number"> | undefined;
  writes: PullRequestWrites;
}): React.JSX.Element {
  if (title === undefined) {
    return (
      <PartSkeleton
        label={PULL_REQUEST_WORDS.READING}
        widths={["60%"]}
        className="pull-request-title"
      />
    );
  }
  return (
    <PullRequestTitle title={title.title} number={pullRequestNumberLabel(title)} writes={writes} />
  );
}

/** How many checks the Checks tab's glyph counts: those that failed beside a failure, those still running beside a wait, and every one where all passed. */
function summaryCountOf(checks: readonly PullRequestCheck[], summary: CheckSummary): number {
  if (summary === CHECK_SUMMARY.FAILING) {
    return checks.filter((check) => check.state === CHECK_STATE.FAILED).length;
  }
  if (summary === CHECK_SUMMARY.PENDING) {
    return checks.filter((check) => check.state === CHECK_STATE.PENDING).length;
  }
  return checks.length;
}

/** The glyph the Checks tab wears for how its checks went, as the pull request's mark tells it; none where there are none. */
const SUMMARY_GLYPHS = {
  [CHECK_SUMMARY.FAILING]: <XIcon />,
  [CHECK_SUMMARY.PENDING]: <CircleDotIcon />,
  [CHECK_SUMMARY.PASSING]: <CheckIcon />,
  [CHECK_SUMMARY.NONE]: null,
} as const satisfies Record<CheckSummary, ReactNode>;

/** How the checks went, in the words the Checks tab's glyph says to a reader who cannot see it. */
const SUMMARY_WORDS = {
  [CHECK_SUMMARY.FAILING]: "failing",
  [CHECK_SUMMARY.PENDING]: "running",
  [CHECK_SUMMARY.PASSING]: "passing",
  [CHECK_SUMMARY.NONE]: "none",
} as const satisfies Record<CheckSummary, string>;

/** The tone the Checks tab's count takes for how its checks went, as its glyph does. */
const SUMMARY_TONES = {
  [CHECK_SUMMARY.FAILING]: TAB_COUNT_TONE.DANGER,
  [CHECK_SUMMARY.PENDING]: TAB_COUNT_TONE.ATTENTION,
  [CHECK_SUMMARY.PASSING]: TAB_COUNT_TONE.COMPLETE,
  [CHECK_SUMMARY.NONE]: TAB_COUNT_TONE.QUIET,
} as const satisfies Record<CheckSummary, TabCountTone>;

/** What the Checks tab counts: how they went in its colour from the first frame, and how many once read; nothing where neither stands. */
function checksCount(summary: CheckSummary, count: number | undefined): ReactNode {
  const glyph = SUMMARY_GLYPHS[summary];
  if (glyph === null && count === undefined) return undefined;
  return (
    <TabCount
      tone={SUMMARY_TONES[summary]}
      {...(glyph === null ? {} : { glyph, glyphLabel: SUMMARY_WORDS[summary] })}
    >
      {count?.toLocaleString()}
    </TabCount>
  );
}

/** How many entries the Conversation tab counts: its comments and reviews, the earlier ones left on GitHub, and every review thread. */
function conversationCount(conversation: CodingAgentOverviewConversation): number {
  const threads = conversation.conversation.reduce(
    (sum, entry) => sum + (entry.threads?.length ?? 0),
    0,
  );
  return conversation.earlier + conversation.conversation.length + threads;
}

/**
 * The three tabs under the header, each counting what Luke has read of it
 * so far: the conversation once read; the checks by how they went from the
 * first frame, as the bar's mark says it, and by how many once read; and
 * the files by the lines what was published adds and removes.
 */
function tabsOf(
  parts: OverviewParts,
  published: CodingAgentPullRequest | undefined,
  bar: BarPullRequest | undefined,
): readonly TabItem<PullRequestView>[] {
  const conversation = landed(parts.conversation);
  const checks = landed(parts.checks);
  return [
    {
      value: PULL_REQUEST_VIEW.CONVERSATION,
      icon: <MessagesSquareIcon />,
      label: "Conversation",
      count:
        conversation === undefined ? undefined : conversationCount(conversation).toLocaleString(),
    },
    {
      value: PULL_REQUEST_VIEW.CHECKS,
      icon: <CircleCheckIcon />,
      label: "Checks",
      count:
        bar === undefined
          ? undefined
          : checksCount(
              bar.checks,
              checks === undefined ? undefined : summaryCountOf(checks.checks, bar.checks),
            ),
    },
    {
      value: PULL_REQUEST_VIEW.FILES,
      icon: <FileDiffIcon />,
      label: "Files changed",
      count:
        published === undefined ? undefined : (
          <CountParts parts={linesCount(published.additions, published.deletions)} />
        ),
    },
  ];
}

/** One of the conversation's filters: its word, how many it would leave out once the conversation is read, and its switch, the word and the count pressing it too. */
function ConversationFilter({
  label,
  count,
  describe,
  on,
  onChange,
}: {
  label: string;
  /** How many it would leave out; none until the conversation is read. */
  count: number | undefined;
  describe: (count: number) => string;
  on: boolean;
  onChange: (on: boolean) => void;
}): React.JSX.Element {
  const switchId = useId();
  const noteId = useId();
  const note = count === undefined ? undefined : describe(count);
  const filter = (
    <span className="pull-request-filter">
      {/* Note that the word and the count label the switch, so a press on either turns it too. */}
      <label htmlFor={switchId}>
        {label}
        {count === undefined ? null : (
          <span className="pull-request-count" aria-hidden="true">
            {count.toLocaleString()}
          </span>
        )}
      </label>
      <Switch
        id={switchId}
        checked={on}
        label={label}
        describedBy={note === undefined ? undefined : noteId}
        onChange={onChange}
      />
      {note === undefined ? null : (
        <span id={noteId} hidden>
          {note}
        </span>
      )}
    </span>
  );
  return note === undefined ? filter : <Tooltip label={note}>{filter}</Tooltip>;
}

/** The row over the conversation that stays put while it scrolls: Hide resolved and Hide bots, as stage-cli orders them, each counting what it leaves out once read. */
function ConversationFilterRow({
  control,
  hidden,
}: {
  control: ConversationFiltersControl;
  hidden: ConversationHidden | undefined;
}): React.JSX.Element {
  const { filters, change } = control;
  return (
    <div className="pull-request-filters">
      <ConversationFilter
        label={PULL_REQUEST_WORDS.HIDE_RESOLVED}
        count={hidden?.resolved}
        describe={PULL_REQUEST_WORDS.hiddenResolved}
        on={filters.hideResolved}
        onChange={(hideResolved) => change({ hideResolved })}
      />
      <ConversationFilter
        label={PULL_REQUEST_WORDS.HIDE_BOTS}
        count={hidden?.bots}
        describe={PULL_REQUEST_WORDS.hiddenBots}
        on={filters.hideBots}
        onChange={(hideBots) => change({ hideBots })}
      />
    </div>
  );
}

/** The Conversation tab: its filters, then the description, then the comments, reviews, and threads, in one scroll under them, and, once the conversation is read, the box a new comment is written in at its foot. */
function ConversationView({
  agentId,
  parts,
  url,
  comment,
}: {
  agentId: string;
  parts: OverviewParts;
  url: string | undefined;
  /** The comment box's words and its own change, held by the tab so the box may come and go. */
  comment: PullRequestComment;
}): React.JSX.Element {
  const now = useMinute();
  const picture = usePictureDrawer(agentId);
  const filters = useConversationFilters();
  const conversation = landed(parts.conversation)?.conversation;
  return (
    <DetailPage
      frame={PAGE_FRAME.TOOLBAR}
      label="Pull request conversation"
      inset={DETAIL_PAGE_INSET.READING}
      toolbar={
        <ConversationFilterRow
          control={filters}
          hidden={conversation === undefined ? undefined : conversationHidden(conversation)}
        />
      }
    >
      <DescriptionPart
        part={parts.pullRequest}
        reactions={landed(parts.conversation)?.descriptionReactions}
        subject={landed(parts.conversation)?.descriptionSubject}
        picture={picture}
      />
      <ConversationPart
        parts={parts}
        filters={filters.filters}
        url={url}
        now={now}
        picture={picture}
      />
      {conversation === undefined ? null : <PullRequestCommentBox comment={comment} />}
    </DetailPage>
  );
}

/** One of the overview's reads, as `useAgentRead` holds it, and whether it has been asked yet. */
function askedYet(read: { readonly answer: unknown; readonly out: boolean }): boolean {
  return read.answer !== undefined || read.out;
}

/** Every review thread a read's conversation holds, in its order; none before a read lands or where it failed. */
function reviewThreadsOf(
  conversation: CodingAgentOverviewConversation | undefined,
): readonly ReviewThread[] {
  return conversation?.conversation.flatMap((entry) => entry.threads ?? []) ?? [];
}

/**
 * One agent's Pull request tab, laid out as stage-cli's pull request page:
 * a fixed header that stays put while what is under it scrolls (the bar
 * with the pill saying where it stands and GitHub's page and the ⋯; its
 * title and number; its branches; who opened it and when, and its
 * reviewers; and, while it is open, whether it would merge), then a row of
 * tabs, Conversation, Checks, and Files changed (`AgentChangesTab`), each
 * with its count. Each tab stands once shown, the others hidden, so
 * switching draws what each last read rather than asking GitHub again. The
 * header's reads, the pull request and its conversation, whose reviews say
 * where each reviewer stands, are asked as the tab is shown; the checks and
 * the files as their tab is first shown. Only a read saying there is no
 * pull request yet takes the header and the tabs away; a read that failed
 * says so in its own part, with its own Retry, the others standing. Files
 * changed draws the conversation's review threads on their lines.
 */
export function AgentPullRequestTab(props: AgentPullRequestTabProps): React.JSX.Element {
  // Note that the number is handed down before any of the tab's own hooks run, its writes among them.
  return (
    <PullRequestNumberProvider value={props.number}>
      <PullRequestTabBody {...props} />
    </PullRequestNumberProvider>
  );
}

interface AgentPullRequestTabProps {
  agentId: string;
  /** The pull request of the agent's repository the tab shows by its number, where it is not the one from the agent's branch (`pull-request-number.ts`); none shows the agent's own. */
  number?: number | undefined;
  control: CodingAgentsControl;
  /** Whether the panel is on screen, which is when the tab reads. */
  shown: boolean;
  /** The plan's repository, which the files' breadcrumbs name; none names the path plain. */
  repository: string | null;
  /** Whether the tree beside File tabs and the files is open, and its toggle. */
  tree: TreeShown;
  view: PullRequestView;
  onView: (view: PullRequestView) => void;
}

/** The Pull request tab under the number it names (`AgentPullRequestTab`). */
function PullRequestTabBody({
  agentId,
  number,
  control,
  shown,
  repository,
  tree,
  view,
  onView,
}: AgentPullRequestTabProps): React.JSX.Element {
  const status = control.agents?.find((each) => each.id === agentId)?.status;
  const ended = !agentStillWriting(status ?? CODING_AGENT_STATUS.RUNNING);
  const id = useId();
  const ids = (each: PullRequestView) => ({
    tab: `${id}-${each}-tab`,
    panel: `${id}-${each}-panel`,
  });
  // The header's reads are asked as the tab is shown, the conversation among them for where its reviewers stand; the checks as their tab is first shown.
  const pullRequestRead = useAgentRead(
    agentId,
    shown,
    ended,
    (id: string) => control.readOverviewPullRequest(id, number),
    UNANSWERED,
  );
  const conversationRead = useAgentRead(
    agentId,
    shown,
    ended,
    (id: string) => control.readOverviewConversation(id, number),
    UNANSWERED,
  );
  const checksRead = useAgentRead(
    agentId,
    shown && view === PULL_REQUEST_VIEW.CHECKS,
    ended,
    (id: string) => control.readOverviewChecks(id, number),
    UNANSWERED,
  );
  const ask = {
    pullRequest: pullRequestRead.ask,
    checks: checksRead.ask,
    conversation: conversationRead.ask,
  };
  // Refresh reads again the header's reads and the checks where their tab was shown, never before,
  // and what the agent published, which names this tab and its pin by the pull request's title.
  const refresh = () => {
    ask.pullRequest();
    ask.conversation();
    if (askedYet(checksRead)) ask.checks();
    const read =
      number === undefined
        ? control.readPullRequest(agentId)
        : control.readNumberedPullRequest(agentId, number);
    void read.catch(() => undefined);
  };
  const parts: OverviewParts = {
    pullRequest: partOf(pullRequestRead),
    checks: partOf(checksRead),
    conversation: partOf(conversationRead),
    ask,
  };
  const reading = pullRequestRead.out || checksRead.out || conversationRead.out;
  const published = pullRequestOfTab(control, { changes: agentId, number });
  const bar = barPullRequestOf(landed(parts.pullRequest), landed(parts.checks), published);
  const none = [parts.pullRequest, parts.checks, parts.conversation].some(
    (part) => part.kind === PART.NONE,
  );
  const title = landed(parts.pullRequest) ?? published;
  const now = useMinute();
  // A change is read back as Refresh reads: the tab, and what the agent published, which the plan's own marks draw.
  const written = refresh;
  const writes = usePullRequestWrites(agentId, written);
  const review = usePullRequestWrites(agentId, written);
  // The member's own pending review, read beside the conversation, which names what Review and a comment on lines offer.
  const pendingReview = landed(parts.conversation)?.pendingReview;
  const picture = usePictureDrawer(agentId);
  const comment = usePullRequestComment(agentId, written);
  const options = useReviewOptions(agentId, control.readReviewOptions);
  // Note that Files changed is handed the same threads while the conversation
  // and the minute stand, because a file a thread is on draws its notes anew
  // for new ones.
  const conversation = landed(parts.conversation);
  const threadList = useMemo(() => reviewThreadsOf(conversation), [conversation]);
  const drawThread = useCallback<ChangesThreads["draw"]>(
    (thread, place) => <InlineThread thread={thread} place={place} now={now} picture={picture} />,
    [now, picture],
  );
  const changesThreads = useMemo<ChangesThreads>(
    () => ({ list: threadList, draw: drawThread, refresh: conversationRead.ask }),
    [threadList, drawThread, conversationRead.ask],
  );
  // Every review thread the tab draws, in the Conversation or on its line, replies and resolves on this agent's pull request.
  return (
    <ThreadWritesProvider value={{ agentId, onWritten: written }}>
      <div className="file-view pull-request-tab ph-no-capture">
        <PullRequestBar
          published={bar}
          writes={writes}
          review={review}
          pending={pendingReview}
          reading={reading}
          onRefresh={refresh}
        />
        <PullRequestWriteNote writes={writes} />
        {none ? (
          <EmptyState icon={<GitPullRequestIcon />}>
            {PULL_REQUEST_WORDS.NO_PULL_REQUEST}
          </EmptyState>
        ) : (
          <>
            <header className="pull-request-header">
              <HeaderTitle title={title} writes={writes} />
              <PullRequestHead
                parts={parts}
                now={now}
                repository={repository}
                shown={shown}
                writes={writes}
                editing={{ options, refreshing: pullRequestRead.out }}
              />
            </header>
            <div className="pull-request-tabs">
              <Tabs<PullRequestView>
                label="Pull request"
                tabs={tabsOf(parts, published, bar)}
                value={view}
                onChange={onView}
                ids={ids}
                inset={TABS_INSET.READING}
              />
            </div>
            <div
              className="pull-request-view"
              role="tabpanel"
              id={ids(PULL_REQUEST_VIEW.CONVERSATION).panel}
              aria-labelledby={ids(PULL_REQUEST_VIEW.CONVERSATION).tab}
              hidden={view !== PULL_REQUEST_VIEW.CONVERSATION}
            >
              <ConversationView
                agentId={agentId}
                parts={parts}
                url={title?.url}
                comment={comment}
              />
            </div>
            <div
              className="pull-request-view"
              role="tabpanel"
              id={ids(PULL_REQUEST_VIEW.CHECKS).panel}
              aria-labelledby={ids(PULL_REQUEST_VIEW.CHECKS).tab}
              hidden={view !== PULL_REQUEST_VIEW.CHECKS}
            >
              <DetailPage
                frame={PAGE_FRAME.TOOLBAR}
                label="Pull request checks"
                inset={DETAIL_PAGE_INSET.READING}
              >
                <ChecksPart
                  agentId={agentId}
                  parts={parts}
                  live={shown && view === PULL_REQUEST_VIEW.CHECKS}
                />
              </DetailPage>
            </div>
          </>
        )}
        <div
          className="pull-request-view"
          role="tabpanel"
          id={ids(PULL_REQUEST_VIEW.FILES).panel}
          aria-labelledby={ids(PULL_REQUEST_VIEW.FILES).tab}
          hidden={none || view !== PULL_REQUEST_VIEW.FILES}
        >
          <AgentChangesTab
            agentId={agentId}
            control={control}
            shown={shown && !none && view === PULL_REQUEST_VIEW.FILES}
            repository={repository}
            tree={tree}
            threads={changesThreads}
            lineComments={{ pending: pendingReview, onWritten: written }}
          />
        </div>
      </div>
    </ThreadWritesProvider>
  );
}

/**
 * The pull request a Pull request tab shows, as the task's agents last read
 * it: the one it names by its number, kept apart (`numberedPullRequests`),
 * else its agent's own; none before it is read.
 */
export function pullRequestOfTab(
  control: Pick<CodingAgentsControl, "pullRequests" | "numberedPullRequests">,
  tab: { readonly changes: string; readonly number?: number | undefined },
): CodingAgentPullRequest | undefined {
  return tab.number === undefined
    ? control.pullRequests.get(tab.changes)
    : ofPullRequestTab(control.numberedPullRequests, tab);
}
