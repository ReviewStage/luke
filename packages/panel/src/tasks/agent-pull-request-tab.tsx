import { githubAvatarAt, githubAvatarUrl } from "@repo/features/account-picture";
import {
  AGENT_CALL_FAILURE,
  type AgentCallFailure,
  type AgentPullRequestReadParams,
  PULL_REQUEST_PART,
  type PullRequestPart,
} from "@repo/features/agent-view";
import {
  type AgentOverviewChecks,
  type AgentOverviewConversation,
  type AgentOverviewPullRequest,
  type AgentPullRequest,
  CHANGES_BOUNDS,
  CHECK_STATE,
  CHECK_SUMMARY,
  type CheckState,
  type CheckSummary,
  CONVERSATION_ENTRY,
  type ConversationEntry,
  DEPLOYMENT_STATE,
  type DeploymentState,
  type GitHubPerson,
  type PendingReviewComment,
  PULL_REQUEST_STATE,
  type PullRequestCheck,
  type PullRequestDeployment,
  type PullRequestLabel,
  type PullRequestReviewer,
  REVIEW_STATE,
  type ReactionGroup,
  type ReviewThread,
} from "@repo/features/agent-wire";
import {
  LINK_PLACE,
  type LinkPlace,
  PULL_REQUEST_THREAD_VIEW,
  type PullRequestThreadView,
} from "@repo/features/link-grammar";
import { formatCount } from "@repo/features/number-format";
import type { FailureSurface } from "@repo/features/shown-failure";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import { workingTime } from "@repo/features/time-format";
import { INLINE_DIFF } from "@repo/settings/diff-view";
import {
  AVATAR_SHAPE,
  AVATAR_SIZE,
  Avatar,
  BLOCK_LIST_ELEMENT,
  BlockList,
  BlockListItem,
  BUTTON_VARIANT,
  Button,
  ButtonLink,
  CHIP_LOOK,
  CHOICE_BAR_FOLD,
  CHOICE_BAR_LOOK,
  Chip,
  ChipCount,
  ChipName,
  ChoiceBar,
  type ChoiceItem,
  Comment,
  type CountPart,
  CountParts,
  DETAIL_PAGE_INSET,
  DetailPage,
  DISCLOSURE_SUMMARY,
  DisclosureChevron,
  DisclosureFrame,
  DisclosureSummary,
  EmptyState,
  ErrorState,
  Fill,
  GAP,
  LAYOUT_ELEMENT,
  LINE_BUTTON_LOOK,
  LIST_DENSITY,
  LIST_VARIANT,
  LineButton,
  List,
  ListRow,
  linesCount,
  MENU_DETAIL,
  MoreButton,
  moreLabel,
  OneLine,
  PAGE_FRAME,
  PaneBar,
  SCROLL_FADE,
  SCROLL_FADE_INSET,
  SCROLL_GUTTER,
  ScrollArea,
  SKELETON_SHAPE,
  Skeleton,
  SkeletonRegion,
  SPINNER_SIZE,
  SpinnerRegion,
  SpinnerRing,
  STATUS_TONE,
  Stack,
  type StatusTone,
  TEXT_ELEMENT,
  TEXT_FONT,
  TEXT_LINK_LOOK,
  TEXT_VARIANT,
  Text,
  TextLink,
  TIME_LOOK,
  Time,
  Tooltip,
  useMenu,
  useMinute,
  VisuallyHidden,
} from "@repo/ui";
import { actorName } from "@repo/ui/actor-model";
import {
  CheckIcon,
  CircleSlashIcon,
  ExternalLinkIcon,
  GLYPH,
  MessagesSquareIcon,
  RotateCwIcon,
  ScanSearchIcon,
  TriangleAlertIcon,
  XIcon,
} from "@repo/ui/icons";
import { landedMark } from "@repo/ui/landed";
import { PICTURE_STATE, usePicture } from "@repo/ui/picture-read";
import {
  VIRTUAL_ROWS_ANCHOR,
  type VirtualRowPlace,
  VirtualRows,
  type VirtualRowsHandle,
} from "@repo/ui/virtual-rows";
import { type UseQueryResult, useMutation, useQuery } from "@tanstack/react-query";
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  type RefObject,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ACTOR_SIZE, ActorMark, ActorRef, BotBadge, commentAuthor } from "../actor-ref.js";
import { Fold, FoldBody } from "../ai-elements/fold.js";
import { appPlatform } from "../app-platform.js";
import { commandAction, PANEL_COMMAND } from "../command-items.js";
import { LINK_COPY, useCopyToast } from "../copy-feedback.js";
import { useCopyLinkItem } from "../copy-link-item.js";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import {
  type HandTabActions,
  HandTabActionsContext,
  type TabActionGroups,
  useHandedTabActions,
} from "../desktop/strip-tabs.js";
import { failureShown, pictureUnread } from "../failure-report.js";
import { useFindOpen } from "../find-in-tab.js";
import { lazyRoute } from "../lazy-route.js";
import {
  pullRequestChecksQuery,
  pullRequestConversationQuery,
  pullRequestPartRetryMutation,
  pullRequestPublishedQuery,
  pullRequestQuery,
} from "../live-reads.js";
import { pictureQuery } from "../picture-query.js";
import { scrollerOf } from "../scroll-within.js";
import { SHELL_ROOM } from "../shell-room.js";
import { ShellRoomContext, usePhoneRoom } from "../stage-room.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { type FindRow, useVirtualFind } from "../virtual-find.js";
import {
  AgentChangesTab,
  type ChangesReads,
  type ChangesReveal,
  type ChangesThreads,
  THREAD_PLACE,
  type ThreadPlace,
  useChangesReads,
} from "./agent-changes-tab.js";
import { pullRequestNumberLabel } from "./agent-model.js";
import {
  AnnotationCard,
  AnnotationComment,
  AnnotationComments,
  type AnnotationReply,
} from "./annotation-card.js";
import { threadPreview } from "./changes-model.js";
import { CHAPTERS_SHOWN, chapterPaths, chaptersShown, chapterViewed } from "./chapters-model.js";
import { type ChaptersRead, useChaptersRead } from "./chapters-read.js";
import {
  type ConversationFilters,
  type ConversationFiltersControl,
  type ConversationHidden,
  conversationHidden,
  filteredConversation,
  useConversationFilters,
} from "./conversation-filters.js";
import { DiffListTopRoomContext } from "./diff-list.js";
import { PierreDiff, useDiffLook } from "./file-diff.js";
import type { TreeShown } from "./file-view.js";
import { MergeControl } from "./merge-box.js";
import {
  PENDING_WORDS,
  PendingComment,
  type PendingComments,
  PendingCommentsProvider,
  PendingSurfaceProvider,
  PendingWords,
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
import { PullRequestDescription } from "./pull-request-description.js";
import { PullRequestLabels } from "./pull-request-labels.js";
import { PullRequestNumberProvider, pullRequestAsked } from "./pull-request-number.js";
import { HeaderReviewers, OpenedLine, ReviewStanding, useNamer } from "./pull-request-people.js";
import {
  LabelPicker,
  type PullRequestPicks,
  ReviewerPicker,
  type ReviewOptions,
  usePullRequestPicks,
  useReviewOptions,
} from "./pull-request-pickers.js";
import { EntryPictures, useGitHubImageRead, usePictureDrawer } from "./pull-request-pictures.js";
import { Reactions } from "./pull-request-reactions.js";
import { PullRequestReview } from "./pull-request-review.js";
import {
  type PullRequestSource,
  PullRequestSourceProvider,
  useAgentPullRequestSource,
} from "./pull-request-source.js";
import { PullRequestStack } from "./pull-request-stack.js";
import { ThreadActions, ThreadWritesProvider } from "./pull-request-thread-actions.js";
import {
  PullRequestStateMenu,
  PullRequestTitle,
  PullRequestTitleLine,
  PullRequestWriteNote,
  type PullRequestWrites,
  type ReadAgain,
  usePullRequestWrites,
  WritePlaceProvider,
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
import type { AgentsControl } from "./use-agents.js";
import { type LinkStanding, PULL_REQUEST_MOMENT, usePlaceStanding } from "./use-link-standing.js";
import {
  linkPressOf,
  type OpenHere,
  OpenHereFirst,
  useOpenLink,
  useOpenPlace,
} from "./use-open-link.js";
import { PULL_REQUEST_VIEW, type PullRequestView } from "./use-side-panel.js";

const CHAPTERS_TAB = lazyRoute(() =>
  import("./agent-chapters-tab.js").then((loaded) => loaded.AgentChaptersTab),
);

const VIEW_CLASS =
  "pull-request-view [--ui-scroll-band:var(--pull-request-band)] [&[hidden]]:hidden";

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
  PREVIEW: "Preview",
  PREVIEWS: "Preview deployments",
  NO_DESCRIPTION: "No description provided.",
  NO_CHECKS: "No checks have run on this pull request.",
  NO_CONVERSATION: "Nobody has commented yet.",
  NO_MATCHING: "No matching comments.",
  HIDE_BOTS: "Hide bots",
  HIDE_RESOLVED: "Hide resolved",
  FILTERS: "Conversation filters",
  SHOWING_ALL: "Showing all",
  HIDING_RESOLVED: "Hiding resolved",
  HIDING_BOTS: "Hiding bots",
  HIDING_BOTH: "Hiding resolved and bots",
  hiddenBots: (count: number) =>
    `Hides ${count} ${count === 1 ? "comment or review" : "comments and reviews"} by bots`,
  hiddenResolved: (count: number) =>
    `Hides ${count} resolved review ${count === 1 ? "thread" : "threads"}`,
  earlier: (count: number) => `${count} earlier ${count === 1 ? "comment" : "comments"} on GitHub`,
  moreReplies: (count: number) => `${count} more ${count === 1 ? "reply" : "replies"} on GitHub`,
  commentCount: (count: number) => `${count} ${count === 1 ? "comment" : "comments"}`,
  RESOLVED: "Resolved",
  OUTDATED: "Outdated",
  THREAD: "Review thread",
  BY: "by",
  LEFT: "left",
  total: (additions: number, deletions: number) =>
    `+${formatCount(additions)} −${formatCount(deletions)} total`,
} as const;

function threadLines(
  thread: Pick<ReviewThread, "line" | "startLine" | "originalLine" | "originalStartLine">,
): string | undefined {
  const line = thread.line ?? thread.originalLine;
  const start = thread.line === null ? thread.originalStartLine : thread.startLine;
  if (line === null) return undefined;
  return start === null || start === line ? `line ${line}` : `lines ${start}–${line}`;
}

const UNANSWERED = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;

const PART = {
  PENDING: "pending",
  FAILED: "failed",
  NONE: "none",
  LANDED: "landed",
} as const;

type Part<A> =
  | { readonly kind: typeof PART.PENDING }
  | { readonly kind: typeof PART.FAILED; readonly failed: { readonly failure: AgentCallFailure } }
  | { readonly kind: typeof PART.NONE }
  | { readonly kind: typeof PART.LANDED; readonly value: A };

interface PartRead<A> {
  readonly answer:
    | { readonly pullRequest: A | null }
    | { readonly failure: AgentCallFailure }
    | undefined;
  readonly out: boolean;
  readonly ask: () => Promise<void>;
}

function usePartRead<Answer>(
  held: UseQueryResult<Answer>,
  part: PullRequestPart,
  asked: AgentPullRequestReadParams | undefined,
) {
  const [asking, setAsking] = useState(0);
  const { mutateAsync: retry } = useMutation(pullRequestPartRetryMutation());
  const agentId = asked?.agentId;
  const number = asked?.number;
  const ask = useCallback(() => {
    if (agentId === undefined) return Promise.resolve();
    setAsking((count) => count + 1);
    return retry(number === undefined ? { part, agentId } : { part, agentId, number })
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => setAsking((count) => count - 1));
  }, [retry, part, agentId, number]);
  const answer = held.data ?? (held.isError ? UNANSWERED : undefined);
  return { answer, out: asking > 0 || held.isPending, ask };
}

function partOf<A>(read: PartRead<A>): Part<A> {
  const { answer, out } = read;
  if (answer === undefined || (out && "failure" in answer)) return { kind: PART.PENDING };
  if ("failure" in answer) return { kind: PART.FAILED, failed: answer };
  return answer.pullRequest === null
    ? { kind: PART.NONE }
    : { kind: PART.LANDED, value: answer.pullRequest };
}

function landed<A>(part: Part<A>): A | undefined {
  return part.kind === PART.LANDED ? part.value : undefined;
}

const CHECK_GLYPHS = {
  [CHECK_STATE.FAILED]: <XIcon />,
  [CHECK_STATE.PENDING]: <SpinnerRing />,
  [CHECK_STATE.PASSED]: <CheckIcon />,
  [CHECK_STATE.SKIPPED]: <CircleSlashIcon />,
} as const satisfies Record<CheckState, ReactNode>;

const CHECK_INK = {
  [CHECK_STATE.FAILED]: "text-destructive",
  [CHECK_STATE.PENDING]: "text-muted-foreground",
  [CHECK_STATE.PASSED]: "text-complete",
  [CHECK_STATE.SKIPPED]: "text-muted-foreground",
} as const satisfies Record<CheckState, string>;

const CHECK_WORDS = {
  [CHECK_STATE.FAILED]: "failed",
  [CHECK_STATE.PENDING]: "running",
  [CHECK_STATE.PASSED]: "passed",
  [CHECK_STATE.SKIPPED]: "skipped",
} as const satisfies Record<CheckState, string>;

const DEPLOYMENT_TONE = {
  [DEPLOYMENT_STATE.READY]: CHECK_STATE.PASSED,
  [DEPLOYMENT_STATE.PENDING]: CHECK_STATE.PENDING,
  [DEPLOYMENT_STATE.FAILED]: CHECK_STATE.FAILED,
  [DEPLOYMENT_STATE.INACTIVE]: CHECK_STATE.SKIPPED,
} as const satisfies Record<DeploymentState, CheckState>;

const DEPLOYMENT_WORDS = {
  [DEPLOYMENT_STATE.READY]: "Deployed",
  [DEPLOYMENT_STATE.PENDING]: "Deploying",
  [DEPLOYMENT_STATE.FAILED]: "Failed",
  [DEPLOYMENT_STATE.INACTIVE]: "Inactive",
} as const satisfies Record<DeploymentState, string>;

const CHECK_ORDER: readonly CheckState[] = [
  CHECK_STATE.FAILED,
  CHECK_STATE.PENDING,
  CHECK_STATE.PASSED,
  CHECK_STATE.SKIPPED,
];

const CHECK_AVATAR_PIXELS = 16;
const CHECK_AVATAR_DENSITY = 2;

const RAN_AT_LEAST_MS = 1_000;

function durationOf(check: PullRequestCheck): string | undefined {
  if (check.startedAt === null || check.completedAt === null) return undefined;
  const ran = check.completedAt - check.startedAt;
  return ran < RAN_AT_LEAST_MS ? undefined : workingTime(ran);
}

function pullRequestActions(
  url: string,
  reading: boolean,
  copy: (words: string, label: string) => void,
  onRefresh: () => void,
): MenuAction[] {
  return [
    commandAction(PANEL_COMMAND.COPY_GITHUB_LINK, () => copy(url, LINK_COPY.COPIED), false),
    commandAction(PANEL_COMMAND.OPEN_ON_GITHUB, () => appPlatform().openGitHub(url), true),
    {
      label: "Refresh",
      icon: <RotateCwIcon aria-hidden="true" />,
      disabled: reading,
      onSelect: onRefresh,
    },
  ];
}

type HeaderPullRequest = Pick<AgentPullRequest, "number" | "state" | "checks" | "url">;

function checksSummaryOf(checks: readonly PullRequestCheck[]): CheckSummary {
  if (checks.some((check) => check.state === CHECK_STATE.FAILED)) return CHECK_SUMMARY.FAILING;
  if (checks.some((check) => check.state === CHECK_STATE.PENDING)) return CHECK_SUMMARY.PENDING;
  return checks.length === 0 ? CHECK_SUMMARY.NONE : CHECK_SUMMARY.PASSING;
}

function headerPullRequestOf(
  pullRequest: AgentOverviewPullRequest | undefined,
  checks: AgentOverviewChecks | undefined,
  published: AgentPullRequest | undefined,
): HeaderPullRequest | undefined {
  const held = pullRequest ?? published;
  if (held === undefined) return undefined;
  const { number, state, url } = held;
  const heldChecks = published?.number === number ? published.checks : undefined;
  const merged = pullRequest?.merging?.checks;
  const summary = checks === undefined ? (heldChecks ?? merged) : checksSummaryOf(checks.checks);
  return { number, state, url, checks: summary ?? CHECK_SUMMARY.NONE };
}

function headerQueuedOf(
  pullRequest: AgentOverviewPullRequest | undefined,
  published: AgentPullRequest | undefined,
  number: number,
): { readonly position?: number } | null | undefined {
  if (pullRequest !== undefined) return pullRequest.merging?.queued;
  return published?.number === number && published.queued === true ? {} : undefined;
}

function reviewersOf(
  requested: readonly AgentOverviewPullRequest["requested"][number][],
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

interface SectionFold {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function Section({
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
      variant={TEXT_VARIANT.GROUP}
      truncate
      className="pull-request-heading mx-0 mt-0 mb-item-gap flex items-baseline gap-item-gap px-row-inset"
    >
      <OneLine className="flex-initial">{title}</OneLine>
      {count === undefined ? null : (
        <span className="pull-request-count flex-none font-ui-regular text-muted-foreground tabular-nums">
          {count}
        </span>
      )}
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
      <DisclosureFrame
        actions={
          end === undefined ? undefined : (
            <span className="pull-request-section-end flex flex-none items-center gap-control-gap">
              {end}
            </span>
          )
        }
      >
        <Fold
          className="pull-request-section-fold"
          open={fold.open}
          onOpenChange={fold.onOpenChange}
        >
          <DisclosureSummary look={DISCLOSURE_SUMMARY.TRANSCRIPT}>
            <DisclosureChevron />
            {heading}
          </DisclosureSummary>
          <FoldBody className="pull-request-section-body pt-tight-gap">{children}</FoldBody>
        </Fold>
      </DisclosureFrame>
    </section>
  );
}

function CheckSquare({ name, src }: { name: string; src: string | undefined }): React.JSX.Element {
  return (
    <Avatar
      name={name}
      {...(src === undefined ? {} : { src })}
      glyph={<GLYPH.AGENT />}
      shape={AVATAR_SHAPE.SQUARE}
      size={AVATAR_SIZE.INLINE}
      tiled
      decorative
    />
  );
}

function ProxiedCheckAvatar({
  agentId,
  name,
  src,
}: {
  agentId: string;
  name: string;
  src: string;
}): React.JSX.Element {
  const state = usePicture(pictureQuery(agentId, src, useGitHubImageRead()), pictureUnread);
  return (
    <CheckSquare name={name} src={state.kind === PICTURE_STATE.READY ? state.url : undefined} />
  );
}

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

function CheckLead({
  tone,
  agentId,
  name,
  avatarUrl,
}: {
  tone: CheckState;
  agentId: string;
  name: string;
  avatarUrl: string | undefined;
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-control-gap">
      <span
        className={`inline-grid size-check-glyph flex-none place-items-center [&>svg]:size-check-glyph ${CHECK_INK[tone]}`}
        data-check-state={tone}
      >
        {CHECK_GLYPHS[tone]}
      </span>
      {avatarUrl === undefined ? null : (
        <CheckAvatar agentId={agentId} name={name} src={avatarUrl} />
      )}
    </span>
  );
}

export function CheckRow({
  agentId,
  check,
  live,
  says,
}: {
  agentId: string;
  check: PullRequestCheck;
  live: boolean;
  says?: string | undefined;
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
          <VisuallyHidden>, {CHECK_WORDS[check.state]}</VisuallyHidden>
        </>
      }
      description={says ?? check.app ?? undefined}
      meta={running ? live ? <Time at={startedAt} look={TIME_LOOK.DURATION} /> : null : duration}
      onPress={url === null ? undefined : () => openLink(url)}
      linkHref={url ?? undefined}
    />
  );
}

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
        <p className="pull-request-none m-0 px-row-inset text-caption-inline text-muted-foreground">
          {PULL_REQUEST_WORDS.NO_CHECKS}
        </p>
      ) : (
        <CheckList>
          {checks.map((check, at) => (
            <CheckRow key={`${at}`} agentId={agentId} check={check} live={live} />
          ))}
        </CheckList>
      )}
    </Section>
  );
}

export function CheckList({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <List label="Check list" variant={LIST_VARIANT.CARD} density={LIST_DENSITY.DENSE}>
      {children}
    </List>
  );
}

const CHECK_SKELETON_ROWS = [
  { name: "55%", app: "30%" },
  { name: "45%", app: "24%" },
  { name: "50%", app: "28%" },
] as const;

const CHECK_SKELETON_LEAD = "16px";

const ENTRY_SKELETON_LINES = [
  { by: "22%", words: ["85%", "60%"] },
  { by: "18%", words: ["70%"] },
] as const;

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
          <Skeleton key={at} width={width} />
        ))}
      </div>
    </SkeletonRegion>
  );
}

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

function HeadSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label={PULL_REQUEST_WORDS.READING}>
      <PeopleLine>
        <Skeleton width="65%" />
      </PeopleLine>
    </SkeletonRegion>
  );
}

function TitleSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label={PULL_REQUEST_WORDS.READING}>
      <PullRequestTitleLine>
        <Skeleton width="60%" />
      </PullRequestTitleLine>
    </SkeletonRegion>
  );
}

function PartFailure({
  line,
  surface,
  part,
  onRetry,
}: {
  line: string;
  surface: FailureSurface;
  part: Extract<Part<unknown>, { readonly kind: typeof PART.FAILED | typeof PART.NONE }>;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="pull-request-failure px-row-inset">
      <ErrorState
        failure={failureShown({
          surface,
          cause: part.kind === PART.FAILED ? part.failed : FAILURE_CONDITION.GONE,
        })}
        onRetry={onRetry}
      >
        {line}
      </ErrorState>
    </div>
  );
}

const AnchorsContext = createContext<OpenHere | undefined>(undefined);

function Anchored({ children }: { children: ReactNode }): ReactNode {
  const open = useContext(AnchorsContext);
  return open === undefined ? children : <OpenHereFirst open={open}>{children}</OpenHereFirst>;
}

function EntryWords({
  entry,
  picture,
}: {
  entry: Pick<ConversationEntry, "html" | "body">;
  picture: GitHubPictureDrawer;
}): React.JSX.Element | null {
  if (entry.html !== null) {
    return (
      <div className="pull-request-words min-w-0 select-text text-body-size leading-reading text-foreground">
        <EntryPictures html={entry.html}>
          <Anchored>
            <GitHubWords html={entry.html} picture={picture} />
          </Anchored>
        </EntryPictures>
      </div>
    );
  }
  return entry.body === "" ? null : (
    <div className="pull-request-words min-w-0 select-text text-body-size leading-reading text-foreground">
      <Anchored>
        <TranscriptWords text={entry.body} />
      </Anchored>
    </div>
  );
}

interface ThreadJumps {
  readonly jump: (thread: ReviewThread, view: PullRequestThreadView) => void;
  readonly place: (thread: ReviewThread, view: PullRequestThreadView) => LinkPlace | undefined;
}

const ThreadJumpContext = createContext<ThreadJumps | undefined>(undefined);

function useThreadJump(
  thread: ReviewThread,
  view: PullRequestThreadView,
): (() => void) | undefined {
  const jumps = useContext(ThreadJumpContext);
  return jumps === undefined || thread.id === undefined
    ? undefined
    : () => jumps.jump(thread, view);
}

function ThreadMenu({
  thread,
  here,
  there,
}: {
  thread: ReviewThread;
  here: PullRequestThreadView;
  there: PullRequestThreadView;
}): React.JSX.Element | null {
  const menu = useMenu(true);
  const jumps = useContext(ThreadJumpContext);
  const copyLink = useCopyLinkItem();
  const jump = useThreadJump(thread, there);
  const place = jumps?.place(thread, here);
  const copy = place === undefined ? undefined : copyLink(place);
  const views: MenuAction[] =
    jump === undefined || there === PULL_REQUEST_THREAD_VIEW.FILES
      ? []
      : [
          {
            label: THREAD_REVEAL_WORDS.VIEW_CONVERSATION,
            icon: <MessagesSquareIcon aria-hidden="true" />,
            onSelect: jump,
          },
        ];
  const groups = [copy === undefined ? [] : [copy], views].filter((group) => group.length > 0);
  if (groups.length === 0) return null;
  const label = moreLabel(THREAD_REVEAL_WORDS.THING);
  return (
    <span className="pull-request-thread-menu ml-auto flex">
      <MoreButton thing={THREAD_REVEAL_WORDS.THING} {...menu.trigger()} />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          replayUnmasked
          label={label}
          menu={menu.drawn}
          groups={groups}
          onClose={menu.close}
        />
      )}
    </span>
  );
}

const ENTRY_THING = { COMMENT: "Comment", REVIEW: "Review" } as const;

type EntryThing = (typeof ENTRY_THING)[keyof typeof ENTRY_THING];

function GitHubEntryMenu({ thing, url }: { thing: EntryThing; url: string }): React.JSX.Element {
  const menu = useMenu(true);
  const copy = useCopyToast();
  const groups = [
    [commandAction(PANEL_COMMAND.COPY_GITHUB_LINK, () => copy(url, LINK_COPY.COPIED), false)],
    [commandAction(PANEL_COMMAND.OPEN_ON_GITHUB, () => appPlatform().openGitHub(url), false)],
  ];
  return (
    <span className="pull-request-entry-menu flex">
      <MoreButton thing={thing} {...menu.trigger()} />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          replayUnmasked
          label={moreLabel(thing)}
          menu={menu.drawn}
          groups={groups}
          onClose={menu.close}
        />
      )}
    </span>
  );
}

function lineSpan(
  thread: Pick<ReviewThread, "line" | "startLine" | "originalLine" | "originalStartLine">,
): string | undefined {
  const line = thread.line ?? thread.originalLine;
  const start = thread.line === null ? thread.originalStartLine : thread.startLine;
  if (line === null) return undefined;
  return start === null || start === line ? `L${line}` : `L${start}–${line}`;
}

function threadStates(thread: ReviewThread, pending: boolean): readonly string[] {
  return [
    ...(thread.resolved ? [PULL_REQUEST_WORDS.RESOLVED] : []),
    ...(thread.outdated ? [PULL_REQUEST_WORDS.OUTDATED] : []),
    ...(pending ? [PENDING_WORDS.PENDING] : []),
  ];
}

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
    <span className="flex min-w-0 whitespace-nowrap px-list-inset py-tight-gap">
      {path === undefined ? null : (
        <>
          <Text
            as={TEXT_ELEMENT.SPAN}
            variant={TEXT_VARIANT.INHERIT}
            font={TEXT_FONT.MONO}
            truncate
            className="shrink-[1000] grow-0 basis-auto"
          >
            <bdi>{path.slice(0, cut + 1)}</bdi>
          </Text>
          <Text
            as={TEXT_ELEMENT.SPAN}
            variant={TEXT_VARIANT.INHERIT}
            font={TEXT_FONT.MONO}
            truncate
            className="flex-initial text-foreground"
          >
            <bdi>{path.slice(cut + 1)}</bdi>
          </Text>
        </>
      )}
      {lines === undefined ? null : (
        <span className="ms-control-gap flex-none text-muted-foreground">{lines}</span>
      )}
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
        <span>
          {actorName(writer)} <BotBadge actor={writer} />
        </span>
      ),
    time:
      first === undefined ? undefined : (
        <Time className="annotation-card-time" at={first.at} now={now} />
      ),
    states: threadStates(thread, pending),
    count: thread.comments.length + thread.more,
  };
}

function ThreadCard({
  thread,
  now,
  picture,
}: {
  thread: ReviewThread;
  now: number;
  picture: GitHubPictureDrawer;
}): React.JSX.Element {
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
              className="diff-view pull-request-thread-lines mb-control-gap flex-none overflow-y-visible border-y border-border bg-card-code select-text"
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

function ThreadComment({
  comment,
  now,
  picture,
  first,
}: {
  comment: ReviewThread["comments"][number];
  now: number;
  picture: GitHubPictureDrawer;
  first: boolean;
}): React.JSX.Element {
  const draft = usePendingComment(comment.url);
  const writer = useNamer()(comment.by);
  const words = <EntryWords entry={comment} picture={picture} />;
  const reply: AnnotationReply | undefined = first
    ? undefined
    : {
        author: commentAuthor(writer),
        nameRef: <ActorRef actor={writer} nameOnly />,
        at: comment.at,
        now,
        trailing: draft === undefined ? undefined : <PendingWords />,
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
            font={TEXT_FONT.MONO}
            truncate
            className="pull-request-pending-where text-muted-foreground"
          >
            {draft.path}
            {draft.line === null
              ? ""
              : ` · ${threadLines({ ...draft, originalLine: draft.line, originalStartLine: draft.startLine })}`}
          </Text>
          <PendingComment
            draft={draft}
            head={{ person: draft.by, at: draft.at, now }}
            words={<EntryWords entry={draft} picture={picture} />}
          />
        </BlockListItem>
      ))}
    </BlockList>
  );
}

function OnGitHubLink({ href, children }: { href: string; children: string }): React.JSX.Element {
  const openLink = useOpenLink();
  return (
    <TextLink
      href={href}
      look={TEXT_LINK_LOOK.UNDERLINED}
      external
      onClick={linkPressOf(openLink, href)}
    >
      {children}
    </TextLink>
  );
}

function ThreadComments({
  thread,
  now,
  picture,
}: {
  thread: ReviewThread;
  now: number;
  picture: GitHubPictureDrawer;
}): React.JSX.Element {
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
        <p className="annotation-card-more mr-0 mb-0 mt-ui-8 ml-annotation-more self-start max-w-full text-caption text-muted-foreground">
          <OnGitHubLink href={last.url}>{PULL_REQUEST_WORDS.moreReplies(thread.more)}</OnGitHubLink>
        </p>
      )}
    </>
  );
}

function InlineThread({
  thread,
  place,
  now,
  picture,
}: {
  thread: ReviewThread;
  place: ThreadPlace;
  now: number;
  picture: GitHubPictureDrawer;
}): React.JSX.Element {
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

const ENTRY_ESTIMATE_PX = 120;

const ENTRY_GAP_PX = 8;

const entryWordsFound = new WeakMap<ConversationEntry, string>();

function plainWords(words: Pick<ConversationEntry, "html" | "body">): string {
  if (words.html === null) return words.body;
  return new DOMParser().parseFromString(words.html, "text/html").body.textContent ?? "";
}

function entryWordsOf(entry: ConversationEntry, name: (person: GitHubPerson) => string): string {
  const kept = entryWordsFound.get(entry);
  if (kept !== undefined) return kept;
  const threads = (entry.threads ?? []).flatMap((thread) => [
    thread.path,
    ...thread.comments.flatMap((comment) => [name(comment.by), plainWords(comment)]),
  ]);
  const words = [name(entry.by), plainWords(entry), ...threads].join("\n");
  entryWordsFound.set(entry, words);
  return words;
}

function entryLandedOn(
  entries: readonly ConversationEntry[],
  target: string,
): ConversationEntry | undefined {
  return entries.find(
    (entry) => entry.url === target || (entry.threads ?? []).some((thread) => thread.id === target),
  );
}

function EntryRun({
  entries,
  scroller,
  handle,
  landing,
  now,
  picture,
}: {
  entries: readonly ConversationEntry[];
  scroller: RefObject<HTMLElement | null>;
  handle: RefObject<VirtualRowsHandle | null>;
  landing: ThreadLanding | undefined;
  now: number;
  picture: GitHubPictureDrawer;
}): React.JSX.Element {
  const keys = useMemo(() => entries.map((entry) => entry.url), [entries]);
  const latest = useRef(entries);
  latest.current = entries;
  const target = landing?.target;
  const ask = landing?.ask;
  useLayoutEffect(() => {
    if (target === undefined || ask === undefined) return;
    const entry = entryLandedOn(latest.current, target);
    if (entry !== undefined) handle.current?.bringIn(entry.url);
  }, [target, ask, handle]);
  return (
    <VirtualRows
      scroller={scroller}
      keys={keys}
      estimate={ENTRY_ESTIMATE_PX}
      gap={ENTRY_GAP_PX}
      anchor={VIRTUAL_ROWS_ANCHOR.START}
      listItems
      className="pull-request-conversation"
      handle={handle}
    >
      {(index, place) => {
        const entry = entries[index];
        return entry === undefined ? null : (
          <EntryCard entry={entry} now={now} picture={picture} place={place} />
        );
      }}
    </VirtualRows>
  );
}

function EntryList({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <Stack as={LAYOUT_ELEMENT.OL} gap={GAP.CONTROL} className="pull-request-conversation">
      {children}
    </Stack>
  );
}

function EntryFrame({
  children,
  ...props
}: Omit<ComponentProps<"li">, "className">): React.JSX.Element {
  return (
    <li
      className="pull-request-entry flex min-w-0 flex-col gap-item-gap rounded-control border border-border px-boxed-inset py-row-inset text-caption-inline"
      {...props}
    >
      {children}
    </li>
  );
}

function EntryHead({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <span className="flex min-w-0 items-center gap-control-gap text-foreground">{children}</span>
  );
}

function EntryCard({
  entry,
  now,
  picture,
  place,
}: {
  entry: ConversationEntry;
  now: number;
  picture: GitHubPictureDrawer;
  place: VirtualRowPlace;
}): React.JSX.Element {
  const threads = entry.threads ?? [];
  const writer = useNamer()(entry.by);
  const landed = useLandedEntry(entry.url);
  const { ref: measure, ...placed } = place;
  const { ref: land } = landed;
  const ref = useCallback(
    (element: HTMLElement | null) => {
      measure(element);
      land(element);
    },
    [measure, land],
  );
  return (
    <EntryFrame
      ref={ref}
      {...placed}
      tabIndex={-1}
      {...landedMark(landed.ringed)}
      onAnimationEnd={landed.onAnimationEnd}
    >
      <Comment
        author={commentAuthor(writer)}
        nameRef={<ActorRef actor={writer} nameOnly />}
        at={entry.at}
        now={now}
        trailing={
          <>
            {entry.state === undefined ? null : <ReviewStanding state={entry.state} />}
            <GitHubEntryMenu
              thing={
                entry.kind === CONVERSATION_ENTRY.REVIEW ? ENTRY_THING.REVIEW : ENTRY_THING.COMMENT
              }
              url={entry.url}
            />
          </>
        }
      >
        <EntryWords entry={entry} picture={picture} />
        <Reactions reactions={entry.reactions} subject={entry.subject} />
      </Comment>
      {threads.length === 0 ? null : (
        <Stack as={LAYOUT_ELEMENT.OL} gap={GAP.ITEM} className="pull-request-threads">
          {threads.map((thread, at) => (
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

interface OverviewParts {
  readonly pullRequest: Part<AgentOverviewPullRequest>;
  readonly checks: Part<AgentOverviewChecks>;
  readonly conversation: Part<AgentOverviewConversation>;
  readonly ask: {
    readonly pullRequest: ReadAgain;
    readonly checks: () => void;
    readonly conversation: () => void;
  };
}

function PeopleLine({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="changes-people pull-request-people flex flex-wrap items-center gap-x-field-gap gap-y-tight-gap border-b border-border px-list-inset py-row-inset text-caption text-muted-foreground">
      {children}
    </div>
  );
}

interface HeadFacts {
  readonly base: string;
  readonly head: string;
  readonly headOwner?: string | undefined;
  readonly author: GitHubPerson | undefined;
  readonly opened: number | undefined;
  readonly merged: number | undefined;
  readonly labels: readonly PullRequestLabel[];
}

function standingFactsOf(standing: LinkStanding | undefined): HeadFacts | undefined {
  const pullRequest = standing?.pullRequest;
  const branches = pullRequest?.branches;
  if (pullRequest === undefined || branches === undefined) return undefined;
  const { when } = pullRequest;
  return {
    base: branches.base,
    head: branches.head,
    author: standing?.opener,
    opened: when?.moment === PULL_REQUEST_MOMENT.OPENED ? when.at : undefined,
    merged: when?.moment === PULL_REQUEST_MOMENT.MERGED ? when.at : undefined,
    labels: pullRequest.labels,
  };
}

function PullRequestHead({
  parts,
  standing,
  now,
  writes,
  editing,
  lines,
}: {
  parts: OverviewParts;
  standing: LinkStanding | undefined;
  lines: LinesShown | undefined;
  now: number;
  writes: PullRequestWrites;
  editing: {
    readonly options: ReviewOptions;
    readonly picks: PullRequestPicks;
    readonly refreshing: boolean;
  };
}): React.JSX.Element {
  const { pullRequest: part, conversation } = parts;
  if (part.kind === PART.FAILED || part.kind === PART.NONE) {
    return (
      <PartFailure
        line={PULL_REQUEST_WORDS.FAILED}
        surface={FAILURE_SURFACE.PULL_REQUEST_READ}
        part={part}
        onRetry={parts.ask.pullRequest}
      />
    );
  }
  const { picks } = editing;
  const pullRequest = landed(part);
  const facts: HeadFacts | undefined =
    pullRequest === undefined
      ? standingFactsOf(standing)
      : {
          base: pullRequest.base,
          head: pullRequest.head,
          headOwner: pullRequest.headOwner,
          author: pullRequest.author,
          opened: pullRequest.createdAt,
          merged: pullRequest.mergedAt ?? undefined,
          labels: picks.labels,
        };
  if (facts === undefined) return <HeadSkeleton />;
  const { author, opened, merged } = facts;
  return (
    <PeopleLine>
      <span className="pull-request-branch-row flex min-w-0 max-w-full items-center gap-control-gap">
        <PullRequestBranches base={facts.base} head={facts.head} headOwner={facts.headOwner} />
        {pullRequest === undefined ? null : (
          <PullRequestStack stack={pullRequest.stack ?? []} number={pullRequest.number} />
        )}
        {lines === undefined ? null : <HeaderLines lines={lines} />}
      </span>
      {author === undefined && opened === undefined && merged === undefined ? null : (
        <OpenedLine
          person={author}
          opened={opened === undefined ? null : <Time at={opened} now={now} look={TIME_LOOK.AGO} />}
          merged={
            merged === undefined ? undefined : <Time at={merged} now={now} look={TIME_LOOK.AGO} />
          }
        />
      )}
      {pullRequest === undefined ? null : (
        <HeadPeople
          pullRequest={pullRequest}
          standings={landed(conversation)?.reviewers ?? []}
          writes={writes}
          editing={editing}
        />
      )}
      <PullRequestLabels labels={facts.labels} />
    </PeopleLine>
  );
}

function HeadPeople({
  pullRequest,
  standings,
  writes,
  editing,
}: {
  pullRequest: AgentOverviewPullRequest;
  standings: readonly PullRequestReviewer[];
  writes: PullRequestWrites;
  editing: {
    readonly options: ReviewOptions;
    readonly picks: PullRequestPicks;
    readonly refreshing: boolean;
  };
}): React.JSX.Element {
  const author = pullRequest.author?.login;
  const reviewers = reviewersOf(editing.picks.requested, standings, author);
  const open =
    pullRequest.state === PULL_REQUEST_STATE.OPEN || pullRequest.state === PULL_REQUEST_STATE.DRAFT;
  return (
    <span className="pull-request-reviewers inline-flex items-center gap-list-gap">
      {reviewers.length === 0 ? null : <HeaderReviewers reviewers={reviewers} />}
      {open ? <ReviewerPicker author={author} writes={writes} {...editing} /> : null}
      <LabelPicker writes={writes} {...editing} />
    </span>
  );
}

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
          <span>
            <ExternalLinkIcon className="block size-deployment-open" aria-hidden="true" />
          </span>
        )
      }
      onPress={url === null ? undefined : () => openLink(url)}
      linkHref={url ?? undefined}
    />
  );
}

function Deployments({
  agentId,
  deployments,
}: {
  agentId: string;
  deployments: readonly PullRequestDeployment[];
}): React.JSX.Element | null {
  if (deployments.length === 0) return null;
  return (
    <Section title="Deployments" count={formatCount(deployments.length)}>
      <List label="Deployment list" variant={LIST_VARIANT.CARD} density={LIST_DENSITY.DENSE}>
        {deployments.map((deployment) => (
          <DeploymentRow key={deployment.environment} agentId={agentId} deployment={deployment} />
        ))}
      </List>
    </Section>
  );
}

function servingOf(
  checks: AgentOverviewChecks | undefined,
): readonly (PullRequestDeployment & { readonly url: string })[] {
  return (checks?.deployments ?? []).filter(
    (deployment): deployment is PullRequestDeployment & { readonly url: string } =>
      deployment.state === DEPLOYMENT_STATE.READY && deployment.url !== null,
  );
}

function previewActions(
  checks: AgentOverviewChecks | undefined,
  openLink: (url: string) => void,
): MenuAction[] {
  return servingOf(checks).map((deployment) => ({
    label: deployment.environment,
    icon: <ScanSearchIcon />,
    detail: PULL_REQUEST_WORDS.PREVIEW,
    onSelect: () => openLink(deployment.url),
  }));
}

interface HandedViewActions {
  readonly view: PullRequestView;
  readonly actions: TabActionGroups;
}

function useViewActions(): {
  readonly held: HandedViewActions | undefined;
  readonly handFor: (view: PullRequestView) => HandTabActions;
} {
  const [held, setHeld] = useState<HandedViewActions | undefined>(undefined);
  const handFor = useCallback(
    (view: PullRequestView): HandTabActions =>
      (actions) =>
        setHeld((was) =>
          actions !== undefined ? { view, actions } : was?.view === view ? undefined : was,
        ),
    [],
  );
  return { held, handFor };
}

function PreviewControl({
  checks,
  shown,
}: {
  checks: AgentOverviewChecks | undefined;
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
        <ButtonLink
          variant={BUTTON_VARIANT.OUTLINE}
          icon={<ScanSearchIcon />}
          label={`${PULL_REQUEST_WORDS.PREVIEW} ${only.environment}`}
          href={only.url}
          onClick={linkPressOf(openLink, only.url)}
        >
          {PULL_REQUEST_WORDS.PREVIEW}
        </ButtonLink>
      </Tooltip>
    );
  }
  const actions: MenuAction[] = serving.map((deployment) => ({
    label: deployment.environment,
    icon: <ExternalLinkIcon aria-hidden="true" />,
    onSelect: () => openLink(deployment.url),
  }));
  return (
    <span className="flex">
      <Button
        variant={BUTTON_VARIANT.OUTLINE}
        icon={<ScanSearchIcon />}
        label={PULL_REQUEST_WORDS.PREVIEWS}
        trailing={formatCount(serving.length)}
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
        <PartFailure
          line={PULL_REQUEST_WORDS.CHECKS_FAILED}
          surface={FAILURE_SURFACE.PULL_REQUEST_CHECKS_READ}
          part={part}
          onRetry={parts.ask.checks}
        />
      )}
    </Section>
  );
}

function DescriptionPart({
  agentId,
  part,
  onRead,
  reactions,
  subject,
  picture,
  fold,
}: {
  agentId: string;
  part: Part<AgentOverviewPullRequest>;
  onRead: ReadAgain;
  reactions: readonly ReactionGroup[] | undefined;
  subject: string | undefined;
  picture: GitHubPictureDrawer;
  fold: SectionFold;
}): React.JSX.Element | null {
  if (part.kind === PART.FAILED || part.kind === PART.NONE) return null;
  const words =
    part.kind !== PART.LANDED || part.value.html === "" ? undefined : (
      <div className="pull-request-words min-w-0 select-text text-body-size leading-reading text-foreground">
        <EntryPictures html={part.value.html}>
          <Anchored>
            <GitHubWords html={part.value.html} picture={picture} />
          </Anchored>
        </EntryPictures>
      </div>
    );
  return (
    <Section title="Description" fold={fold}>
      {part.kind === PART.PENDING ? (
        <PartSkeleton
          label={PULL_REQUEST_WORDS.READING_DESCRIPTION}
          widths={["90%", "75%", "82%", "40%"]}
        />
      ) : part.value.canEditDescription === true && part.value.body !== undefined ? (
        <PullRequestDescription
          key={part.value.number}
          agentId={agentId}
          pullRequest={part.value}
          body={part.value.body}
          drawn={words}
          onRead={onRead}
        />
      ) : (
        (words ?? (
          <p className="pull-request-none m-0 px-row-inset text-caption-inline text-muted-foreground">
            {PULL_REQUEST_WORDS.NO_DESCRIPTION}
          </p>
        ))
      )}
      {part.kind === PART.PENDING ? null : <Reactions reactions={reactions} subject={subject} />}
    </Section>
  );
}

function ConversationPart({
  parts,
  shown,
  filterControls,
  fold,
  url,
  scroller,
  handle,
  landing,
  now,
  picture,
}: {
  parts: OverviewParts;
  shown: readonly ConversationEntry[];
  filterControls: ReactNode;
  fold: SectionFold;
  url: string | undefined;
  scroller: RefObject<HTMLElement | null>;
  handle: RefObject<VirtualRowsHandle | null>;
  landing: ThreadLanding | undefined;
  now: number;
  picture: GitHubPictureDrawer;
}): React.JSX.Element {
  const part = parts.conversation;
  if (part.kind !== PART.LANDED) {
    return (
      <Section title="Conversation" fold={fold} end={filterControls}>
        {part.kind === PART.PENDING ? (
          <ConversationSkeleton />
        ) : (
          <PartFailure
            surface={FAILURE_SURFACE.PULL_REQUEST_CONVERSATION_READ}
            part={part}
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
      fold={fold}
      end={filterControls}
    >
      {earlier === 0 || url === undefined ? null : (
        <p className="pull-request-earlier mx-0 mt-0 mb-control-gap px-row-inset self-start max-w-full text-caption text-muted-foreground">
          <OnGitHubLink href={url}>{PULL_REQUEST_WORDS.earlier(earlier)}</OnGitHubLink>
        </p>
      )}
      {conversation.length === 0 ? (
        earlier === 0 ? (
          <p className="pull-request-none m-0 px-row-inset text-caption-inline text-muted-foreground">
            {PULL_REQUEST_WORDS.NO_CONVERSATION}
          </p>
        ) : null
      ) : shown.length === 0 ? (
        <p className="pull-request-none m-0 px-row-inset text-caption-inline text-muted-foreground">
          {PULL_REQUEST_WORDS.NO_MATCHING}
        </p>
      ) : (
        <EntryRun
          entries={shown}
          scroller={scroller}
          handle={handle}
          landing={landing}
          now={now}
          picture={picture}
        />
      )}
    </Section>
  );
}

function HeaderTitle({
  title,
  writes,
}: {
  title: Pick<AgentPullRequest, "title" | "number" | "url"> | undefined;
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

function summaryCountOf(checks: readonly PullRequestCheck[], summary: CheckSummary): number {
  if (summary === CHECK_SUMMARY.FAILING) {
    return checks.filter((check) => check.state === CHECK_STATE.FAILED).length;
  }
  if (summary === CHECK_SUMMARY.PENDING) {
    return checks.filter((check) => check.state === CHECK_STATE.PENDING).length;
  }
  return checks.length;
}

const SUMMARY_GLYPHS = {
  [CHECK_SUMMARY.FAILING]: <XIcon />,
  [CHECK_SUMMARY.PENDING]: <SpinnerRing size={SPINNER_SIZE.SMALL} />,
  [CHECK_SUMMARY.PASSING]: <CheckIcon />,
  [CHECK_SUMMARY.NONE]: null,
} as const satisfies Record<CheckSummary, ReactNode>;

const SUMMARY_WORDS = {
  [CHECK_SUMMARY.FAILING]: "failing",
  [CHECK_SUMMARY.PENDING]: "running",
  [CHECK_SUMMARY.PASSING]: "passing",
  [CHECK_SUMMARY.NONE]: "none",
} as const satisfies Record<CheckSummary, string>;

const SUMMARY_TONES = {
  [CHECK_SUMMARY.FAILING]: STATUS_TONE.DANGER,
  [CHECK_SUMMARY.PENDING]: STATUS_TONE.NEUTRAL,
  [CHECK_SUMMARY.PASSING]: STATUS_TONE.COMPLETE,
  [CHECK_SUMMARY.NONE]: STATUS_TONE.NEUTRAL,
} as const satisfies Record<CheckSummary, StatusTone>;

function checksCount(
  summary: CheckSummary,
  count: number | undefined,
): readonly CountPart[] | undefined {
  const glyph = SUMMARY_GLYPHS[summary];
  if (glyph === null && count === undefined) return undefined;
  const text = count === undefined ? "" : formatCount(count);
  const tone = SUMMARY_TONES[summary];
  return [
    glyph === null ? { text, tone } : { text, tone, glyph, glyphLabel: SUMMARY_WORDS[summary] },
  ];
}

const CHAPTERS_TAB_WORDS = {
  GENERATING: "generating",
  FAILED: "failed",
  STALE: "out of date",
  VIEWED: "viewed",
} as const;

function viewedCount(viewed: number, total: number): readonly CountPart[] {
  return [
    { text: `${formatCount(viewed)}/${formatCount(total)}` },
    { text: CHAPTERS_TAB_WORDS.VIEWED, folds: true },
  ];
}

const CHAPTERS_TAB_GLYPHS = {
  GENERATING: <SpinnerRing size={SPINNER_SIZE.SMALL} />,
  FAILED: <XIcon />,
  STALE: <TriangleAlertIcon aria-hidden="true" />,
} as const;

function chaptersTabCount(
  chapters: ChaptersRead,
  changes: ChangesReads,
): readonly CountPart[] | undefined {
  const files = changes.pullRequest ?? undefined;
  const filesHead = files === undefined ? chapters.head : files.headSha;
  const state = chaptersShown(chapters.answer, chapters.generating, {
    pullRequest: chapters.head,
    files: filesHead,
  });
  if (state.kind === CHAPTERS_SHOWN.GENERATING) {
    return [
      {
        text: "",
        glyph: CHAPTERS_TAB_GLYPHS.GENERATING,
        glyphLabel: CHAPTERS_TAB_WORDS.GENERATING,
      },
    ];
  }
  if (state.kind === CHAPTERS_SHOWN.GENERATION_FAILED) {
    return [
      {
        text: "",
        tone: STATUS_TONE.DANGER,
        glyph: CHAPTERS_TAB_GLYPHS.FAILED,
        glyphLabel: CHAPTERS_TAB_WORDS.FAILED,
      },
    ];
  }
  if (state.kind !== CHAPTERS_SHOWN.READY) return undefined;
  const total = state.chapters.length;
  if (state.stale && (files !== undefined || chapters.head !== undefined)) {
    return [
      {
        text: formatCount(total),
        tone: STATUS_TONE.ATTENTION,
        glyph: CHAPTERS_TAB_GLYPHS.STALE,
        glyphLabel: CHAPTERS_TAB_WORDS.STALE,
      },
    ];
  }
  const marks = changes.viewedFiles.marks;
  const viewed =
    files === undefined || marks === undefined
      ? 0
      : state.chapters.filter((chapter) =>
          chapterViewed(chapterPaths(chapter, files.files), marks.viewed),
        ).length;
  if (viewed === 0) return [{ text: formatCount(total) }];
  return viewedCount(viewed, total);
}

interface LinesShown {
  readonly count: readonly CountPart[];
  readonly hint: string | undefined;
}

function linesOf(
  published: AgentPullRequest | undefined,
  reads: ChangesReads,
): LinesShown | undefined {
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

function filesTabCount(
  published: AgentPullRequest | undefined,
  reads: ChangesReads,
): readonly CountPart[] | undefined {
  const changes = reads.pullRequest;
  const marks = reads.viewedFiles.marks;
  const total =
    changes === null
      ? published?.changedFiles
      : changes.truncated
        ? Math.max(published?.changedFiles ?? 0, changes.files.length)
        : changes.files.length;
  if (total === undefined) return undefined;
  const viewed =
    changes === null || marks === undefined
      ? 0
      : changes.files.filter((file) => marks.viewed(file.path)).length;
  return viewed === 0 ? [{ text: formatCount(total) }] : viewedCount(viewed, total);
}

function HeaderLines({ lines }: { lines: LinesShown }): React.JSX.Element {
  const drawn = (
    <span className="pull-request-lines flex-none whitespace-nowrap text-muted-foreground">
      <CountParts parts={lines.count} />
    </span>
  );
  return lines.hint === undefined ? drawn : <Tooltip label={lines.hint}>{drawn}</Tooltip>;
}

function conversationCount(conversation: AgentOverviewConversation): number {
  const threads = conversation.conversation.reduce(
    (sum, entry) => sum + (entry.threads?.length ?? 0),
    0,
  );
  return conversation.earlier + conversation.conversation.length + threads;
}

function tabsOf(
  parts: OverviewParts,
  published: AgentPullRequest | undefined,
  held: HeaderPullRequest | undefined,
  changes: ChangesReads,
  chapters: ChaptersRead,
): readonly ChoiceItem<PullRequestView>[] {
  const conversation = landed(parts.conversation);
  const checks = landed(parts.checks);
  return [
    {
      value: PULL_REQUEST_VIEW.CONVERSATION,
      icon: <MessagesSquareIcon />,
      label: "Conversation",
      count: conversation === undefined ? undefined : formatCount(conversationCount(conversation)),
    },
    {
      value: PULL_REQUEST_VIEW.CHECKS,
      icon: <GLYPH.CHECKS />,
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
      icon: <GLYPH.PULL_REQUEST_CHAPTERS />,
      label: "Chapters",
      count: chaptersTabCount(chapters, changes),
    },
    {
      value: PULL_REQUEST_VIEW.FILES,
      icon: <GLYPH.PULL_REQUEST_CHANGES />,
      label: "Files changed",
      count: filesTabCount(published, changes),
    },
  ];
}

function ConversationFilter({
  label,
  count,
  describe,
  on,
  onChange,
}: {
  label: string;
  count: number | undefined;
  describe: (count: number) => string;
  on: boolean;
  onChange: (on: boolean) => void;
}): React.JSX.Element {
  const noteId = useId();
  const note = count === undefined ? undefined : describe(count);
  const filter = (
    <span className="pull-request-filter inline-flex">
      <Chip
        look={CHIP_LOOK.FILTER}
        aria-label={label}
        aria-pressed={on}
        aria-describedby={note === undefined ? undefined : noteId}
        onClick={() => onChange(!on)}
      >
        <ChipName>{label}</ChipName>
        {count === undefined ? null : <ChipCount>{formatCount(count)}</ChipCount>}
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

function hidingWords({ hideResolved, hideBots }: ConversationFilters): string {
  if (hideResolved && hideBots) return PULL_REQUEST_WORDS.HIDING_BOTH;
  if (hideResolved) return PULL_REQUEST_WORDS.HIDING_RESOLVED;
  if (hideBots) return PULL_REQUEST_WORDS.HIDING_BOTS;
  return PULL_REQUEST_WORDS.SHOWING_ALL;
}

function ConversationFilterMenu({
  control,
  hidden,
}: {
  control: ConversationFiltersControl;
  hidden: ConversationHidden | undefined;
}): React.JSX.Element {
  const { filters, change } = control;
  const menu = useMenu(true);
  const words = hidingWords(filters);
  const count = (each: number | undefined) => (each === undefined ? undefined : formatCount(each));
  const items: MenuAction[] = [
    {
      label: PULL_REQUEST_WORDS.HIDE_RESOLVED,
      detail: count(hidden?.resolved),
      detailPlace: MENU_DETAIL.BESIDE,
      checked: filters.hideResolved,
      stays: true,
      onSelect: () => change({ hideResolved: !filters.hideResolved }),
    },
    {
      label: PULL_REQUEST_WORDS.HIDE_BOTS,
      detail: count(hidden?.bots),
      detailPlace: MENU_DETAIL.BESIDE,
      checked: filters.hideBots,
      stays: true,
      onSelect: () => change({ hideBots: !filters.hideBots }),
    },
  ];
  return (
    <span className="pull-request-filter-menu flex min-w-0">
      <Chip
        look={CHIP_LOOK.FILTER}
        chevron
        aria-label={`${PULL_REQUEST_WORDS.FILTERS}: ${words}`}
        {...menu.trigger()}
      >
        <ChipName>{words}</ChipName>
      </Chip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          replayUnmasked
          label={PULL_REQUEST_WORDS.FILTERS}
          menu={menu.drawn}
          groups={[items]}
          onClose={menu.close}
        />
      )}
    </span>
  );
}

function ConversationFilterChips({
  control,
  hidden,
}: {
  control: ConversationFiltersControl;
  hidden: ConversationHidden | undefined;
}): React.JSX.Element {
  const { filters, change } = control;
  if (usePhoneRoom()) return <ConversationFilterMenu control={control} hidden={hidden} />;
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

function ConversationView({
  agentId,
  parts,
  url,
  comment,
  kept,
  landing,
  shown: viewShown,
}: {
  agentId: string;
  parts: OverviewParts;
  url: string | undefined;
  comment: PullRequestComment;
  kept: ReadonlySet<string>;
  landing: ThreadLanding | undefined;
  shown: boolean;
}): React.JSX.Element {
  const now = useMinute();
  const picture = usePictureDrawer(agentId);
  const choices = useConversationFilters();
  const { filters, change } = choices;
  const conversation = landed(parts.conversation)?.conversation;
  const shown = useMemo(
    () => (conversation === undefined ? [] : filteredConversation(conversation, filters, kept)),
    [conversation, filters, kept],
  );
  const scroller = useRef<HTMLDivElement>(null);
  const entries = useRef<VirtualRowsHandle>(null);
  const name = useNamer();
  const finding = useFindOpen();
  const findRows = useMemo(
    (): readonly FindRow[] =>
      finding
        ? shown.map((entry) => ({
            key: entry.url,
            words: entryWordsOf(entry, (person) => actorName(name(person))),
          }))
        : [],
    [finding, shown, name],
  );
  useVirtualFind({ root: scroller, rows: findRows, handle: entries, findable: viewShown });
  const asked = landing?.ask;
  const conversationOpen = filters.conversationOpen;
  useEffect(() => {
    if (asked !== undefined && !conversationOpen) change({ conversationOpen: true });
  }, [asked, conversationOpen, change]);
  return (
    <ScrollArea
      ref={scroller}
      role="region"
      aria-label="Pull request conversation"
      tabIndex={0}
      fade={SCROLL_FADE.START}
      fadeInset={SCROLL_FADE_INSET.BAND}
      gutter={SCROLL_GUTTER.STABLE}
    >
      <div className="pull-request-page px-pull-request-page pt-section-gap text-body text-foreground wrap-anywhere [--pull-request-page-measure:var(--ui-page-measure)]">
        <DescriptionPart
          agentId={agentId}
          part={parts.pullRequest}
          onRead={parts.ask.pullRequest}
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
            shown={shown}
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
            url={url}
            scroller={scroller}
            handle={entries}
            landing={landing}
            now={now}
            picture={picture}
          />
        </ThreadLandingProvider>
        {conversation === undefined ? null : <PullRequestCommentBox comment={comment} />}
      </div>
    </ScrollArea>
  );
}

function askedYet(read: { readonly answer: unknown; readonly out: boolean }): boolean {
  return read.answer !== undefined || read.out;
}

function reviewThreadsOf(
  conversation: AgentOverviewConversation | undefined,
): readonly ReviewThread[] {
  return conversation?.conversation.flatMap((entry) => entry.threads ?? []) ?? [];
}

interface ThreadJump {
  readonly threadId: string;
  readonly view: PullRequestThreadView;
  readonly ask: number;
}

function centerCard(card: HTMLElement): void {
  const scroller = scrollerOf(card);
  if (scroller === undefined) return;
  const padding = Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop);
  const clear = Number.isNaN(padding) ? 0 : padding;
  const box = scroller.getBoundingClientRect();
  const at = card.getBoundingClientRect();
  const top = box.top + clear;
  const centered = at.top + at.height / 2 - (top + (box.height - clear) / 2);
  scroller.scrollTop += Math.min(centered, at.top - top);
}

function useThreadJumps(input: {
  agentId: string;
  number: number | undefined;
  shown: boolean;
  threads: readonly ReviewThread[];
  conversation: Part<AgentOverviewConversation>;
  onView: (view: PullRequestView) => void;
}) {
  const { agentId, number, shown, threads, conversation } = input;
  const openPlace = useOpenPlace();
  const toast = useToast();
  const [jump, setJump] = useState<ThreadJump | undefined>(undefined);
  const [kept, setKept] = useState<string | undefined>(undefined);
  const asks = useRef(0);
  const start = useCallback((threadId: string, view: PullRequestThreadView) => {
    asks.current += 1;
    if (view === PULL_REQUEST_THREAD_VIEW.CONVERSATION) setKept(threadId);
    setJump({ threadId, view, ask: asks.current });
  }, []);
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
    thread.id === undefined || number !== undefined
      ? undefined
      : { kind: LINK_PLACE.PULL_REQUEST_THREAD, agentId, threadId: thread.id, view };
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
  const gone = jump !== undefined && conversation.kind === PART.LANDED && target === undefined;
  useEffect(() => {
    if (!gone) return;
    toast({
      replayUnmasked: true,
      words: THREAD_REVEAL_WORDS.GONE,
      tone: STATUS_TONE.DANGER,
      hold: TOAST_HOLD.FAILED,
      failure: {
        surface: FAILURE_SURFACE.PULL_REQUEST_THREAD,
        cause: FAILURE_CONDITION.GONE,
        about: { agentId, pullRequest: number },
        refused: true,
      },
    });
    setJump(undefined);
  }, [gone, toast, agentId, number]);
  const letGo = useCallback((ask: number) => {
    setJump((was) => (was?.ask === ask ? undefined : was));
  }, []);
  const conversationLanding: ThreadLanding | undefined =
    jump?.view === PULL_REQUEST_THREAD_VIEW.CONVERSATION && target?.id !== undefined
      ? {
          target: target.id,
          ask: jump.ask,
          scroll: centerCard,
          onLanded: letGo,
          onFaded: () => undefined,
        }
      : undefined;
  const filesReveal: ChangesReveal | undefined =
    jump?.view === PULL_REQUEST_THREAD_VIEW.FILES && target !== undefined
      ? {
          thread: target,
          ask: jump.ask,
          onLanded: letGo,
          onGone: (ask) => {
            if (jump.ask !== ask || target.id === undefined) return;
            toast({
              replayUnmasked: true,
              words: THREAD_REVEAL_WORDS.FILE_GONE,
              tone: STATUS_TONE.DANGER,
              hold: TOAST_HOLD.FAILED,
              failure: {
                surface: FAILURE_SURFACE.PULL_REQUEST_THREAD,
                cause: FAILURE_CONDITION.GONE,
                about: { agentId, pullRequest: number },
                refused: true,
              },
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

interface ConversationAnchors {
  readonly open: OpenHere;
  readonly landing: ThreadLanding | undefined;
  readonly kept: string | undefined;
}

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
          scroll: centerCard,
          onLanded: (ask: number) => setEntry((was) => (was?.ask === ask ? undefined : was)),
          onFaded: () => undefined,
        };
  return { open, landing, kept };
}

export function AgentPullRequestTab({
  control,
  ...props
}: AgentPullRequestTabProps): React.JSX.Element {
  const source = useAgentPullRequestSource(control, props.agentId, props.number);
  return (
    <PullRequestNumberProvider value={props.number}>
      <PullRequestSourceProvider value={source}>
        <WritePlaceProvider value={source.place}>
          <PullRequestTabBody {...props} source={source} />
        </WritePlaceProvider>
      </PullRequestSourceProvider>
    </PullRequestNumberProvider>
  );
}

interface AgentPullRequestTabProps {
  agentId: string;
  number?: number | undefined;
  control: AgentsControl;
  shown: boolean;
  repository: string | null;
  tree: TreeShown;
  view: PullRequestView;
  onView: (view: PullRequestView) => void;
  onActions?: HandTabActions | undefined;
}

const VIEW_SCROLLER =
  ".ui-detail-page-body, .ui-detail-page-main, .pull-request-view > .ui-scroll-area, .diff-list > .ui-scroll-area";

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

function shownScroller(root: Element): Element | undefined {
  return [...root.querySelectorAll(VIEW_SCROLLER)].find((box) => viewScroller(box, root));
}

function leadsView(box: Element): boolean {
  const view = box.closest(".pull-request-view");
  if (view === null) return false;
  const inset = Number.parseFloat(getComputedStyle(view).paddingTop) || 0;
  return box.getBoundingClientRect().top - view.getBoundingClientRect().top - inset < 1;
}

function glideOf(box: Element): ScrollBehavior {
  return getComputedStyle(box).getPropertyValue("--ui-scroll-glide").trim() === "auto"
    ? "instant"
    : "smooth";
}

const FOLD_PROPERTY = {
  ROOM: "--pull-request-fold-room",
  SLID: "--pull-request-fold",
  TITLE: "--pull-request-fold-title",
} as const;

interface FoldShape {
  readonly room: number;
  readonly lead: boolean;
}

const NO_FOLD: FoldShape = { room: 0, lead: false };

interface HeaderFold {
  readonly shape: FoldShape;
  readonly root: React.RefObject<HTMLElement | null>;
  readonly header: React.RefObject<HTMLElement | null>;
  readonly compact: React.RefObject<HTMLDivElement | null>;
  readonly onScrollCapture: (event: React.UIEvent<HTMLElement>) => void;
  readonly onScrollEndCapture: (event: React.UIEvent<HTMLElement>) => void;
}

function useHeaderFold(phone: boolean): HeaderFold {
  const [shape, setShape] = useState<FoldShape>(NO_FOLD);
  const root = useRef<HTMLElement>(null);
  const header = useRef<HTMLElement>(null);
  const compact = useRef<HTMLDivElement>(null);
  const measured = useRef<Element | undefined>(undefined);
  const room = useRef(0);
  const follow = (top: number) => {
    const whole = room.current;
    const slid = Math.min(Math.max(top, 0), whole);
    const line = compact.current?.offsetHeight ?? 0;
    const title = line === 0 ? 1 : Math.min(Math.max((slid - (whole - line)) / line, 0), 1);
    root.current?.style.setProperty(FOLD_PROPERTY.SLID, `${slid}px`);
    root.current?.style.setProperty(FOLD_PROPERTY.TITLE, String(title));
    header.current?.toggleAttribute("data-folded", whole > 0 && slid >= whole);
  };
  const measure = () => {
    const tab = root.current;
    const head = header.current;
    const line = compact.current;
    if (!phone || tab === null || head === null || line === null) return;
    const box = shownScroller(tab);
    const whole = Math.max(0, head.offsetHeight - line.offsetHeight);
    const lead = box !== undefined && leadsView(box);
    measured.current = box;
    room.current = whole;
    tab.style.setProperty(FOLD_PROPERTY.ROOM, `${whole}px`);
    setShape((held) => (held.room === whole && held.lead === lead ? held : { room: whole, lead }));
    follow(box?.scrollTop ?? 0);
  };
  const measureNow = useRef(measure);
  measureNow.current = measure;
  useLayoutEffect(() => measureNow.current());
  useEffect(() => {
    const tab = root.current;
    const head = header.current;
    if (!phone || tab === null || head === null) return undefined;
    const sizes = new ResizeObserver(() => measureNow.current());
    sizes.observe(tab);
    sizes.observe(head);
    return () => sizes.disconnect();
  }, [phone]);
  return {
    shape,
    root,
    header,
    compact,
    onScrollCapture: (event) => {
      const box = event.target;
      if (!phone || !(box instanceof Element) || !viewScroller(box, event.currentTarget)) return;
      if (box === measured.current) follow(box.scrollTop);
      else measure();
    },
    onScrollEndCapture: (event) => {
      const box = event.target;
      if (!phone || !(box instanceof Element) || box !== measured.current) return;
      const top = box.scrollTop;
      const whole = room.current;
      const end = box.scrollHeight - box.clientHeight;
      if (top <= 0 || top >= whole || top >= end - 1) return;
      box.scrollTo({ top: top < whole / 2 ? 0 : whole, behavior: glideOf(box) });
    },
  };
}

function CompactTitle({
  title,
  ref,
}: {
  title: Pick<AgentPullRequest, "title" | "number"> | undefined;
  ref: React.Ref<HTMLDivElement>;
}): React.JSX.Element {
  const number = title === undefined ? "" : pullRequestNumberLabel(title);
  return (
    <div ref={ref} className="pull-request-compact px-column-inset" aria-hidden="true">
      <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.DIALOG}>
        {title === undefined ? null : (
          <OneLine words={`${title.title} ${number}`} hint={(line) => line}>
            {title.title} <span className="pull-request-number">{number}</span>
          </OneLine>
        )}
      </Text>
    </div>
  );
}

function PullRequestTabBody({
  agentId,
  number,
  source,
  shown,
  repository,
  tree,
  view,
  onView,
  onActions,
}: Omit<AgentPullRequestTabProps, "control"> & { source: PullRequestSource }): React.JSX.Element {
  const id = useId();
  const tabsFold =
    useContext(ShellRoomContext) === SHELL_ROOM.NARROW
      ? CHOICE_BAR_FOLD.OWN
      : CHOICE_BAR_FOLD.TOGETHER;
  const ids = (each: PullRequestView) => ({
    tab: `${id}-${each}-tab`,
    panel: `${id}-${each}-panel`,
  });
  const asked = shown ? pullRequestAsked(agentId, number) : undefined;
  const pullRequestRead = usePartRead(
    useQuery(pullRequestQuery(asked)),
    PULL_REQUEST_PART.PULL_REQUEST,
    asked,
  );
  const conversationRead = usePartRead(
    useQuery(pullRequestConversationQuery(asked)),
    PULL_REQUEST_PART.CONVERSATION,
    asked,
  );
  const checksRead = usePartRead(
    useQuery(pullRequestChecksQuery(asked)),
    PULL_REQUEST_PART.CHECKS,
    asked,
  );
  const publishedRead = usePartRead(
    useQuery(pullRequestPublishedQuery(asked)),
    PULL_REQUEST_PART.PUBLISHED,
    asked,
  );
  const ask = {
    pullRequest: pullRequestRead.ask,
    checks: checksRead.ask,
    conversation: conversationRead.ask,
  };
  const refresh = () => {
    const header = Promise.all([ask.pullRequest(), ask.conversation(), ask.checks()]);
    void publishedRead.ask();
    return header;
  };
  const parts: OverviewParts = {
    pullRequest: partOf(pullRequestRead),
    checks: partOf(checksRead),
    conversation: partOf(conversationRead),
    ask,
  };
  const reading = pullRequestRead.out || checksRead.out || conversationRead.out;
  const publishedPart = publishedRead.answer;
  const published =
    number !== undefined && publishedPart !== undefined && "pullRequest" in publishedPart
      ? (publishedPart.pullRequest ?? source.published)
      : source.published;
  const held = headerPullRequestOf(landed(parts.pullRequest), landed(parts.checks), published);
  const none = [parts.pullRequest, parts.checks, parts.conversation].some(
    (part) => part.kind === PART.NONE,
  );
  const refreshAllNow = useRef<() => void>(refresh);
  const url = none ? undefined : held?.url;
  const standing = usePlaceStanding(
    source.place,
    shown && parts.pullRequest.kind === PART.PENDING ? url : undefined,
  );
  const copy = useCopyToast();
  const copyNow = useRef(copy);
  copyNow.current = copy;
  const handed = useMemo(
    () =>
      url === undefined
        ? undefined
        : [
            pullRequestActions(
              url,
              reading,
              (words, label) => copyNow.current(words, label),
              () => refreshAllNow.current(),
            ),
          ],
    [url, reading],
  );
  const phone = usePhoneRoom();
  const openLink = useOpenLink();
  const viewActions = useViewActions();
  const checksLanded = landed(parts.checks);
  useHandedTabActions(
    onActions,
    handed === undefined
      ? undefined
      : [
          ...handed,
          phone ? previewActions(checksLanded, openLink) : [],
          ...(phone && viewActions.held?.view === view ? viewActions.held.actions : []),
        ].filter((group) => group.length > 0),
  );
  const changes = useChangesReads(
    agentId,
    source,
    shown && !none && (view === PULL_REQUEST_VIEW.FILES || view === PULL_REQUEST_VIEW.CHAPTERS),
  );
  refreshAllNow.current = () => {
    refresh();
    if (askedYet(changes)) changes.ask();
  };
  const [chaptersSeen, setChaptersSeen] = useState(false);
  if (!chaptersSeen && view === PULL_REQUEST_VIEW.CHAPTERS) setChaptersSeen(true);
  const overview = landed(parts.pullRequest);
  const head = overview?.merging?.headSha;
  const headSeen = useRef(head);
  const changesNow = useRef(changes);
  changesNow.current = changes;
  useEffect(() => {
    const was = headSeen.current;
    headSeen.current = head;
    if (was === undefined || head === undefined || was === head) return;
    if (askedYet(changesNow.current)) changesNow.current.ask();
  }, [head]);
  const chapters = useChaptersRead(
    agentId,
    source,
    shown && overview !== undefined,
    overview === undefined
      ? undefined
      : { number: overview.number, head: overview.merging?.headSha },
    () => refreshAllNow.current(),
  );
  const title = overview ?? published;
  const reviewable = held !== undefined;
  const now = useMinute();
  const written = refresh;
  const writes = usePullRequestWrites(agentId, written);
  const review = usePullRequestWrites(agentId, written);
  const pendingReview = landed(parts.conversation)?.pendingReview;
  const picture = usePictureDrawer(agentId);
  const comment = usePullRequestComment(agentId, written);
  const options = useReviewOptions(agentId);
  const picks = usePullRequestPicks(overview, writes);
  const conversation = landed(parts.conversation);
  const threadList = useMemo(() => reviewThreadsOf(conversation), [conversation]);
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
  const fold = useHeaderFold(phone);
  const listRoom = phone && fold.shape.lead ? fold.shape.room : 0;
  const page = (
    <ThreadWritesProvider value={{ agentId, onWritten: written }}>
      <ThreadJumpContext.Provider value={threadJumps.jumps}>
        <AnchorsContext.Provider value={anchors.open}>
          <Fill
            ref={fold.root}
            className="file-view pull-request-tab ph-no-capture"
            data-header-fold={phone ? "" : undefined}
            data-fold-lead={phone && fold.shape.lead ? "" : undefined}
            onScrollCapture={fold.onScrollCapture}
            onScrollEndCapture={fold.onScrollEndCapture}
          >
            <PullRequestWriteNote writes={writes} />
            {none ? (
              <EmptyState icon={<GLYPH.PULL_REQUEST />}>
                {PULL_REQUEST_WORDS.NO_PULL_REQUEST}
              </EmptyState>
            ) : (
              <>
                <header
                  ref={fold.header}
                  className="pull-request-header relative z-1 flex-none px-column-inset py-row-inset"
                >
                  <div className="pull-request-title-row">
                    <HeaderTitle title={title} writes={writes} />
                    {held === undefined ? null : (
                      <div className="pull-request-state">
                        <PullRequestStateMenu
                          pullRequest={held}
                          queued={headerQueuedOf(overview, published, held.number)}
                          shown={shown}
                          writes={writes}
                        />
                      </div>
                    )}
                    <div className="pull-request-title-actions">
                      {phone ? null : (
                        <PreviewControl checks={landed(parts.checks)} shown={shown} />
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
                    standing={standing}
                    now={now}
                    writes={writes}
                    editing={{ options, picks, refreshing: pullRequestRead.out }}
                    lines={linesOf(published, changes)}
                  />
                  {phone ? <CompactTitle ref={fold.compact} title={title} /> : null}
                </header>
                <PaneBar
                  middle={
                    <ChoiceBar<PullRequestView>
                      label="Pull request"
                      items={tabsOf(parts, published, held, changes, chapters)}
                      value={view}
                      onChange={onView}
                      look={CHOICE_BAR_LOOK.FILL}
                      fold={tabsFold}
                      panels={ids}
                    />
                  }
                  actions={
                    reviewable ? (
                      <PullRequestReview
                        writes={review}
                        pending={pendingReview}
                        pendingList={
                          drafts === undefined || drafts.length === 0 ? null : (
                            <PendingList drafts={drafts} now={now} picture={picture} />
                          )
                        }
                      />
                    ) : null
                  }
                />
                <Fill
                  className={VIEW_CLASS}
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
                    shown={view === PULL_REQUEST_VIEW.CONVERSATION}
                  />
                </Fill>
                <Fill
                  className={VIEW_CLASS}
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
                  className={VIEW_CLASS}
                  role="tabpanel"
                  id={ids(PULL_REQUEST_VIEW.CHAPTERS).panel}
                  aria-labelledby={ids(PULL_REQUEST_VIEW.CHAPTERS).tab}
                  hidden={view !== PULL_REQUEST_VIEW.CHAPTERS}
                >
                  {chaptersSeen ? (
                    <Suspense
                      fallback={<SpinnerRegion delay label={PULL_REQUEST_WORDS.READING_CHAPTERS} />}
                    >
                      <HandTabActionsContext.Provider
                        value={viewActions.handFor(PULL_REQUEST_VIEW.CHAPTERS)}
                      >
                        <CHAPTERS_TAB.Route
                          agentId={agentId}
                          source={source}
                          shown={shown && view === PULL_REQUEST_VIEW.CHAPTERS}
                          repository={repository}
                          tree={tree}
                          chapters={chapters}
                          changes={changes}
                          threads={changesThreads}
                          lineComments={{ pending: pendingReview, onWritten: written }}
                        />
                      </HandTabActionsContext.Provider>
                    </Suspense>
                  ) : null}
                </Fill>
              </>
            )}
            <Fill
              className={VIEW_CLASS}
              role="tabpanel"
              id={ids(PULL_REQUEST_VIEW.FILES).panel}
              aria-labelledby={ids(PULL_REQUEST_VIEW.FILES).tab}
              hidden={none || view !== PULL_REQUEST_VIEW.FILES}
            >
              <DiffListTopRoomContext.Provider value={listRoom}>
                <PendingSurfaceProvider value={shown && !none && view === PULL_REQUEST_VIEW.FILES}>
                  <HandTabActionsContext.Provider
                    value={viewActions.handFor(PULL_REQUEST_VIEW.FILES)}
                  >
                    <AgentChangesTab
                      agentId={agentId}
                      source={source}
                      shown={shown && !none && view === PULL_REQUEST_VIEW.FILES}
                      repository={repository}
                      tree={tree}
                      threads={changesThreads}
                      lineComments={{ pending: pendingReview, onWritten: written }}
                      reads={changes}
                      reveal={threadJumps.filesReveal}
                    />
                  </HandTabActionsContext.Provider>
                </PendingSurfaceProvider>
              </DiffListTopRoomContext.Provider>
            </Fill>
          </Fill>
        </AnchorsContext.Provider>
      </ThreadJumpContext.Provider>
    </ThreadWritesProvider>
  );
  return <PendingCommentsProvider value={pendingComments}>{page}</PendingCommentsProvider>;
}
