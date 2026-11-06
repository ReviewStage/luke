import {
  type AgentChangesPeople,
  type GitHubPerson,
  REVIEW_STATE,
  type ReviewState,
} from "@repo/features/agent-wire";
import { type Actor, githubActor } from "@repo/ui/actor-model";
import {
  CheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  FileDiffIcon,
  MessageSquareIcon,
  MinusIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useCallback } from "react";
import { ActorRef, ActorStack, type StackFace } from "../actor-ref.js";
import { useMemberDirectory } from "../member-directory.js";

export const REVIEW_WORDS = {
  [REVIEW_STATE.APPROVED]: "Approved",
  [REVIEW_STATE.CHANGES_REQUESTED]: "Changes requested",
  [REVIEW_STATE.DISMISSED]: "Dismissed",
  [REVIEW_STATE.COMMENTED]: "Commented",
  [REVIEW_STATE.REQUESTED]: "Review requested",
} as const satisfies Record<ReviewState, string>;

const REVIEW_GLYPHS = {
  [REVIEW_STATE.APPROVED]: <CheckIcon />,
  [REVIEW_STATE.CHANGES_REQUESTED]: <FileDiffIcon />,
  [REVIEW_STATE.DISMISSED]: <CircleSlashIcon />,
  [REVIEW_STATE.COMMENTED]: <MessageSquareIcon />,
  [REVIEW_STATE.REQUESTED]: <CircleDashedIcon />,
} as const satisfies Record<ReviewState, ReactNode>;

const FACE_GLYPHS = {
  [REVIEW_STATE.APPROVED]: <CheckIcon />,
  [REVIEW_STATE.CHANGES_REQUESTED]: <XIcon />,
  [REVIEW_STATE.DISMISSED]: <MinusIcon />,
  [REVIEW_STATE.COMMENTED]: <MessageSquareIcon />,
  [REVIEW_STATE.REQUESTED]: null,
} as const satisfies Record<ReviewState, ReactNode>;

export function useNamer(): (person: GitHubPerson) => Actor {
  const { members, readerId, former } = useMemberDirectory();
  return useCallback(
    (person: GitHubPerson) => githubActor(person, { members, readerId, former }),
    [members, readerId, former],
  );
}

const REVIEW_TONE = {
  [REVIEW_STATE.APPROVED]: { ink: "text-complete", disc: "bg-complete" },
  [REVIEW_STATE.CHANGES_REQUESTED]: { ink: "text-destructive", disc: "bg-destructive" },
  [REVIEW_STATE.REQUESTED]: { ink: "text-attention", disc: "bg-attention" },
  [REVIEW_STATE.COMMENTED]: { ink: "text-muted-foreground", disc: "bg-muted-foreground" },
  [REVIEW_STATE.DISMISSED]: { ink: "text-muted-foreground", disc: "bg-muted-foreground" },
} as const satisfies Record<ReviewState, { ink: string; disc: string }>;

export function ReviewBadge({ state }: { state: ReviewState }): React.JSX.Element {
  return (
    <span
      className={`review-state inline-grid place-items-center [&>svg]:size-ui-12 ${REVIEW_TONE[state].ink}`}
      data-review-state={state}
    >
      {REVIEW_GLYPHS[state]}
    </span>
  );
}

function FaceBadge({ state }: { state: ReviewState }): React.JSX.Element {
  return (
    <span
      className={`review-state review-face-badge inline-grid size-review-badge place-items-center rounded-ui-full text-ground data-[review-state=requested]:size-status-dot ${REVIEW_TONE[state].disc}`}
      data-review-state={state}
    >
      {FACE_GLYPHS[state]}
    </span>
  );
}

function PersonRef({ person }: { person: GitHubPerson }): React.JSX.Element {
  return <ActorRef actor={useNamer()(person)} />;
}

export function ReviewStanding({ state }: { state: ReviewState }): React.JSX.Element {
  return (
    <span
      className="changes-comment-state inline-flex items-center gap-tight-gap text-muted-foreground"
      data-review-state={state}
    >
      <ReviewBadge state={state} />
      {REVIEW_WORDS[state]}
    </span>
  );
}

function ReviewerPile({
  reviewers,
  drawn,
}: {
  reviewers: NonNullable<AgentChangesPeople["reviewers"]>;
  drawn: number;
}): React.JSX.Element {
  const name = useNamer();
  const faces: StackFace[] = reviewers.map(({ state }) => ({
    says: REVIEW_WORDS[state],
    badge: <FaceBadge state={state} />,
  }));
  return (
    <ActorStack
      actors={reviewers.map(({ by }) => name(by))}
      faces={faces}
      drawn={drawn}
      label="Reviewers"
    />
  );
}

export function OpenedLine({
  person,
  opened,
  merged,
}: {
  person: GitHubPerson | undefined;
  opened: ReactNode;
  merged: ReactNode | undefined;
}): React.JSX.Element {
  const verb = person === undefined ? "Opened" : "opened";
  return (
    <span className="pull-request-opened inline-flex min-w-0 items-center gap-tight-gap whitespace-nowrap">
      {person === undefined ? null : <PersonRef person={person} />}
      <span className="pull-request-quiet text-muted-foreground">
        {merged === undefined ? (
          <>
            {`${verb} `}
            {opened}
          </>
        ) : (
          <>
            {`${verb} · merged `}
            {merged}
          </>
        )}
      </span>
    </span>
  );
}

const HEADER_FACES = 3;

export function HeaderReviewers({
  reviewers,
}: {
  reviewers: NonNullable<AgentChangesPeople["reviewers"]>;
}): React.JSX.Element {
  return <ReviewerPile reviewers={reviewers} drawn={HEADER_FACES} />;
}
