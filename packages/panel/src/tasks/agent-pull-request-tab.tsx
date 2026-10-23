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
  type PendingReviewComment,
  PULL_REQUEST_STATE,
  type PullRequestCheck,
  type PullRequestDeployment,
  type PullRequestReviewer,
  REVIEW_STATE,
  type ReactionGroup,
  type ReviewThread,
} from "@luke/features/coding-agent-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import {
  LINK_PLACE,
  type LinkPlace,
  PULL_REQUEST_THREAD_VIEW,
  type PullRequestThreadView,
} from "@luke/features/luke-link";
import { INLINE_DIFF } from "@luke/settings/diff-view";
import {
  AVATAR_SHAPE,
  AVATAR_SIZE,
  Avatar,
  BLOCK_LIST_ELEMENT,
  BlockList,
  BlockListItem,
  BUTTON_VARIANT,
  Button,
  CHIP_LOOK,
  CHOICE_BAR_FOLD,
  CHOICE_BAR_LOOK,
  Chip,
  ChipCount,
  ChipName,
  ChoiceBar,
  type ChoiceItem,
  COUNT_TONE,
  type CountPart,
  type CountTone,
  DETAIL_PAGE_INSET,
  DetailPage,
  DISCLOSURE_SUMMARY,
  DisclosureAction,
  DisclosureChevron,
  DisclosureSummary,
  EmptyState,
  ErrorState,
  Fill,
  GAP,
  IconButton,
  LAYOUT_ELEMENT,
  LINE_BUTTON_LOOK,
  LIST_DENSITY,
  LIST_VARIANT,
  LineButton,
  List,
  ListRow,
  linesCount,
  PAGE_FRAME,
  ProviderMark,
  SCROLL_FADE,
  SCROLL_FADE_INSET,
  SCROLL_GUTTER,
  ScrollArea,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
  SpinnerRegion,
  Stack,
  TEXT_BUTTON_TONE,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  TextButton,
  TIME_LOOK,
  Time,
  Tooltip,
  useMenu,
  useMinute,
  VisuallyHidden,
} from "@luke/ui";
import { actorName } from "@luke/ui/actor-model";
import { PICTURE_STATE, usePicture } from "@luke/ui/picture-cache";
import { formatLocaleCount, workingTime } from "@luke/ui/time-format";
import {
  BookOpenIcon,
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
  PlayIcon,
  RotateCwIcon,
  ScanSearchIcon,
  XIcon,
} from "lucide-react";
import {
  type ComponentProps,
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ACTOR_SIZE, ActorMark, ActorRef } from "../actor-ref.js";
import { Fold, FoldBody } from "../ai-elements/fold.js";
import { appPlatform } from "../app-platform.js";
import { useCopyLinkItem } from "../copy-link-item.js";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { type HandTabActions, useHandedTabActions } from "../desktop/strip-tabs.js";
import { SHELL_ROOM } from "../shell-room.js";
import { ShellRoomContext } from "../stage-room.js";
import { TOAST_HOLD, TOAST_TONE, useToast } from "../toast.js";
import {
  AgentChangesTab,
  type ChangesReads,
  type ChangesReveal,
  type ChangesThreads,
  THREAD_PLACE,
  type ThreadPlace,
  useAgentRead,
  useChangesReads,
} from "./agent-changes-tab.js";
import {
  ANNOTATION_TONE,
  AnnotationCard,
  AnnotationComment,
  AnnotationComments,
  type AnnotationState,
} from "./annotation-card.js";
import { threadPreview } from "./changes-model.js";
import { type ChaptersRead, chaptersCount, useChaptersRead } from "./chapters-read.js";
import { scrollerOf } from "./code-pane.js";
import { agentStillWriting, pullRequestNumberLabel } from "./coding-agent-model.js";
import {
  type ConversationFilters,
  type ConversationFiltersControl,
  type ConversationHidden,
  conversationHidden,
  filteredConversation,
  useConversationFilters,
} from "./conversation-filters.js";
import { PierreDiff, useDiffLook } from "./file-diff.js";
import type { TreeShown } from "./file-view.js";
import { MergeControl } from "./merge-box.js";
import {
  PENDING_WORDS,
  PendingBadge,
  PendingComment,
  type PendingComments,
  PendingCommentsProvider,
  PendingSurfaceProvider,
  pendingThreadsOf,
  usePendingComment,
  usePendingThread,
} from "./pending-comments.js";
import { ANCHOR_KIND, anchorIn } from "./pull-request-anchors.js";
import { PullRequestBranches } from "./pull-request-branches.js";
import {
  type PullRequestComment,
  PullRequestCommentBox,
  usePullRequestComment,
} from "./pull-request-comment-box.js";
import { PullRequestLabels } from "./pull-request-labels.js";
import { PullRequestNumberProvider, pullRequestOfTab } from "./pull-request-number.js";
import {
  HeaderReviewers,
  OpenedLine,
  PersonRef,
  ReviewStanding,
  useNamer,
} from "./pull-request-people.js";
import {
  LabelPicker,
  ReviewerPicker,
  type ReviewOptions,
  useReviewOptions,
} from "./pull-request-pickers.js";
import { EntryPictures, useGitHubImageRead, usePictureDrawer } from "./pull-request-pictures.js";
import { Reactions } from "./pull-request-reactions.js";
import { PullRequestReview } from "./pull-request-review.js";
import { PullRequestStack } from "./pull-request-stack.js";
import { ThreadActions, ThreadWritesProvider } from "./pull-request-thread-actions.js";
import {
  PullRequestStateMenu,
  PullRequestTitle,
  PullRequestTitleLine,
  PullRequestWriteNote,
  type PullRequestWrites,
  usePullRequestWrites,
} from "./pull-request-writes.js";
import {
  THREAD_REVEAL_WORDS,
  type ThreadLanding,
  ThreadLandingProvider,
  useLandedEntry,
  useLandedThread,
  useWindowThreadReveal,
} from "./thread-reveal.js";
import { type GitHubPictureDrawer, GitHubWords, TranscriptWords } from "./transcript-blocks.js";
import type { CodingAgentsControl } from "./use-coding-agents.js";
import { type OpenHere, OpenHereFirst, useOpenLink, useOpenPlace } from "./use-open-link.js";
import { PULL_REQUEST_VIEW, type PullRequestView } from "./use-side-panel.js";

/**
 * agent-pull-request-tab.tsx -- one agent's Pull request tab in the side panel: its pull request as GitHub holds it, laid out as stage-cli's pull request page: a fixed header, then tabs for its conversation, its checks, its chapters, and its files.
 *
 * The overview is read from GitHub afresh by the service on each ask, on
 * the App's token for the agent's repository rather than anyone's own, so
 * nothing here reads on a clock: each read is asked as what draws it first
 * comes on screen, when the developer presses Retry or Refresh, and the
 * moment the agent ends, since that is when what it published settles
 * (`useAgentRead`, as the Changes tab reads). It is three reads, each
 * landing on its own, all asked as the tab is shown: the pull request
 * itself (its description, branches, mergeability, and people); its
 * conversation, whose reviews say where each reviewer the header draws
 * stands; and its checks, whose deployments the header's Preview opens, as
 * stage-cli's header reads them. What Luke already holds of
 * the pull request, what the agent published, draws the pill, the title,
 * and the Files changed tab's lines at once; each part stands as a skeleton
 * until its read lands, and says so with its own Retry where its read
 * failed, the other parts and the tabs standing. Refresh reads again all
 * three, each part drawn
 * standing until its answer lands; an agent with no pull request yet says
 * that.
 *
 * The header stays put while the tab under it scrolls, and spends as few
 * rows as it can; on a phone, where it would take half the screen, it folds
 * to its title's one line once the tab under it is scrolled, and unfolds at
 * the top again (`useHeaderFold`). Its first row is the title's: the pill wearing the pull
 * request's mark and the word for where it stands, its title and number
 * (⌘-click opens it on GitHub), the title first in the markup so a screen
 * reader names it before the pill drawn ahead of it, and at the row's end, while it is open or a
 * draft, the merge control saying what can happen now, its panel holding
 * GitHub's own sentence and the presses (`merge-box.tsx`), with Preview
 * first where a deployment of its head serves an address, opening it or, for
 * several, a menu of their environments (`PreviewControl`), and Run before
 * it, which runs the shown pull request's branch in a terminal of this Mac in the side
 * panel, where the panel offers one (`onRun`). Open on GitHub
 * and Refresh stand in the side panel's own ⋯ over the tab, which the tab
 * hands them to while it is drawn (`useHandedTabActions`). Under it one
 * line, wrapping where it must:
 * its branches, with the stack it stands in beside them
 * (`pull-request-stack.tsx`); who opened it and when, as the Changes tab
 * names them (`pull-request-people.tsx`), with its reviewers' first faces
 * wearing where each stands, the reviewer and label pickers, and its labels
 * in their GitHub colours (`pull-request-labels.tsx`) at the line's end, so
 * a pull request with no labels spends no line on them. Under it, a row of
 * tabs ending in Review, merged or closed too, as GitHub takes a review
 * then (`pull-request-review.tsx`), each tab its glyph, its name, and a quiet
 * count: Conversation, its description and its comments and
 * reviews in time order, as GitHub renders them (`body_html`), drawn
 * through the transcript's own markdown drawing (`GitHubWords`), with an
 * image GitHub serves read through the service on the App's token and
 * opened over the window in the file viewer (`pull-request-pictures.tsx`)
 * and any other drawn as its link, as ReviewStage/stage draws them; Checks, its head's deployments, the newest of each
 * environment, each opening the address it serves, over every check on its
 * head, those that failed first, then those still running, each opening
 * its page, counted in the colour of how they went; Chapters
 * (`agent-chapters-tab.tsx`), its diff told as chapters to review in order,
 * each over its own hunks in Files changed's list, counted once they are
 * ready; and Files changed (`AgentChangesTab`), its own bar and
 * tree, counted by the lines it adds and removes. A review carries the
 * threads on lines it started, each on the card every annotation on code
 * stands on (`annotation-card.tsx`): its file and lines in the strip over
 * its head, then the end of the hunk it was made on, drawn as Files changed
 * draws a diff with its own lines lit (`file-diff.tsx`), and its comments;
 * one resolved or outdated by a later push is folded closed under its head,
 * which says which, until opened. The description and every comment wear their
 * reactions under their words, as GitHub draws them
 * (`pull-request-reactions.tsx`). A thread's file and lines take it to
 * Files changed, and its ⋯ to the other view or its link copied, each
 * through the window's route for the thread's link, which brings it into
 * view there (`thread-reveal.tsx`). The Description and the Conversation
 * each fold under a heading that sticks to the view's top while it is in
 * view, the Conversation's ending in stage-cli's two filters, Hide resolved
 * and Hide bots, each counting what it leaves out; the filters and the folds
 * are kept across launches (`conversation-filters.ts`). Every name and word here is
 * the repository's, so the tab is left out of the screen recording
 * (`ph-no-capture`).
 */

/**
 * The Chapters view, loaded as a chunk of its own the first time it is
 * shown rather than with the window, as Settings is, because the renderer
 * bundle is parsed at every window open and the view, its rail, and the
 * chapter logic are opened seldom. What stands while
 * the chunk loads is the view's own wait, for a frame.
 */
const AgentChaptersTab = lazy(() =>
  import("./agent-chapters-tab.js").then((loaded) => ({ default: loaded.AgentChaptersTab })),
);

/** The tab's own words. */
const PULL_REQUEST_WORDS = {
  READING: "Reading pull request",
  READING_CHECKS: "Reading checks",
  READING_DESCRIPTION: "Reading description",
  READING_CONVERSATION: "Reading conversation",
  READING_CHAPTERS: "Reading chapters",
  FAILED: "The pull request could not be read.",
  CHECKS_FAILED: "The checks could not be read.",
  CONVERSATION_FAILED: "The conversation could not be read.",
  NO_PULL_REQUEST: "No pull request yet.",
  RUN: "Run",
  RUN_LABEL: "Run on this Mac",
  PREVIEW: "Preview",
  PREVIEWS: "Preview deployments",
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
  /** What a review thread's card is called, and who it is by. */
  THREAD: "Review thread",
  BY: "by",
  /** What the Files changed tab's count says after the lines left to review. */
  LEFT: "left",
  /** What the Files changed tab's hint says of every line the pull request changes. */
  total: (additions: number, deletions: number) =>
    `+${formatLocaleCount(additions)} −${formatLocaleCount(deletions)} total`,
} as const;

/** The lines a review thread is on, as its head names them: where it stands now, else where it was made; none for a thread on the whole file. */
function threadLines(
  thread: Pick<ReviewThread, "line" | "startLine" | "originalLine" | "originalStartLine">,
): string | undefined {
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

/** What the side panel's toolbar ⋯ offers on the pull request: it opened on GitHub, and the page read again, dimmed while a read is out, which a refresh would only repeat. */
function pullRequestActions(url: string, reading: boolean, onRefresh: () => void): MenuAction[] {
  return [
    {
      label: "Open on GitHub",
      icon: <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />,
      onSelect: () => appPlatform().openGitHub(url),
    },
    {
      label: "Refresh",
      icon: <RotateCwIcon aria-hidden="true" />,
      disabled: reading,
      onSelect: onRefresh,
    },
  ];
}

/** What the header draws of the pull request from the first frame: its mark's three, and its page. */
type HeaderPullRequest = Pick<CodingAgentPullRequest, "number" | "state" | "checks" | "url">;

/** The checks as one word, as the pull request's mark wears it: a failure beats a wait beats a pass. */
function checksSummaryOf(checks: readonly PullRequestCheck[]): CheckSummary {
  if (checks.some((check) => check.state === CHECK_STATE.FAILED)) return CHECK_SUMMARY.FAILING;
  if (checks.some((check) => check.state === CHECK_STATE.PENDING)) return CHECK_SUMMARY.PENDING;
  return checks.length === 0 ? CHECK_SUMMARY.NONE : CHECK_SUMMARY.PASSING;
}

/**
 * The pull request the header's pill and the toolbar's ⋯ draw: what the agent published,
 * as last read for the plan, from the first frame, each of its words
 * replaced by the overview's own as its read lands, since that is the newest
 * and the page under the header says the same: where it stands by the pull request's read,
 * and its checks by theirs, the published checks standing only for the
 * pull request they were read on, else the merge read's word for them.
 * None while neither has been read.
 */
function headerPullRequestOf(
  pullRequest: CodingAgentOverviewPullRequest | undefined,
  checks: CodingAgentOverviewChecks | undefined,
  published: CodingAgentPullRequest | undefined,
): HeaderPullRequest | undefined {
  const held = pullRequest ?? published;
  if (held === undefined) return undefined;
  const { number, state, url } = held;
  // Note that what was published says the checks of its own pull request only, never of a newer one the overview read.
  const heldChecks = published?.number === number ? published.checks : undefined;
  // Note that the overview's merge read says its head's checks as one word too, so a pull request nothing published still shows them before its Checks tab is read.
  const merged = pullRequest?.merging?.checks;
  const summary = checks === undefined ? (heldChecks ?? merged) : checksSummaryOf(checks.checks);
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

/** Whether a section that folds stands open, and the press that opens or folds it. */
interface SectionFold {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * A section of the page: its heading, what it counts beside it, and what it
 * holds. One that folds (`fold`) heads itself with a press across its whole
 * row, the chevron leading, which opens and folds it as the app's own
 * disclosure does, its motion and its reduced motion the disclosure's; what
 * stands at the row's end (`end`) keeps its own presses rather than folding
 * it. That row sticks to the top of the Conversation's scroller while its
 * section is in view, and the next section's pushes it off (tasks.css).
 */
function Section({
  title,
  count,
  fold,
  end,
  children,
}: {
  title: string;
  count?: ReactNode;
  fold?: SectionFold | undefined;
  end?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  const heading = (
    <Text
      as={TEXT_ELEMENT.H3}
      variant={TEXT_VARIANT.INHERIT}
      truncate
      className="pull-request-heading"
    >
      {title}
      {count === undefined ? null : <span className="pull-request-count">{count}</span>}
    </Text>
  );
  if (fold === undefined) {
    return (
      <section className="pull-request-section" aria-label={title}>
        {heading}
        {children}
      </section>
    );
  }
  return (
    <section className="pull-request-section" aria-label={title}>
      <Fold className="pull-request-section-fold" open={fold.open} onOpenChange={fold.onOpenChange}>
        <DisclosureSummary look={DISCLOSURE_SUMMARY.TRANSCRIPT}>
          <DisclosureChevron />
          {heading}
          {end === undefined ? null : (
            <DisclosureAction>
              <span className="pull-request-section-end">{end}</span>
            </DisclosureAction>
          )}
        </DisclosureSummary>
        <FoldBody className="pull-request-section-body">{children}</FoldBody>
      </Fold>
    </section>
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
          <VisuallyHidden>, {CHECK_WORDS[check.state]}</VisuallyHidden>
        </>
      }
      description={check.app ?? undefined}
      meta={running ? live ? <Time at={startedAt} look={TIME_LOOK.DURATION} /> : null : duration}
      onPress={url === null ? undefined : () => openLink(url)}
      linkHref={url ?? undefined}
    />
  );
}

/** Every check, in the order the service ranks them, failures first, then those still running, then the rest, under a count of each standing. */
function Checks({
  agentId,
  checks,
  live,
}: {
  agentId: string;
  checks: readonly PullRequestCheck[];
  live: boolean;
}): React.JSX.Element {
  const counts = CHECK_ORDER.flatMap((state) => {
    const count = checks.filter((check) => check.state === state).length;
    return count === 0 ? [] : [`${count} ${CHECK_WORDS[state]}`];
  });
  return (
    <Section title="Checks" count={counts.length === 0 ? undefined : counts.join(", ")}>
      {checks.length === 0 ? (
        <p className="pull-request-quiet pull-request-none">{PULL_REQUEST_WORDS.NO_CHECKS}</p>
      ) : (
        <CheckList>
          {checks.map((check, at) => (
            // Note that two checks may share a name across Apps, so a row is keyed by its place too.
            <CheckRow key={`${at}`} agentId={agentId} check={check} live={live} />
          ))}
        </CheckList>
      )}
    </Section>
  );
}

/** The checks' list, which the checks and their placeholder rows both stand in. */
function CheckList({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <List label="Check list" variant={LIST_VARIANT.CARD} density={LIST_DENSITY.DENSE}>
      {children}
    </List>
  );
}

/** How wide each placeholder check's name and App stand, as shares of their lines. */
const CHECK_SKELETON_ROWS = [
  { name: "55%", app: "30%" },
  { name: "45%", app: "24%" },
  { name: "50%", app: "28%" },
] as const;

/** How wide a placeholder check's lead stands: its App's square avatar. */
const CHECK_SKELETON_LEAD = "16px";

/** How wide each placeholder entry's lines stand, its author's in the head then its words. */
const ENTRY_SKELETON_LINES = [
  { by: "22%", words: ["85%", "60%"] },
  { by: "18%", words: ["70%"] },
] as const;

/** Quiet blocks where a part's words will stand, one per width given, in the part's own type at the content inset, which `label` names to a reader. */
function PartSkeleton({
  label,
  widths,
}: {
  label: string;
  widths: readonly string[];
}): React.JSX.Element {
  return (
    <SkeletonRegion label={label}>
      <div className="pull-request-skeleton">
        {widths.map((width, at) => (
          // oxlint-disable-next-line react/no-array-index-key -- a skeleton's blocks never move.
          <Skeleton key={at} width={width} />
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** The checks while they are read: rows in a check's own list and row, a block where its avatar, its name, and its App will stand. */
function ChecksSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label={PULL_REQUEST_WORDS.READING_CHECKS}>
      <CheckList>
        {CHECK_SKELETON_ROWS.map(({ name, app }) => (
          <ListRow
            key={name}
            leading={<Skeleton shape={SKELETON_SHAPE.CIRCLE} width={CHECK_SKELETON_LEAD} />}
            title={<Skeleton width={name} />}
            description={<Skeleton width={app} />}
          />
        ))}
      </CheckList>
    </SkeletonRegion>
  );
}

/** The conversation while it is read: entries in an entry's own card, its author's line over its words. */
function ConversationSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label={PULL_REQUEST_WORDS.READING_CONVERSATION}>
      <EntryList>
        {ENTRY_SKELETON_LINES.map(({ by, words }) => (
          <EntryFrame key={by}>
            <EntryHead>
              <Skeleton shape={SKELETON_SHAPE.CIRCLE} width={CHECK_SKELETON_LEAD} />
              <Skeleton width={by} />
            </EntryHead>
            {words.map((width) => (
              <Skeleton key={width} width={width} />
            ))}
          </EntryFrame>
        ))}
      </EntryList>
    </SkeletonRegion>
  );
}

/** The line under the title while the pull request is read, in the people line's own type and room. */
function HeadSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label={PULL_REQUEST_WORDS.READING}>
      <PeopleLine>
        <Skeleton width="65%" />
      </PeopleLine>
    </SkeletonRegion>
  );
}

/** The title while neither the read nor Luke holds it, in the title's own line. */
function TitleSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label={PULL_REQUEST_WORDS.READING}>
      <PullRequestTitleLine>
        <Skeleton width="60%" />
      </PullRequestTitleLine>
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

/** The tab's opener for a link to one of its pull request's own comments on GitHub, which opens the comment in the tab (`pull-request-anchors.ts`); none outside the tab. */
const AnchorsContext = createContext<OpenHere | undefined>(undefined);

/** Words of the pull request's own, under which a link to one of its comments on GitHub opens the comment in the tab, and any other link as it would. */
function Anchored({ children }: { children: ReactNode }): ReactNode {
  const open = useContext(AnchorsContext);
  return open === undefined ? children : <OpenHereFirst open={open}>{children}</OpenHereFirst>;
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
        <EntryPictures html={entry.html}>
          <Anchored>
            <GitHubWords html={entry.html} picture={picture} />
          </Anchored>
        </EntryPictures>
      </div>
    );
  }
  return entry.body === "" ? null : (
    <div className="pull-request-words">
      <Anchored>
        <TranscriptWords text={entry.body} />
      </Anchored>
    </div>
  );
}

/** How a thread drawn in the tab is taken to its other view, and the place a link to it names there; none for a thread GitHub named no id for. */
interface ThreadJumps {
  readonly jump: (thread: ReviewThread, view: PullRequestThreadView) => void;
  readonly place: (thread: ReviewThread, view: PullRequestThreadView) => LinkPlace | undefined;
}

const ThreadJumpContext = createContext<ThreadJumps | undefined>(undefined);

/** The door taking a thread to `view`, where the tab can find it there again; none for a thread with no id. */
function useThreadJump(
  thread: ReviewThread,
  view: PullRequestThreadView,
): (() => void) | undefined {
  const jumps = useContext(ThreadJumpContext);
  return jumps === undefined || thread.id === undefined
    ? undefined
    : () => jumps.jump(thread, view);
}

/**
 * A thread's ⋯ at the end of its head: View in the tab's other view, where
 * the thread is found by its id, and Copy link, the thread's Luke link in
 * the view it is drawn in (`LINK_PLACE.PULL_REQUEST_THREAD`); nothing where
 * the thread offers neither.
 */
function ThreadMenu({
  thread,
  here,
  there,
}: {
  thread: ReviewThread;
  /** The view the thread is drawn in, which its link names. */
  here: PullRequestThreadView;
  /** The view its View in takes it to. */
  there: PullRequestThreadView;
}): React.JSX.Element | null {
  const menu = useMenu(true);
  const jumps = useContext(ThreadJumpContext);
  const copyLink = useCopyLinkItem();
  const jump = useThreadJump(thread, there);
  const place = jumps?.place(thread, here);
  const copy = place === undefined ? undefined : copyLink(place);
  const actions: MenuAction[] = [
    ...(jump === undefined
      ? []
      : [
          there === PULL_REQUEST_THREAD_VIEW.FILES
            ? {
                label: THREAD_REVEAL_WORDS.VIEW_FILES,
                icon: <FileDiffIcon aria-hidden="true" />,
                onSelect: jump,
              }
            : {
                label: THREAD_REVEAL_WORDS.VIEW_CONVERSATION,
                icon: <MessagesSquareIcon aria-hidden="true" />,
                onSelect: jump,
              },
        ]),
    ...(copy === undefined ? [] : [copy]),
  ];
  if (actions.length === 0) return null;
  const label = THREAD_REVEAL_WORDS.MENU;
  return (
    <DisclosureAction>
      <span className="pull-request-thread-menu">
        <Tooltip label={label}>
          <IconButton icon={<EllipsisIcon />} label={label} {...menu.trigger()} />
        </Tooltip>
        {menu.drawn === undefined ? null : (
          <ActionMenu label={label} menu={menu.drawn} groups={[actions]} onClose={menu.close} />
        )}
      </span>
    </DisclosureAction>
  );
}

/** A review thread's lines as its strip names them, GitHub's way: `L12–13`, or the one line; none for a thread on the whole file. */
function lineSpan(
  thread: Pick<ReviewThread, "line" | "startLine" | "originalLine" | "originalStartLine">,
): string | undefined {
  const line = thread.line ?? thread.originalLine;
  const start = thread.line === null ? thread.originalStartLine : thread.startLine;
  if (line === null) return undefined;
  return start === null || start === line ? `L${line}` : `L${start}–${line}`;
}

/** The states a review thread's head wears: resolved, outdated by a later push, and pending, the member's own not yet submitted. */
function threadStates(thread: ReviewThread, pending: boolean): readonly AnnotationState[] {
  return [
    ...(thread.resolved
      ? [{ word: PULL_REQUEST_WORDS.RESOLVED, tone: ANNOTATION_TONE.COMPLETE }]
      : []),
    ...(thread.outdated
      ? [{ word: PULL_REQUEST_WORDS.OUTDATED, tone: ANNOTATION_TONE.NEUTRAL }]
      : []),
    ...(pending ? [{ word: PENDING_WORDS.PENDING, tone: ANNOTATION_TONE.ATTENTION }] : []),
  ];
}

/**
 * The strip over a thread card whose place does not say where it is: its
 * file's path, cut in the middle so its file's name stands, and its lines,
 * which take the thread to them in Files changed where it can be found
 * there; the lines alone for a thread above a diff, whose file is the one
 * it stands in.
 */
function ThreadWhere({
  path,
  lines,
  onPress,
}: {
  path: string | undefined;
  lines: string | undefined;
  onPress: (() => void) | undefined;
}): React.JSX.Element {
  const cut = path === undefined ? -1 : path.lastIndexOf("/");
  const words = (
    <span className="annotation-where">
      {path === undefined ? null : (
        <>
          <Text
            as={TEXT_ELEMENT.SPAN}
            variant={TEXT_VARIANT.INHERIT}
            truncate
            className="annotation-where-folder"
          >
            <bdi>{path.slice(0, cut + 1)}</bdi>
          </Text>
          <Text
            as={TEXT_ELEMENT.SPAN}
            variant={TEXT_VARIANT.INHERIT}
            truncate
            className="annotation-where-file"
          >
            <bdi>{path.slice(cut + 1)}</bdi>
          </Text>
        </>
      )}
      {lines === undefined ? null : <span className="annotation-where-lines">{lines}</span>}
    </span>
  );
  const named = [path, lines].filter((part) => part !== undefined).join(" ");
  if (onPress === undefined) return <Tooltip label={named}>{words}</Tooltip>;
  return (
    <Tooltip label={THREAD_REVEAL_WORDS.VIEW_FILES}>
      <LineButton
        look={LINE_BUTTON_LOOK.BAND}
        aria-label={`${THREAD_REVEAL_WORDS.VIEW_FILES}: ${named}`}
        onClick={onPress}
      >
        {words}
      </LineButton>
    </Tooltip>
  );
}

/** What a review thread's card heads it with: who wrote its first comment, when, the states it is in, and how many comments it holds. */
function useThreadHead(thread: ReviewThread, now: number, pending: boolean) {
  const name = useNamer();
  const first = thread.comments[0];
  const writer = first === undefined ? undefined : name(first.by);
  return {
    label:
      writer === undefined
        ? PULL_REQUEST_WORDS.THREAD
        : `${PULL_REQUEST_WORDS.THREAD} ${PULL_REQUEST_WORDS.BY} ${actorName(writer)}`,
    face: writer === undefined ? null : <ActorMark actor={writer} size={ACTOR_SIZE.ROW} />,
    name:
      writer === undefined ? null : (
        <DisclosureAction>
          <ActorRef actor={writer} nameOnly />
        </DisclosureAction>
      ),
    time:
      first === undefined ? undefined : (
        <Time className="annotation-card-time" at={first.at} now={now} />
      ),
    states: threadStates(thread, pending),
    count: thread.comments.length + thread.more,
  };
}

/**
 * One review thread in the Conversation, on the shared card
 * (`annotation-card.tsx`): its file and lines in the strip over its head,
 * which take it to them in Files changed; its head, folded closed while it
 * was resolved or a later push outdated it, until opened; then the lines it
 * is on, as Files changed draws a diff, its own lines lit
 * (`threadPreview`), and its comments, oldest first, with the replies a
 * read left on GitHub counted after them, and Reply and Resolve at its foot.
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
  const pending = usePendingThread(thread);
  const head = useThreadHead(thread, now, pending);
  const landed = useLandedThread(thread, !thread.resolved && !thread.outdated);
  const toFiles = useThreadJump(thread, PULL_REQUEST_THREAD_VIEW.FILES);
  return (
    <li className="pull-request-thread-slot">
      <AnnotationCard
        {...head}
        className="pull-request-thread"
        open={landed.open}
        onOpenChange={landed.onOpenChange}
        landing={landed}
        where={<ThreadWhere path={thread.path} lines={lineSpan(thread)} onPress={toFiles} />}
        menu={
          <ThreadMenu
            thread={thread}
            here={PULL_REQUEST_THREAD_VIEW.CONVERSATION}
            there={PULL_REQUEST_THREAD_VIEW.FILES}
          />
        }
        lead={
          preview === undefined ? undefined : (
            <PierreDiff
              patch={preview.patch}
              look={look}
              selected={preview.selected}
              excerpt
              className="diff-view pull-request-thread-lines"
            />
          )
        }
        footer={<ThreadActions thread={thread} />}
      >
        <ThreadComments thread={thread} now={now} picture={picture} />
      </AnnotationCard>
    </li>
  );
}

/**
 * One comment of a review thread on its card: the first one's words alone,
 * since the card's head names who and when; a reply's face, who and when
 * beside it, Pending where it is the member's own, then its words. Under
 * the words, the reactions it wears; one of the member's pending comments
 * with Edit and Delete there instead (`pending-comments.tsx`).
 */
function ThreadComment({
  comment,
  now,
  picture,
  first,
}: {
  comment: ReviewThread["comments"][number];
  now: number;
  picture: GitHubPictureDrawer;
  /** Whether it is the comment the card's head names. */
  first: boolean;
}): React.JSX.Element {
  const draft = usePendingComment(comment.url);
  const writer = useNamer()(comment.by);
  const words = <EntryWords entry={comment} picture={picture} />;
  const reply = first
    ? undefined
    : {
        face: <ActorMark actor={writer} size={ACTOR_SIZE.ROW} />,
        meta: (
          <>
            <ActorRef actor={writer} nameOnly />
            <Time className="annotation-card-time" at={comment.at} now={now} />
            {draft === undefined ? null : <PendingBadge />}
          </>
        ),
      };
  return (
    <AnnotationComment reply={reply} className="pull-request-thread-comment">
      {draft === undefined ? (
        <>
          {words}
          <Reactions reactions={comment.reactions} subject={comment.subject} />
        </>
      ) : (
        <PendingComment draft={draft} words={words} marked={false} />
      )}
    </AnnotationComment>
  );
}

/** The member's pending comments as the Review panel lists them: each one's file and lines, then the comment, Edit and Delete with it. */
function PendingList({
  drafts,
  now,
  picture,
}: {
  drafts: readonly PendingReviewComment[];
  now: number;
  picture: GitHubPictureDrawer;
}): React.JSX.Element {
  return (
    <BlockList as={BLOCK_LIST_ELEMENT.OL} label={PENDING_WORDS.PENDING}>
      {drafts.map((draft) => (
        <BlockListItem key={draft.id}>
          <Text
            as={TEXT_ELEMENT.SPAN}
            variant={TEXT_VARIANT.INHERIT}
            truncate
            className="pull-request-quiet pull-request-pending-where"
          >
            {draft.path}
            {draft.line === null
              ? ""
              : ` · ${threadLines({ ...draft, originalLine: draft.line, originalStartLine: draft.startLine })}`}
          </Text>
          <PendingComment
            draft={draft}
            head={
              <>
                <PersonRef person={draft.by} />
                <Time className="changes-comment-time" at={draft.at} now={now} />
              </>
            }
            words={<EntryWords entry={draft} picture={picture} />}
          />
        </BlockListItem>
      ))}
    </BlockList>
  );
}

/** A review thread's comments, oldest first, on its card, with the replies a read left on GitHub counted after them, wherever the thread is drawn. */
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
      <AnnotationComments>
        {thread.comments.map((comment, at) => (
          <ThreadComment
            key={comment.url}
            comment={comment}
            now={now}
            picture={picture}
            first={at === 0}
          />
        ))}
      </AnnotationComments>
      {thread.more === 0 || last === undefined ? null : (
        <p className="pull-request-more annotation-card-more">
          <TextButton
            tone={TEXT_BUTTON_TONE.LINK}
            onClick={() => openLink(last.url)}
            linkHref={last.url}
          >
            {PULL_REQUEST_WORDS.moreReplies(thread.more)}
          </TextButton>
        </p>
      )}
    </>
  );
}

/**
 * A review thread drawn on its line in Files changed, as GitHub's own diff
 * draws one, on the shared card (`annotation-card.tsx`): its head, folded
 * closed while it was resolved or a later push outdated it, until opened;
 * then its comments, and Reply and Resolve at its foot. Its line and the
 * lines it lights say where it is, so it names none; one above the diff,
 * whose line is gone, names the line it was made on in the strip over its
 * head. Minimize inline comments draws a line's threads as a chip instead
 * (`minimized-threads.tsx`).
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
  // A thread the member's pending comment starts is theirs alone until they submit it, with no page to link or jump to.
  const pending = usePendingThread(thread);
  const head = useThreadHead(thread, now, pending);
  const landed = useLandedThread(thread, !thread.resolved && !thread.outdated);
  const lines = place === THREAD_PLACE.ABOVE ? lineSpan(thread) : undefined;
  return (
    <AnnotationCard
      {...head}
      className="diff-inline-thread"
      open={landed.open}
      onOpenChange={landed.onOpenChange}
      landing={landed}
      where={
        lines === undefined ? undefined : (
          <ThreadWhere path={undefined} lines={lines} onPress={undefined} />
        )
      }
      menu={
        pending ? null : (
          <ThreadMenu
            thread={thread}
            here={PULL_REQUEST_THREAD_VIEW.FILES}
            there={PULL_REQUEST_THREAD_VIEW.CONVERSATION}
          />
        )
      }
      footer={<ThreadActions thread={thread} />}
    >
      <ThreadComments thread={thread} now={now} picture={picture} />
    </AnnotationCard>
  );
}

/** The conversation's list of entries, which its entries and their placeholders both stand in. */
function EntryList({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <Stack as={LAYOUT_ELEMENT.OL} gap={GAP.CONTROL} className="pull-request-conversation">
      {children}
    </Stack>
  );
}

/** One entry's card. */
function EntryFrame({
  children,
  ...props
}: Omit<ComponentProps<"li">, "className">): React.JSX.Element {
  return (
    <li className="pull-request-entry" {...props}>
      {children}
    </li>
  );
}

/** An entry's head: who, where a review left them, and when. */
function EntryHead({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className="changes-comment-head">{children}</span>;
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
  const landed = useLandedEntry(entry.url);
  return (
    <EntryFrame
      ref={landed.ref}
      // Note that the entry takes the focus a link to it on GitHub brings, though no key reaches it.
      tabIndex={-1}
      data-search-landed={landed.ringed ? "" : undefined}
      onAnimationEnd={landed.onAnimationEnd}
    >
      <EntryHead>
        <PersonRef person={entry.by} />
        {entry.state === undefined ? null : <ReviewStanding state={entry.state} />}
        <Time className="changes-comment-time" at={entry.at} now={now} />
      </EntryHead>
      <EntryWords entry={entry} picture={picture} />
      <Reactions reactions={entry.reactions} subject={entry.subject} />
      {threads.length === 0 ? null : (
        <Stack as={LAYOUT_ELEMENT.OL} gap={GAP.ITEM} className="pull-request-threads">
          {threads.map((thread, at) => (
            // Note that a thread is keyed by its first comment's page, which no other thread shares, or its place.
            <ThreadCard
              key={thread.comments[0]?.url ?? `${at}`}
              thread={thread}
              now={now}
              picture={picture}
            />
          ))}
        </Stack>
      )}
    </EntryFrame>
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

/** The line under the title, in the people line's caption type: the branches, who opened it, its reviewers and labels. */
function PeopleLine({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="changes-people pull-request-people">{children}</div>;
}

/** Under the title, one line wrapping where it must: the branches and the stack it stands in, who opened it and when, its reviewers, the pickers and its labels; a skeleton while its read is out, and its failure with Retry. */
function PullRequestHead({
  parts,
  now,
  writes,
  editing,
}: {
  parts: OverviewParts;
  now: number;
  writes: PullRequestWrites;
  /** What the reviewer and label pickers read, and whether the pull request is being read again after a change. */
  editing: { readonly options: ReviewOptions; readonly refreshing: boolean };
}): React.JSX.Element {
  const { pullRequest: part, conversation } = parts;
  if (part.kind === PART.PENDING) {
    return <HeadSkeleton />;
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
    <PeopleLine>
      <span className="pull-request-branch-row">
        <PullRequestBranches
          base={pullRequest.base}
          head={pullRequest.head}
          headOwner={pullRequest.headOwner}
        />
        <PullRequestStack stack={pullRequest.stack ?? []} number={pullRequest.number} />
      </span>
      <OpenedLine
        person={author}
        opened={<Time at={pullRequest.createdAt} now={now} look={TIME_LOOK.AGO} />}
        merged={
          mergedAt === null ? undefined : <Time at={mergedAt} now={now} look={TIME_LOOK.AGO} />
        }
      />
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
    </PeopleLine>
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
      linkHref={url ?? undefined}
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
    <Section title="Deployments" count={formatLocaleCount(deployments.length)}>
      <List label="Deployment list" variant={LIST_VARIANT.CARD} density={LIST_DENSITY.DENSE}>
        {deployments.map((deployment) => (
          <DeploymentRow key={deployment.environment} agentId={agentId} deployment={deployment} />
        ))}
      </List>
    </Section>
  );
}

/** The head's deployments that serve an address now, the newest of each environment, as the header's Preview opens them. */
function servingOf(
  checks: CodingAgentOverviewChecks | undefined,
): readonly (PullRequestDeployment & { readonly url: string })[] {
  return (checks?.deployments ?? []).filter(
    (deployment): deployment is PullRequestDeployment & { readonly url: string } =>
      deployment.state === DEPLOYMENT_STATE.READY && deployment.url !== null,
  );
}

/**
 * The header's Preview, as stage-cli's header offers a pull request's
 * previews: one deployment serving an address opens at a press, and several
 * drop a menu naming each environment. Nothing stands until the checks land
 * or where nothing serves an address, so a head still deploying offers no
 * door that leads nowhere.
 */
function PreviewControl({
  checks,
  shown,
}: {
  checks: CodingAgentOverviewChecks | undefined;
  shown: boolean;
}): React.JSX.Element | null {
  const openLink = useOpenLink();
  const menu = useMenu(shown);
  const serving = servingOf(checks);
  const [only] = serving;
  if (only === undefined) return null;
  if (serving.length === 1) {
    return (
      <Tooltip label={only.environment}>
        <Button
          variant={BUTTON_VARIANT.OUTLINE}
          icon={<ScanSearchIcon />}
          label={`${PULL_REQUEST_WORDS.PREVIEW} ${only.environment}`}
          onClick={() => openLink(only.url)}
        >
          {PULL_REQUEST_WORDS.PREVIEW}
        </Button>
      </Tooltip>
    );
  }
  const actions: MenuAction[] = serving.map((deployment) => ({
    label: deployment.environment,
    icon: <ExternalLinkIcon aria-hidden="true" />,
    onSelect: () => openLink(deployment.url),
  }));
  return (
    <span className="pull-request-preview">
      <Button
        variant={BUTTON_VARIANT.OUTLINE}
        icon={<ScanSearchIcon />}
        label={PULL_REQUEST_WORDS.PREVIEWS}
        trailing={formatLocaleCount(serving.length)}
        {...menu.trigger()}
      >
        {PULL_REQUEST_WORDS.PREVIEW}
      </Button>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={PULL_REQUEST_WORDS.PREVIEWS}
          menu={menu.drawn}
          groups={[actions]}
          onClose={menu.close}
        />
      )}
    </span>
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
        <ChecksSkeleton />
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
  fold,
}: {
  part: Part<CodingAgentOverviewPullRequest>;
  reactions: readonly ReactionGroup[] | undefined;
  /** The GraphQL id a reaction is given to the description by, which the conversation's read names. */
  subject: string | undefined;
  picture: GitHubPictureDrawer;
  fold: SectionFold;
}): React.JSX.Element | null {
  if (part.kind === PART.FAILED || part.kind === PART.NONE) return null;
  return (
    <Section title="Description" fold={fold}>
      {part.kind === PART.PENDING ? (
        <PartSkeleton
          label={PULL_REQUEST_WORDS.READING_DESCRIPTION}
          widths={["90%", "75%", "82%", "40%"]}
        />
      ) : part.value.html === "" ? (
        <p className="pull-request-quiet pull-request-none">{PULL_REQUEST_WORDS.NO_DESCRIPTION}</p>
      ) : (
        <div className="pull-request-words">
          <EntryPictures html={part.value.html}>
            <Anchored>
              <GitHubWords html={part.value.html} picture={picture} />
            </Anchored>
          </EntryPictures>
        </div>
      )}
      {part.kind === PART.PENDING ? null : <Reactions reactions={reactions} subject={subject} />}
    </Section>
  );
}

/** The conversation as its read stands, under its heading and its filters: its entries once landed, as the filters leave them, the earlier ones counted first; a skeleton while out, its failure with Retry. */
function ConversationPart({
  parts,
  filters,
  filterControls,
  fold,
  kept,
  url,
  now,
  picture,
}: {
  parts: OverviewParts;
  filters: ConversationFilters;
  /** Hide resolved and Hide bots, at the end of the section's heading. */
  filterControls: ReactNode;
  fold: SectionFold;
  /** What was last brought into view here, a thread by its id and an entry by its page, which stands whatever the filters say. */
  kept: ReadonlySet<string>;
  /** The pull request's page, which the earlier entries left on GitHub open. */
  url: string | undefined;
  now: number;
  picture: GitHubPictureDrawer;
}): React.JSX.Element {
  const openLink = useOpenLink();
  const part = parts.conversation;
  if (part.kind !== PART.LANDED) {
    return (
      <Section title="Conversation" fold={fold} end={filterControls}>
        {part.kind === PART.PENDING ? (
          <ConversationSkeleton />
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
  const shown = filteredConversation(conversation, filters, kept);
  return (
    <Section
      title="Conversation"
      count={earlier + conversation.length === 0 ? undefined : earlier + conversation.length}
      fold={fold}
      end={filterControls}
    >
      {/* The earlier entries a read left on GitHub are counted where they would stand, first. */}
      {earlier === 0 || url === undefined ? null : (
        <p className="pull-request-more pull-request-earlier">
          <TextButton tone={TEXT_BUTTON_TONE.LINK} onClick={() => openLink(url)} linkHref={url}>
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
        <EntryList>
          {shown.map((entry) => (
            <EntryCard key={entry.url} entry={entry} now={now} picture={picture} />
          ))}
        </EntryList>
      )}
    </Section>
  );
}

/** The fixed header's title and number, as the pull request's read says or, until it lands, as Luke held them, ⌘-click opening it on GitHub; a skeleton where neither has. */
function HeaderTitle({
  title,
  writes,
}: {
  title: Pick<CodingAgentPullRequest, "title" | "number" | "url"> | undefined;
  writes: PullRequestWrites;
}): React.JSX.Element {
  if (title === undefined) {
    return (
      <div className="pull-request-title-wait">
        <TitleSkeleton />
      </div>
    );
  }
  return (
    <PullRequestTitle
      title={title.title}
      number={pullRequestNumberLabel(title)}
      writes={writes}
      onOpen={() => appPlatform().openGitHub(title.url)}
    />
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
  [CHECK_SUMMARY.FAILING]: COUNT_TONE.DANGER,
  [CHECK_SUMMARY.PENDING]: COUNT_TONE.ATTENTION,
  [CHECK_SUMMARY.PASSING]: COUNT_TONE.COMPLETE,
  [CHECK_SUMMARY.NONE]: COUNT_TONE.QUIET,
} as const satisfies Record<CheckSummary, CountTone>;

/** What the Checks tab counts: how they went in its colour from the first frame, and how many once read; nothing where neither stands. */
function checksCount(
  summary: CheckSummary,
  count: number | undefined,
): readonly CountPart[] | undefined {
  const glyph = SUMMARY_GLYPHS[summary];
  if (glyph === null && count === undefined) return undefined;
  const text = count === undefined ? "" : formatLocaleCount(count);
  const tone = SUMMARY_TONES[summary];
  return [
    glyph === null ? { text, tone } : { text, tone, glyph, glyphLabel: SUMMARY_WORDS[summary] },
  ];
}

/** What the Files changed tab counts: the lines left to review and, in its hint, the whole; or the whole alone. */
interface FilesCount {
  readonly count: readonly CountPart[];
  readonly hint: string | undefined;
}

/**
 * The lines the Files changed tab counts, as stage-cli counts them: those
 * left to review, the whole less every file the member marked viewed, its
 * whole in the hint, while some files are viewed and some are not; the whole
 * alone where none or all are, or where the changes and the marks, read as
 * Files changed is first opened, have not both landed. The whole is the
 * changes' own once they are read, so it and the files it is cut by describe
 * the same push; where the read stopped short of every file, it is what the
 * agent published, and files the read left out count as still to review.
 * Note that it reads the marks Files changed draws, so a box ticked there
 * counts at once, and one GitHub refuses counts again as it goes back.
 */
function filesCountOf(
  published: CodingAgentPullRequest | undefined,
  reads: ChangesReads,
): FilesCount | undefined {
  const changes = reads.pullRequest;
  const marks = reads.viewedFiles.marks;
  if (changes === null || marks === undefined) {
    return published === undefined
      ? undefined
      : { count: linesCount(published.additions, published.deletions), hint: undefined };
  }
  const { files, truncated } = changes;
  const sum = (of: readonly (typeof files)[number][], key: "additions" | "deletions") =>
    of.reduce((total, file) => total + file[key], 0);
  const additions =
    truncated && published !== undefined ? published.additions : sum(files, "additions");
  const deletions =
    truncated && published !== undefined ? published.deletions : sum(files, "deletions");
  const whole = { count: linesCount(additions, deletions), hint: undefined };
  const viewed = files.filter((file) => marks.viewed(file.path));
  if (viewed.length === 0 || (viewed.length === files.length && !truncated)) return whole;
  const left = linesCount(
    Math.max(0, additions - sum(viewed, "additions")),
    Math.max(0, deletions - sum(viewed, "deletions")),
  );
  return {
    count: [...left, { text: PULL_REQUEST_WORDS.LEFT }],
    hint: PULL_REQUEST_WORDS.total(additions, deletions),
  };
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
 * The four tabs under the header, each counting what Luke has read of it
 * so far: the conversation once read; the checks by how they went from the
 * first frame, as the pill's mark says it, and by how many once read; the
 * chapters once they are ready (`chaptersCount`); and
 * the files by the lines left to review once some are marked viewed, else
 * by the lines what was published adds and removes (`filesCountOf`).
 */
function tabsOf(
  parts: OverviewParts,
  published: CodingAgentPullRequest | undefined,
  held: HeaderPullRequest | undefined,
  changes: ChangesReads,
  chapters: ChaptersRead,
): readonly ChoiceItem<PullRequestView>[] {
  const conversation = landed(parts.conversation);
  const checks = landed(parts.checks);
  const files = filesCountOf(published, changes);
  const chapterCount = chaptersCount(chapters);
  return [
    {
      value: PULL_REQUEST_VIEW.CONVERSATION,
      icon: <MessagesSquareIcon />,
      label: "Conversation",
      count:
        conversation === undefined ? undefined : formatLocaleCount(conversationCount(conversation)),
    },
    {
      value: PULL_REQUEST_VIEW.CHECKS,
      icon: <CircleCheckIcon />,
      label: "Checks",
      count:
        held === undefined
          ? undefined
          : checksCount(
              held.checks,
              checks === undefined ? undefined : summaryCountOf(checks.checks, held.checks),
            ),
    },
    {
      value: PULL_REQUEST_VIEW.CHAPTERS,
      icon: <BookOpenIcon />,
      label: "Chapters",
      count: chapterCount === undefined ? undefined : formatLocaleCount(chapterCount),
    },
    {
      value: PULL_REQUEST_VIEW.FILES,
      icon: <FileDiffIcon />,
      label: "Files changed",
      count: files?.count,
      hint: files?.hint,
    },
  ];
}

/** One of the conversation's filters, drawn as the tasks board's view filter in its toolbar is (`tasks-board.tsx`): a filter chip pressed while it is on, its word and how many it would leave out once the conversation is read. */
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
  const noteId = useId();
  const note = count === undefined ? undefined : describe(count);
  const filter = (
    <span className="pull-request-filter">
      <Chip
        look={CHIP_LOOK.FILTER}
        aria-label={label}
        aria-pressed={on}
        aria-describedby={note === undefined ? undefined : noteId}
        onClick={() => onChange(!on)}
      >
        <ChipName>{label}</ChipName>
        {count === undefined ? null : <ChipCount>{formatLocaleCount(count)}</ChipCount>}
      </Chip>
      {note === undefined ? null : (
        <span id={noteId} hidden>
          {note}
        </span>
      )}
    </span>
  );
  return note === undefined ? filter : <Tooltip label={note}>{filter}</Tooltip>;
}

/** Hide resolved and Hide bots, as stage-cli orders them, at the end of the Conversation's heading, each counting what it leaves out once read. */
function ConversationFilterChips({
  control,
  hidden,
}: {
  control: ConversationFiltersControl;
  hidden: ConversationHidden | undefined;
}): React.JSX.Element {
  const { filters, change } = control;
  return (
    <>
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
    </>
  );
}

/**
 * The Conversation tab: the description, then the comments, reviews, and
 * threads, in one scroll, and, once the conversation is read, the box a new
 * comment is written in at its foot. Each of the two sections folds under
 * its heading, the choice kept for every pull request
 * (`conversation-filters.ts`), and its heading sticks to the scroller's top
 * while it is in view, what scrolls under it fading beneath it
 * (`SCROLL_FADE_INSET.BAND`) rather than cut at its edge. A thread or an
 * entry brought into view opens a folded Conversation, so its card is drawn
 * to land on.
 */
function ConversationView({
  agentId,
  parts,
  url,
  comment,
  kept,
  landing,
}: {
  agentId: string;
  parts: OverviewParts;
  url: string | undefined;
  /** The comment box's words and its own change, held by the tab so the box may come and go. */
  comment: PullRequestComment;
  /** What was last brought into view here, a thread by its id and an entry by its page, which stands whatever the filters say. */
  kept: ReadonlySet<string>;
  /** The thread or entry to land on, once; none lands on none. */
  landing: ThreadLanding | undefined;
}): React.JSX.Element {
  const now = useMinute();
  const picture = usePictureDrawer(agentId);
  const choices = useConversationFilters();
  const { filters, change } = choices;
  const conversation = landed(parts.conversation)?.conversation;
  const asked = landing?.ask;
  const conversationOpen = filters.conversationOpen;
  useEffect(() => {
    if (asked !== undefined && !conversationOpen) change({ conversationOpen: true });
  }, [asked, conversationOpen, change]);
  return (
    // Note that it is in the tab order, because it scrolls on its own, and a column of words holds nothing else a keyboard could reach to scroll it by.
    <ScrollArea
      role="region"
      aria-label="Pull request conversation"
      tabIndex={0}
      fade={SCROLL_FADE.START}
      fadeInset={SCROLL_FADE_INSET.BAND}
      gutter={SCROLL_GUTTER.STABLE}
    >
      <div className="pull-request-page">
        <DescriptionPart
          part={parts.pullRequest}
          reactions={landed(parts.conversation)?.descriptionReactions}
          subject={landed(parts.conversation)?.descriptionSubject}
          picture={picture}
          fold={{
            open: filters.descriptionOpen,
            onOpenChange: (descriptionOpen) => change({ descriptionOpen }),
          }}
        />
        <ThreadLandingProvider value={landing}>
          <ConversationPart
            parts={parts}
            filters={filters}
            filterControls={
              <ConversationFilterChips
                control={choices}
                hidden={conversation === undefined ? undefined : conversationHidden(conversation)}
              />
            }
            fold={{
              open: conversationOpen,
              onOpenChange: (open) => change({ conversationOpen: open }),
            }}
            kept={kept}
            url={url}
            now={now}
            picture={picture}
          />
        </ThreadLandingProvider>
        {conversation === undefined ? null : <PullRequestCommentBox comment={comment} />}
      </div>
    </ScrollArea>
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

/** A review thread being brought into view in the tab: by its id, on the view it was asked on; counted, so each ask is its own. */
interface ThreadJump {
  readonly threadId: string;
  readonly view: PullRequestThreadView;
  readonly ask: number;
}

/**
 * A card brought into sight in the Conversation's own scroller, never by
 * `scrollIntoView`, which would scroll every box around it (panel
 * AGENTS.md): centred in the room under the heading stuck at the scroller's
 * top and the fade beneath it, which the scroller's own scroll padding
 * clears, and, where it is taller than that room, its top standing just
 * under them rather than behind the heading.
 */
function centreCard(card: HTMLElement): void {
  const scroller = scrollerOf(card);
  if (scroller === undefined) return;
  const padding = Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop);
  const clear = Number.isNaN(padding) ? 0 : padding;
  const box = scroller.getBoundingClientRect();
  const at = card.getBoundingClientRect();
  const top = box.top + clear;
  const centred = at.top + at.height / 2 - (top + (box.height - clear) / 2);
  scroller.scrollTop += Math.min(centred, at.top - top);
}

/**
 * The tab's door to its review threads by id, and the thread it is bringing
 * into view. A thread is taken to its other view through the window's own
 * route for its link (`LINK_PLACE.PULL_REQUEST_THREAD`), as any link to it
 * would take it, which opens this tab on that view and leaves the ask for
 * it to take; a tab the route cannot reach, one showing another pull
 * request by its number, or one outside the window, takes the jump itself.
 * Once the conversation is read, the thread is found by its id, or said
 * gone, and the ask let go.
 */
function useThreadJumps(input: {
  agentId: string;
  planId: string | null;
  number: number | undefined;
  shown: boolean;
  threads: readonly ReviewThread[];
  conversation: Part<CodingAgentOverviewConversation>;
  onView: (view: PullRequestView) => void;
}) {
  const { agentId, planId, number, shown, threads, conversation } = input;
  const openPlace = useOpenPlace();
  const toast = useToast();
  const [jump, setJump] = useState<ThreadJump | undefined>(undefined);
  // The thread last brought into the Conversation, which stands through its filters while it is read.
  const [kept, setKept] = useState<string | undefined>(undefined);
  const asks = useRef(0);
  const start = useCallback((threadId: string, view: PullRequestThreadView) => {
    asks.current += 1;
    if (view === PULL_REQUEST_THREAD_VIEW.CONVERSATION) setKept(threadId);
    setJump({ threadId, view, ask: asks.current });
  }, []);
  // A link names the agent's own pull request, never one a tab shows by its number.
  const windowAsk = useWindowThreadReveal(agentId);
  const taken = number === undefined && shown ? windowAsk : undefined;
  const latestAsk = useRef(taken);
  latestAsk.current = taken;
  useEffect(() => {
    const standing = latestAsk.current;
    if (standing === undefined) return;
    start(standing.reveal.threadId, standing.reveal.view);
    standing.onRevealed(standing.reveal.ask);
  }, [taken?.reveal.ask, start]);
  const place = (thread: ReviewThread, view: PullRequestThreadView): LinkPlace | undefined =>
    thread.id === undefined || planId === null || number !== undefined
      ? undefined
      : { kind: LINK_PLACE.PULL_REQUEST_THREAD, planId, agentId, threadId: thread.id, view };
  const latestView = useRef(input.onView);
  latestView.current = input.onView;
  const jumpTo = (thread: ReviewThread, view: PullRequestThreadView) => {
    const routed = place(thread, view);
    if (routed !== undefined && openPlace !== undefined) {
      openPlace(routed);
      return;
    }
    if (thread.id === undefined) return;
    latestView.current(view);
    start(thread.id, view);
  };
  const target = jump === undefined ? undefined : threads.find((each) => each.id === jump.threadId);
  // A thread the conversation read no longer holds is said gone; one a read that failed or is out stands for its Retry.
  const gone = jump !== undefined && conversation.kind === PART.LANDED && target === undefined;
  useEffect(() => {
    if (!gone) return;
    toast({ words: THREAD_REVEAL_WORDS.GONE, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD.FAILED });
    setJump(undefined);
  }, [gone, toast]);
  const letGo = useCallback((ask: number) => {
    setJump((was) => (was?.ask === ask ? undefined : was));
  }, []);
  const conversationLanding: ThreadLanding | undefined =
    jump?.view === PULL_REQUEST_THREAD_VIEW.CONVERSATION && target?.id !== undefined
      ? {
          target: target.id,
          ask: jump.ask,
          scroll: centreCard,
          onLanded: letGo,
          onFaded: () => undefined,
        }
      : undefined;
  // Note that a thread whose file the changes no longer hold is shown in the Conversation instead, said so.
  const filesReveal: ChangesReveal | undefined =
    jump?.view === PULL_REQUEST_THREAD_VIEW.FILES && target !== undefined
      ? {
          thread: target,
          ask: jump.ask,
          onLanded: letGo,
          onGone: (ask) => {
            if (jump.ask !== ask || target.id === undefined) return;
            toast({
              words: THREAD_REVEAL_WORDS.FILE_GONE,
              tone: TOAST_TONE.FAILED,
              hold: TOAST_HOLD.FAILED,
            });
            latestView.current(PULL_REQUEST_VIEW.CONVERSATION);
            start(target.id, PULL_REQUEST_THREAD_VIEW.CONVERSATION);
          },
        }
      : undefined;
  return {
    jumps: { jump: jumpTo, place } satisfies ThreadJumps,
    kept,
    conversationLanding,
    filesReveal,
  };
}

/** How the tab opens a link to one of its pull request's own comments on GitHub, the entry it is bringing into view, and the last it brought there. */
interface ConversationAnchors {
  readonly open: OpenHere;
  readonly landing: ThreadLanding | undefined;
  readonly kept: string | undefined;
}

/**
 * A link on GitHub to one of the pull request's own comments, pressed in its
 * words, opens the comment in the Conversation rather than GitHub: a line
 * comment's thread through the route its own link takes (`jumps`), and a
 * comment on the pull request or a review brought into view in place; any
 * other link, and one to a comment the read did not reach, opens as it
 * would (`anchorIn`).
 */
function useConversationAnchors(input: {
  pullRequestUrl: string | undefined;
  conversation: readonly ConversationEntry[] | undefined;
  jumps: ThreadJumps;
  onView: (view: PullRequestView) => void;
}): ConversationAnchors {
  const { pullRequestUrl, conversation, jumps, onView } = input;
  const [entry, setEntry] = useState<{ readonly url: string; readonly ask: number } | undefined>(
    undefined,
  );
  // Note that the asks are counted apart from the one standing, which a landing lets go, so the same link pressed again is a new ask its card answers.
  const asks = useRef(0);
  const [kept, setKept] = useState<string | undefined>(undefined);
  const open: OpenHere = (href) => {
    const anchor =
      pullRequestUrl === undefined || conversation === undefined
        ? undefined
        : anchorIn(href, pullRequestUrl, conversation);
    if (anchor === undefined) return false;
    if (anchor.kind === ANCHOR_KIND.THREAD) {
      if (anchor.thread.id === undefined) return false;
      jumps.jump(anchor.thread, PULL_REQUEST_THREAD_VIEW.CONVERSATION);
      return true;
    }
    onView(PULL_REQUEST_VIEW.CONVERSATION);
    setKept(anchor.entry.url);
    asks.current += 1;
    setEntry({ url: anchor.entry.url, ask: asks.current });
    return true;
  };
  const landing =
    entry === undefined
      ? undefined
      : {
          target: entry.url,
          ask: entry.ask,
          scroll: centreCard,
          onLanded: (ask: number) => setEntry((was) => (was?.ask === ask ? undefined : was)),
          onFaded: () => undefined,
        };
  return { open, landing, kept };
}

/**
 * One agent's Pull request tab, laid out as stage-cli's pull request page:
 * a fixed header that stays put while what is under it scrolls (the pill
 * saying where it stands, its title and number, and, while it is open, the
 * merge control, in one row; then its branches, who opened it and
 * when, and its reviewers, in one line), then a row of tabs, Conversation,
 * Checks, Chapters, and Files changed (`AgentChangesTab`), each with its count, and
 * Review at its end while it is open. Each tab stands once shown, the others hidden, so
 * switching draws what each last read rather than asking GitHub again. The
 * header's reads, the pull request and its conversation, whose reviews say
 * where each reviewer stands, are asked as the tab is shown; the checks, the
 * chapters, and the files as their tab is first shown, the files also as
 * Chapters is, whose diff draws them. Only a read saying there is no
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
  /** The plan's repository, whose files a gap between a diff's hunks is read from; none opens no gap. */
  repository: string | null;
  /** Whether the tree beside File tabs and the files is open, and its toggle. */
  tree: TreeShown;
  view: PullRequestView;
  onView: (view: PullRequestView) => void;
  /** Hears what the side panel's toolbar ⋯ offers while the tab is drawn, Open on GitHub and Refresh (`useHandedTabActions`); none where no toolbar draws them. */
  onActions?: HandTabActions | undefined;
  /** Runs the shown pull request's branch in a terminal of this Mac in the side panel, which the header's Run offers; none where the platform has no Mac terminal or no repository is known. A fork's pull request offers none, whatever this holds. */
  onRun?: (() => void) | undefined;
}

/**
 * How far the view shown is scrolled before the header folds, in CSS
 * pixels, and how near its top it unfolds again: apart, so a scroll resting
 * on the line does not fold and unfold it in turn.
 */
const HEADER_FOLD = { AT: 48, BACK: 8 } as const;

/**
 * The views' own scrollers, whose scroll alone folds the header: the
 * Checks' page column, the Conversation's scroller, and the diff list's.
 */
const VIEW_SCROLLER =
  ".luke-detail-page-main, .pull-request-view > .luke-scroll-area, .diff-list > .luke-scroll-area";

/**
 * Whether `box` is the shown view's own scroller, drawn in the tab at
 * `root`: never a box nested in it, such as a comment's field or its
 * preview, nor one a popover portals out of the tab, nor a hidden view's.
 */
function viewScroller(box: Element, root: Element): boolean {
  const view = box.closest(".pull-request-view");
  return (
    box.matches(VIEW_SCROLLER) &&
    box.parentElement?.closest(VIEW_SCROLLER) === null &&
    root.contains(box) &&
    view instanceof HTMLElement &&
    !view.hidden
  );
}

/** Whether the header is folded, the box it stands in, and what the tab's root hears its scrolls by. */
interface HeaderFold {
  readonly folded: boolean;
  readonly header: React.RefObject<HTMLElement | null>;
  readonly onScrollCapture: (event: React.UIEvent<HTMLElement>) => void;
}

/**
 * Whether the header is folded to its title's one line, as the shown view's
 * own scroller is scrolled down, and what the tab's root hears every scroll
 * in it by. A scroll that leaves its box's top where it was is a sideways
 * one, an unwrapped diff's, and is no scroll down. It folds only where the
 * view runs on past its box by more than the header's height, which is more
 * than folding gives back, so the box grown by the fold still stands
 * scrolled rather than back at its top, which would unfold it at once. The
 * view switched to starts unfolded. It is held on every width, and only a
 * narrow room's stylesheet folds it (tasks.css), so the desktop's header
 * stays put.
 */
function useHeaderFold(view: PullRequestView): HeaderFold {
  const [fold, setFold] = useState<{ readonly view: PullRequestView; readonly folded: boolean }>({
    view,
    folded: false,
  });
  const header = useRef<HTMLElement>(null);
  const tops = useRef(new WeakMap<Element, number>());
  return {
    folded: fold.view === view && fold.folded,
    header,
    onScrollCapture: (event) => {
      const box = event.target;
      if (!(box instanceof Element) || !viewScroller(box, event.currentTarget)) return;
      const top = box.scrollTop;
      const was = tops.current.get(box) ?? 0;
      tops.current.set(box, top);
      if (top === was) return;
      const room = box.scrollHeight - box.clientHeight > (header.current?.offsetHeight ?? 0);
      setFold((held) => {
        const folded =
          held.view === view && held.folded ? top > HEADER_FOLD.BACK : top > HEADER_FOLD.AT && room;
        return held.view === view && held.folded === folded ? held : { view, folded };
      });
    },
  };
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
  onActions,
  onRun,
}: AgentPullRequestTabProps): React.JSX.Element {
  // The agent, archived or not, since an archived agent's pull request keeps its tab.
  const agent =
    control.agents?.find((each) => each.id === agentId) ??
    control.archived?.find((each) => each.id === agentId);
  const status = agent?.status;
  const ended = !agentStillWriting(status ?? CODING_AGENT_STATUS.RUNNING);
  const id = useId();
  // A phone names each of the tabs in words, never their glyphs alone, which a finger cannot hover for a name.
  const tabsFold =
    useContext(ShellRoomContext) === SHELL_ROOM.NARROW
      ? CHOICE_BAR_FOLD.WORDS
      : CHOICE_BAR_FOLD.TOGETHER;
  const ids = (each: PullRequestView) => ({
    tab: `${id}-${each}-tab`,
    panel: `${id}-${each}-panel`,
  });
  // The header's reads are asked as the tab is shown, the conversation among them for where its reviewers stand, and the checks for the deployments its Preview opens.
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
    shown,
    ended,
    (id: string) => control.readOverviewChecks(id, number),
    UNANSWERED,
  );
  const ask = {
    pullRequest: pullRequestRead.ask,
    checks: checksRead.ask,
    conversation: conversationRead.ask,
  };
  // Refresh reads again the header's reads, the checks among them, and the chapters where their tab was shown, never before,
  // and what the agent published, which names this tab and its pin by the pull request's title.
  const refresh = () => {
    ask.pullRequest();
    ask.conversation();
    ask.checks();
    if (askedYet(chapters)) chapters.ask();
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
  const held = headerPullRequestOf(landed(parts.pullRequest), landed(parts.checks), published);
  const none = [parts.pullRequest, parts.checks, parts.conversation].some(
    (part) => part.kind === PART.NONE,
  );
  // The toolbar's ⋯ opens the pull request on GitHub and reads it again while the header draws it,
  // Refresh dimmed while a read is out; a read saying there is none takes them away with the header.
  const refreshNow = useRef(refresh);
  refreshNow.current = refresh;
  const url = none ? undefined : held?.url;
  const handed = useMemo(
    () =>
      url === undefined ? undefined : pullRequestActions(url, reading, () => refreshNow.current()),
    [url, reading],
  );
  useHandedTabActions(onActions, handed);
  // Files changed's reads, held here so its tab's count reads the same marks it draws, and the
  // Chapters view draws the same files and marks; asked as either is first shown.
  const changes = useChangesReads(
    agentId,
    control,
    shown && !none && (view === PULL_REQUEST_VIEW.FILES || view === PULL_REQUEST_VIEW.CHAPTERS),
  );
  // The Chapters view's chunk is asked for only once the view is first shown.
  const [chaptersSeen, setChaptersSeen] = useState(false);
  if (!chaptersSeen && view === PULL_REQUEST_VIEW.CHAPTERS) setChaptersSeen(true);
  // The chapters, read as their view is first shown, which its tab counts once they are ready.
  const chapters = useChaptersRead(
    agentId,
    control,
    shown && !none && view === PULL_REQUEST_VIEW.CHAPTERS,
  );
  const overview = landed(parts.pullRequest);
  const title = overview ?? published;
  // Review stands at the end of the tabs once the pull request is held, whatever it stands as, because GitHub takes a review of one merged or closed too; where GitHub refuses one, as on a locked conversation, the panel says why in GitHub's words.
  const reviewable = held !== undefined;
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
  // The member's pending comments drawn among the threads on their lines, a reply in its thread's card.
  const drafts = pendingReview?.drafts;
  const pendingComments = useMemo<PendingComments>(
    () => new Map((drafts ?? []).map((draft) => [draft.id, draft])),
    [drafts],
  );
  const filesThreads = useMemo(
    () => pendingThreadsOf(threadList, drafts ?? []),
    [threadList, drafts],
  );
  const drawThread = useCallback<ChangesThreads["draw"]>(
    (thread, place) => <InlineThread thread={thread} place={place} now={now} picture={picture} />,
    [now, picture],
  );
  const changesThreads = useMemo<ChangesThreads>(
    () => ({ list: filesThreads, draw: drawThread, refresh: conversationRead.ask }),
    [filesThreads, drawThread, conversationRead.ask],
  );
  const threadJumps = useThreadJumps({
    agentId,
    planId: agent?.planId ?? null,
    number,
    shown,
    threads: threadList,
    conversation: parts.conversation,
    onView,
  });
  const anchors = useConversationAnchors({
    pullRequestUrl: title?.url,
    conversation: conversation?.conversation,
    jumps: threadJumps.jumps,
    onView,
  });
  const kept = new Set(
    [threadJumps.kept, anchors.kept].filter((each): each is string => each !== undefined),
  );
  const fold = useHeaderFold(view);
  // Every review thread the tab draws, in the Conversation or on its line, replies and resolves on this agent's pull request.
  const page = (
    <ThreadWritesProvider value={{ agentId, onWritten: written }}>
      <ThreadJumpContext.Provider value={threadJumps.jumps}>
        <AnchorsContext.Provider value={anchors.open}>
          <Fill
            className="file-view pull-request-tab ph-no-capture"
            onScrollCapture={fold.onScrollCapture}
          >
            <PullRequestWriteNote writes={writes} />
            {none ? (
              <EmptyState icon={<GitPullRequestIcon />}>
                {PULL_REQUEST_WORDS.NO_PULL_REQUEST}
              </EmptyState>
            ) : (
              <>
                <header
                  ref={fold.header}
                  className="pull-request-header"
                  data-folded={fold.folded ? "" : undefined}
                >
                  <div className="pull-request-title-row">
                    <HeaderTitle title={title} writes={writes} />
                    {held === undefined ? null : (
                      <div className="pull-request-state">
                        <PullRequestStateMenu
                          pullRequest={held}
                          queued={overview?.merging?.queued}
                          writes={writes}
                        />
                      </div>
                    )}
                    <div className="pull-request-title-actions">
                      <PreviewControl checks={landed(parts.checks)} shown={shown} />
                      {/* Note that Run waits for the overview to say the head is the base repository's own, and a fork's pull request offers none, because a run makes its worktree on the head's branch name in the base repository's clone, where a fork's name could be another branch's. */}
                      {onRun === undefined ||
                      held === undefined ||
                      overview === undefined ||
                      overview.headOwner !== undefined ? null : (
                        <Button
                          variant={BUTTON_VARIANT.OUTLINE}
                          icon={<PlayIcon />}
                          label={PULL_REQUEST_WORDS.RUN_LABEL}
                          onClick={onRun}
                        >
                          {PULL_REQUEST_WORDS.RUN}
                        </Button>
                      )}
                      {overview === undefined ? null : (
                        <MergeControl
                          pullRequest={overview}
                          repository={repository}
                          shown={shown}
                          writes={writes}
                        />
                      )}
                    </div>
                  </div>
                  <PullRequestHead
                    parts={parts}
                    now={now}
                    writes={writes}
                    editing={{ options, refreshing: pullRequestRead.out }}
                  />
                </header>
                <div className="pull-request-tabs">
                  <div className="pull-request-tab-bar">
                    <ChoiceBar<PullRequestView>
                      label="Pull request"
                      items={tabsOf(parts, published, held, changes, chapters)}
                      value={view}
                      onChange={onView}
                      look={CHOICE_BAR_LOOK.FILL}
                      fold={tabsFold}
                      panels={ids}
                    />
                  </div>
                  {reviewable ? (
                    <PullRequestReview
                      writes={review}
                      pending={pendingReview}
                      pendingList={
                        drafts === undefined || drafts.length === 0 ? null : (
                          <PendingList drafts={drafts} now={now} picture={picture} />
                        )
                      }
                    />
                  ) : null}
                </div>
                <Fill
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
                    kept={kept}
                    landing={threadJumps.conversationLanding ?? anchors.landing}
                  />
                </Fill>
                <Fill
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
                </Fill>
                <Fill
                  className="pull-request-view"
                  role="tabpanel"
                  id={ids(PULL_REQUEST_VIEW.CHAPTERS).panel}
                  aria-labelledby={ids(PULL_REQUEST_VIEW.CHAPTERS).tab}
                  hidden={view !== PULL_REQUEST_VIEW.CHAPTERS}
                >
                  {chaptersSeen ? (
                    <Suspense
                      fallback={<SpinnerRegion delay label={PULL_REQUEST_WORDS.READING_CHAPTERS} />}
                    >
                      <AgentChaptersTab
                        agentId={agentId}
                        control={control}
                        shown={shown && view === PULL_REQUEST_VIEW.CHAPTERS}
                        repository={repository}
                        tree={tree}
                        chapters={chapters}
                        changes={changes}
                        threads={changesThreads}
                        lineComments={{ pending: pendingReview, onWritten: written }}
                      />
                    </Suspense>
                  ) : null}
                </Fill>
              </>
            )}
            <Fill
              className="pull-request-view"
              role="tabpanel"
              id={ids(PULL_REQUEST_VIEW.FILES).panel}
              aria-labelledby={ids(PULL_REQUEST_VIEW.FILES).tab}
              hidden={none || view !== PULL_REQUEST_VIEW.FILES}
            >
              <PendingSurfaceProvider value={shown && !none && view === PULL_REQUEST_VIEW.FILES}>
                <AgentChangesTab
                  agentId={agentId}
                  control={control}
                  shown={shown && !none && view === PULL_REQUEST_VIEW.FILES}
                  repository={repository}
                  tree={tree}
                  threads={changesThreads}
                  lineComments={{ pending: pendingReview, onWritten: written }}
                  reads={changes}
                  reveal={threadJumps.filesReveal}
                />
              </PendingSurfaceProvider>
            </Fill>
          </Fill>
        </AnchorsContext.Provider>
      </ThreadJumpContext.Provider>
    </ThreadWritesProvider>
  );
  // The member's own pending comments, told apart wherever a comment is drawn (`pending-comments.tsx`).
  return <PendingCommentsProvider value={pendingComments}>{page}</PendingCommentsProvider>;
}
