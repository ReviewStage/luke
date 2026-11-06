import {
  type AgentChangesPeople,
  type AgentPullRequest,
  CHECK_SUMMARY,
  type CheckSummary,
  type GitHubPerson,
  PULL_REQUEST_STATE,
  type PullRequestState,
  type ReviewState,
} from "@repo/features/agent-wire";
import { pullRequestAddressOf } from "@repo/features/link-grammar";
import type { CatalogModel } from "@repo/features/models-wire";
import { countWords, TERM } from "@repo/features/words";
import {
  ALIGN,
  Badge,
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
} from "@repo/ui";
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
  usePlaceStanding,
} from "./use-link-standing.js";

const CHECKS_WORDS = {
  [CHECK_SUMMARY.PASSING]: "Checks passing",
  [CHECK_SUMMARY.PENDING]: "Checks running",
  [CHECK_SUMMARY.FAILING]: "Checks failing",
  [CHECK_SUMMARY.NONE]: undefined,
} as const satisfies Record<CheckSummary, string | undefined>;

const MOMENT_OF_STATE = {
  [PULL_REQUEST_STATE.OPEN]: PULL_REQUEST_MOMENT.OPENED,
  [PULL_REQUEST_STATE.DRAFT]: PULL_REQUEST_MOMENT.OPENED,
  [PULL_REQUEST_STATE.MERGED]: PULL_REQUEST_MOMENT.MERGED,
  [PULL_REQUEST_STATE.CLOSED]: PULL_REQUEST_MOMENT.CLOSED,
} as const satisfies Record<PullRequestState, PullRequestMoment>;

const SEPARATOR = " · ";

const REVIEWERS_LABEL = "Reviewers";

const LABELS_LABEL = "Labels";

export interface CardedPullRequest {
  readonly number: number;
  readonly title: string;
  readonly state: PullRequestState;
  readonly queued?: true;
  readonly url?: string | undefined;
  readonly checks?: CheckSummary | undefined;
}

export interface PullRequestReviewer {
  readonly by: GitHubPerson;
  readonly state: ReviewState;
}

export interface PullRequestAgent {
  readonly subject: AgentSubject;
  readonly models: readonly CatalogModel[] | undefined;
  readonly onOpen: () => void;
}

export function peopleOf(
  held: HeldPeople | undefined,
  pullRequest: Pick<AgentPullRequest, "url">,
): AgentChangesPeople | undefined {
  return held?.url === pullRequest.url ? held.people : undefined;
}

function cornerAge(
  pullRequest: CardedPullRequest,
  when: StandingPullRequest["when"],
): React.JSX.Element | undefined {
  if (when === undefined || when.moment !== MOMENT_OF_STATE[pullRequest.state]) return undefined;
  return <Time at={when.at} look={TIME_LOOK.SINCE} hint={false} />;
}

function pullRequestKey(pullRequest: CardedPullRequest): string {
  const repository =
    pullRequest.url === undefined ? undefined : pullRequestAddressOf(pullRequest.url)?.repository;
  return `${repository ?? ""}${pullRequestNumberLabel(pullRequest)}`;
}

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
        <span key={index}>
          {index === 0 ? null : SEPARATOR}
          {piece}
        </span>
      ))}
    </HoverCardNote>
  );
}

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

export function PullRequestCard({
  pullRequest,
  place,
  agent,
  reviewers,
  ...given
}: {
  pullRequest: CardedPullRequest;
  place: { readonly taskId: string | null; readonly workspaceId?: string | undefined };
  lines?: StandingPullRequest["lines"];
  files?: number | undefined;
  when?: StandingPullRequest["when"];
  branches?: StandingPullRequest["branches"];
  labels?: StandingPullRequest["labels"] | undefined;
  comments?: number | undefined;
  commits?: number | undefined;
  opener?: GitHubPerson | undefined;
  agent?: PullRequestAgent | undefined;
  reviewers?: readonly PullRequestReviewer[] | undefined;
}): React.JSX.Element {
  const owned = agent !== undefined;
  useEffect(() => {
    if (owned) PULL_REQUEST_TAB.prefetch();
  }, [owned]);
  const standing = usePlaceStanding(place, pullRequest.url);
  const read = standing?.pullRequest;
  const lines = given.lines ?? read?.lines;
  const files = given.files ?? read?.files;
  const when = given.when ?? read?.when;
  const branches = given.branches ?? read?.branches;
  const labels = given.labels ?? read?.labels;
  const comments = given.comments ?? read?.comments;
  const commits = given.commits ?? read?.commits;
  const opener = given.opener ?? standing?.opener;
  const marked = { ...pullRequest, checks: pullRequest.checks ?? CHECK_SUMMARY.NONE };
  return (
    <HoverCard data-pull-request-card="">
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
