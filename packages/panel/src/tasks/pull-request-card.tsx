import {
  type AgentChangesPeople,
  type AgentPullRequest,
  CHECK_SUMMARY,
  type CheckSummary,
  type GitHubPerson,
  PULL_REQUEST_STATE,
  type PullRequestState,
  type ReviewState,
} from "@luke/features/agent-wire";
import { pullRequestAddressOf } from "@luke/features/link-grammar";
import type { CatalogModel } from "@luke/features/models-wire";
import { countWords, TERM } from "@luke/features/words";
import {
  ALIGN,
  Badge,
  CARD_WIDTH,
  GAP,
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  HoverCardHead,
  HoverCardList,
  HoverCardNote,
  HoverCardRow,
  HoverCardRule,
  Inline,
  LAYOUT_ELEMENT,
  TIME_LOOK,
  Time,
  useMinute,
} from "@luke/ui";
import { type ReactNode, useEffect } from "react";
import { ACTOR_SIZE, ActorMark, ActorRef, PROVENANCE_VERB, ProvenanceRow } from "../actor-ref.js";
import { PULL_REQUEST_TAB } from "../desktop/pages-on-demand.js";
import { pullRequestNumberLabel, pullRequestStateLabel } from "./agent-model.js";
import { LinesChanged } from "./agent-published.js";
import { AgentActorRef, type AgentSubject } from "./agent-ref.js";
import { PullRequestMark } from "./pull-request-mark.js";
import { REVIEW_WORDS, useNamer } from "./pull-request-people.js";
import type { HeldPeople } from "./use-agents.js";
import {
  PULL_REQUEST_MOMENT,
  type PullRequestMoment,
  type StandingPullRequest,
} from "./use-link-standing.js";

/**
 * pull-request-card.tsx -- the one card a pull request hangs wherever the window names one: its mark and title, its key and where it stands, its size and checks, its branches and labels, who opened it, the agent whose it is, and its reviewers.
 *
 * A pull request is named in three kinds of place: the chip beside its
 * agent in the plan's list of agents, which knows what the task's row
 * says of it; its Pull request tab, a pin of that tab, and the chip of a
 * pull request one of the plan's agents opened, which know the agent and,
 * once the tab has read them, who the pull request names; and a link to
 * its page in any words, which knows what the workspace's GitHub App
 * answered for it (`use-link-standing.ts`). Each hangs this one card and
 * passes what it knows, and the card draws only what it is given, so a
 * card read from an older service, which answers little, still draws its
 * head. The head is the mark for where it stands, the title, and under it
 * one key everywhere, `acme/relay#42 · Merged`, with the age of its latest
 * moment, opened, merged, or closed, at the corner where the service said
 * one. One note says its size and checks, `+120 −14 in 3 files · Checks
 * passing · 7 comments · 1 commit`, each piece where known; its branches
 * stand as inline code, `main ← fix`, and every label as a badge wearing
 * a dot of its own colour, since GitHub lets a label be any colour, a
 * dark one among them, which the card's words could not be read in. Who
 * opened it is the provenance row every card draws, their face as its glyph,
 * "Opened by octo-dev · 3d ago", and where one of the window's agents
 * opened it a second row, "By Invite flow", names the agent by its tile,
 * which hangs the agent's card and opens its tab. Its reviewers, where
 * known, are listed under a rule, each row a face and a name with where
 * they stand at its end, every one of them, scrolling past a few rows.
 */

/** What a pull request's card says of its checks; nothing where it has none, or where the place knows nothing of them. */
const CHECKS_WORDS = {
  [CHECK_SUMMARY.PASSING]: "Checks passing",
  [CHECK_SUMMARY.PENDING]: "Checks running",
  [CHECK_SUMMARY.FAILING]: "Checks failing",
  [CHECK_SUMMARY.NONE]: undefined,
} as const satisfies Record<CheckSummary, string | undefined>;

/** The moment a pull request's state names: merged once merged, closed once closed, and opened while open or a draft. */
const MOMENT_OF_STATE = {
  [PULL_REQUEST_STATE.OPEN]: PULL_REQUEST_MOMENT.OPENED,
  [PULL_REQUEST_STATE.DRAFT]: PULL_REQUEST_MOMENT.OPENED,
  [PULL_REQUEST_STATE.MERGED]: PULL_REQUEST_MOMENT.MERGED,
  [PULL_REQUEST_STATE.CLOSED]: PULL_REQUEST_MOMENT.CLOSED,
} as const satisfies Record<PullRequestState, PullRequestMoment>;

/** What parts the pieces of a card's line. */
const SEPARATOR = " · ";

/** What the reviewers' list is named for a reader moving between lists. */
const REVIEWERS_LABEL = "Reviewers";

/** What the labels' list is named for a reader moving between lists. */
const LABELS_LABEL = "Labels";

/** A pull request as every place that hangs its card holds one: its number and title, where it stands, its page, and its checks where the place reads them. */
export interface CardedPullRequest {
  readonly number: number;
  readonly title: string;
  readonly state: PullRequestState;
  /** True where it is open and GitHub's merge queue holds it. */
  readonly queued?: true;
  /** Its page on GitHub, whose address names its repository; none from a service before it sent one. */
  readonly url?: string | undefined;
  /** How its checks went; none where the place knows nothing of them. */
  readonly checks?: CheckSummary | undefined;
}

/** A reviewer of the pull request, and where they stand on it. */
export interface PullRequestReviewer {
  readonly by: GitHubPerson;
  readonly state: ReviewState;
}

/** The agent whose pull request it is, as the place names it, and how its tab opens. */
export interface PullRequestAgent {
  readonly subject: AgentSubject;
  /** The catalog as last read, which names the agent's model on its card. */
  readonly models: readonly CatalogModel[] | undefined;
  readonly onOpen: () => void;
}

/** Who a pull request names, as its tab last read them for that very pull request; none where the tab read them for another, or has not yet. */
export function peopleOf(
  held: HeldPeople | undefined,
  pullRequest: Pick<AgentPullRequest, "url">,
): AgentChangesPeople | undefined {
  return held?.url === pullRequest.url ? held.people : undefined;
}

/**
 * The age the head's corner says: the pull request's latest moment, where
 * that moment is the one its state names. Note that a service answering no
 * time for a merge or a close falls back to when it was opened, and an
 * opening age beside "Merged" or "Closed" would read as the age of the
 * merge, so the corner says nothing then, and only the row naming who
 * opened it says the opening age.
 */
function cornerAge(
  pullRequest: CardedPullRequest,
  when: StandingPullRequest["when"],
): React.JSX.Element | undefined {
  if (when === undefined || when.moment !== MOMENT_OF_STATE[pullRequest.state]) return undefined;
  return <Time at={when.at} look={TIME_LOOK.SINCE} hint={false} />;
}

/** A pull request's key as its card's head says it: `owner/name#42` where its page names its repository, else `#42`. */
function pullRequestKey(pullRequest: CardedPullRequest): string {
  const repository =
    pullRequest.url === undefined ? undefined : pullRequestAddressOf(pullRequest.url)?.repository;
  return `${repository ?? ""}${pullRequestNumberLabel(pullRequest)}`;
}

/** The one note of its size and checks: the lines it adds and removes across the files it changes, how its checks went, and how many comments and commits it holds, each where known; nothing where none is. */
function SizeNote({
  lines,
  files,
  checks,
  comments,
  commits,
}: {
  lines: StandingPullRequest["lines"];
  files: number | undefined;
  checks: CheckSummary | undefined;
  comments: number | undefined;
  commits: number | undefined;
}): React.JSX.Element | null {
  const filesWords = files === undefined ? undefined : countWords(files, TERM.FILE);
  const size =
    lines === undefined ? (
      filesWords
    ) : (
      <>
        <LinesChanged additions={lines.additions} deletions={lines.deletions} />
        {filesWords === undefined ? null : ` in ${filesWords}`}
      </>
    );
  const pieces: ReactNode[] = [
    size,
    checks === undefined ? undefined : CHECKS_WORDS[checks],
    comments === undefined ? undefined : countWords(comments, TERM.COMMENT),
    commits === undefined ? undefined : countWords(commits, TERM.COMMIT),
  ].filter((piece) => piece !== undefined);
  if (pieces.length === 0) return null;
  return (
    <HoverCardNote>
      {pieces.map((piece, index) => (
        // Note that the pieces stand in one order, so each is keyed by its place.
        <span key={index}>
          {index === 0 ? null : SEPARATOR}
          {piece}
        </span>
      ))}
    </HoverCardNote>
  );
}

/**
 * Who opened a pull request or a GitHub issue, as every card's provenance
 * row says it (`ProvenanceRow`): their face as its glyph, their name as the
 * window names a GitHub account (a member's own where it is linked to one,
 * else their avatar), which hangs their card, and how long ago it was
 * opened where the service said so, "Opened by octo-dev · 3d ago". Note
 * that the time is the opening alone: once it merged or closed, the age the
 * service answers is the merge's or the close's, which the head's corner
 * says beside the state, so the row names the opener and no time.
 */
export function OpenedByRow({
  opener,
  when,
}: {
  opener: GitHubPerson;
  when?: StandingPullRequest["when"];
}): React.JSX.Element {
  const actor = useNamer()(opener);
  const now = useMinute();
  return (
    <ProvenanceRow
      verb={PROVENANCE_VERB.OPENED}
      actor={actor}
      at={when?.moment === PULL_REQUEST_MOMENT.OPENED ? when.at : undefined}
      now={now}
    />
  );
}

/** The agent whose pull request it is, as a quieter row in the provenance row's shape: its tile as the glyph, "By" and its name, which hang the agent's card and open its tab. Note that it is no `ProvenanceRow`, since no verb of that row's reads as a bare "By". */
function ByAgentRow({ agent }: { agent: PullRequestAgent }): React.JSX.Element {
  return (
    <HoverCardRow
      look={HOVER_CARD_ROW_LOOK.DETAIL}
      glyph={<ActorMark actor={agent.subject.tile} size={ACTOR_SIZE.MARK} />}
      label={
        <>
          {"By "}
          <AgentActorRef
            subject={agent.subject}
            models={agent.models}
            onOpen={agent.onOpen}
            nameOnly
          />
        </>
      }
    />
  );
}

/** One reviewer's row: their face, their name, which hangs their card, and where they stand at the row's end. */
function ReviewerRow({ reviewer }: { reviewer: PullRequestReviewer }): React.JSX.Element {
  const actor = useNamer()(reviewer.by);
  return (
    <li>
      <HoverCardRow
        glyph={<ActorMark actor={actor} size={ACTOR_SIZE.ROW} />}
        label={<ActorRef actor={actor} nameOnly />}
        end={REVIEW_WORDS[reviewer.state]}
      />
    </li>
  );
}

/**
 * The one card a pull request hangs: its head, then what the place knows
 * of it, each part only where it is known.
 */
export function PullRequestCard({
  pullRequest,
  lines,
  files,
  when,
  branches,
  labels,
  comments,
  commits,
  opener,
  agent,
  reviewers,
}: {
  pullRequest: CardedPullRequest;
  /** The lines it adds and removes. */
  lines?: StandingPullRequest["lines"];
  /** How many files it changes. */
  files?: number | undefined;
  /** When it was last opened, merged, or closed, as its state says. */
  when?: StandingPullRequest["when"];
  branches?: StandingPullRequest["branches"];
  labels?: StandingPullRequest["labels"] | undefined;
  comments?: number | undefined;
  commits?: number | undefined;
  /** Who opened it, where GitHub named them. */
  opener?: GitHubPerson | undefined;
  /** The agent whose pull request it is, where one of the window's opened it. */
  agent?: PullRequestAgent | undefined;
  /** Its reviewers and where each stands, where the place has read them. */
  reviewers?: readonly PullRequestReviewer[] | undefined;
}): React.JSX.Element {
  // An agent's pull request opens in its Pull request tab, a chunk of its own (`pages-on-demand.ts`), and the card hanging is the pointer on what opens it, so the chunk is read now rather than at the press.
  const owned = agent !== undefined;
  useEffect(() => {
    if (owned) PULL_REQUEST_TAB.prefetch();
  }, [owned]);
  const marked = { ...pullRequest, checks: pullRequest.checks ?? CHECK_SUMMARY.NONE };
  return (
    <HoverCard
      data-pull-request-card=""
      width={reviewers !== undefined && reviewers.length > 0 ? CARD_WIDTH.WIDE : CARD_WIDTH.NARROW}
    >
      <HoverCardHead
        glyph={<PullRequestMark pullRequest={marked} />}
        name={pullRequest.title}
        sub={`${pullRequestKey(pullRequest)}${SEPARATOR}${pullRequestStateLabel(pullRequest)}`}
        corner={cornerAge(pullRequest, when)}
      />
      <SizeNote
        lines={lines}
        files={files}
        checks={pullRequest.checks}
        comments={comments}
        commits={commits}
      />
      {branches === undefined ? null : (
        <HoverCardNote oneLine>
          <code className="card-code">{branches.base}</code>
          {" ← "}
          <code className="card-code">{branches.head}</code>
        </HoverCardNote>
      )}
      {labels === undefined || labels.length === 0 ? null : (
        <Inline
          as={LAYOUT_ELEMENT.UL}
          gap={GAP.TIGHT}
          align={ALIGN.STRETCH}
          className="card-labels"
          aria-label={LABELS_LABEL}
        >
          {labels.map((label) => (
            <li key={label.name}>
              <Badge swatch={label.color}>{label.name}</Badge>
            </li>
          ))}
        </Inline>
      )}
      {opener === undefined ? null : <OpenedByRow opener={opener} when={when} />}
      {agent === undefined ? null : <ByAgentRow agent={agent} />}
      {reviewers === undefined || reviewers.length === 0 ? null : (
        <>
          <HoverCardRule />
          <HoverCardList label={REVIEWERS_LABEL}>
            {reviewers.map((reviewer) => (
              <ReviewerRow key={reviewer.by.login} reviewer={reviewer} />
            ))}
          </HoverCardList>
        </>
      )}
    </HoverCard>
  );
}
