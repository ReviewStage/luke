import {
  type CodingAgentChangesPeople,
  type GitHubPerson,
  REVIEW_STATE,
  type ReviewState,
} from "@luke/features/coding-agent-wire";
import { type Actor, githubActor } from "@luke/ui/actor-model";
import {
  CheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  FileDiffIcon,
  MessageSquareIcon,
  MinusIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { ActorLine, ActorRef, ActorStack, type StackFace } from "../actor-ref.js";
import { useMemberDirectory } from "../member-directory.js";

/**
 * pull-request-people.tsx -- who an agent's pull request names, drawn as every actor is: who opened it, and its reviewers as a facepile wearing where each stands.
 *
 * GitHub names everyone by an account of its own; the window names each as
 * the actor they are to the reader (`githubActor`). A GitHub account linked
 * to a member is that member, by their face and card; anyone else is
 * themself on GitHub, a person's circle or an App's bot's square, by their
 * avatar and a card saying so, Luke's own App's bot among them. A
 * reviewer's face wears where they stand at its corner, a disc in GitHub's
 * own colours with its glyph cut from it: approved a green check, changes
 * asked for a red cross, a review asked for and not given an amber dot, and
 * a comment or a dismissed review quiet. Every name and word here is
 * the repository's, so the places drawing them are left out of the screen
 * recording, as the Changes tab is.
 */

/** Where a reviewer stands, in the words their face's pill and a comment's line say it. */
const REVIEW_WORDS = {
  [REVIEW_STATE.APPROVED]: "Approved",
  [REVIEW_STATE.CHANGES_REQUESTED]: "Changes requested",
  [REVIEW_STATE.DISMISSED]: "Dismissed",
  [REVIEW_STATE.COMMENTED]: "Commented",
  [REVIEW_STATE.REQUESTED]: "Review requested",
} as const satisfies Record<ReviewState, string>;

/** The glyph a reviewer's standing wears, as GitHub draws each. */
const REVIEW_GLYPHS = {
  [REVIEW_STATE.APPROVED]: <CheckIcon />,
  [REVIEW_STATE.CHANGES_REQUESTED]: <FileDiffIcon />,
  [REVIEW_STATE.DISMISSED]: <CircleSlashIcon />,
  [REVIEW_STATE.COMMENTED]: <MessageSquareIcon />,
  [REVIEW_STATE.REQUESTED]: <CircleDashedIcon />,
} as const satisfies Record<ReviewState, ReactNode>;

/**
 * The glyph a face's standing wears at its corner, cut from a disc of its
 * colour: a check or a cross a face's corner holds legibly, where the
 * standing's own glyph beside its words would blur; a review asked for and
 * not given wears the disc alone, as GitHub's waiting dot.
 */
const FACE_GLYPHS = {
  [REVIEW_STATE.APPROVED]: <CheckIcon />,
  [REVIEW_STATE.CHANGES_REQUESTED]: <XIcon />,
  [REVIEW_STATE.DISMISSED]: <MinusIcon />,
  [REVIEW_STATE.COMMENTED]: <MessageSquareIcon />,
  [REVIEW_STATE.REQUESTED]: null,
} as const satisfies Record<ReviewState, ReactNode>;

/** Names the people as the members around the caller say. */
export function useNamer(): (person: GitHubPerson) => Actor {
  const { members, readerId, former } = useMemberDirectory();
  return (person) => githubActor(person, { members, readerId, former });
}

/** A reviewer's standing at their face's corner, in its colour. */
function ReviewBadge({ state }: { state: ReviewState }): React.JSX.Element {
  return (
    <span className="review-state" data-review-state={state}>
      {REVIEW_GLYPHS[state]}
    </span>
  );
}

/** A reviewer's standing at their face's corner: a disc of its colour, its glyph cut from it. */
function FaceBadge({ state }: { state: ReviewState }): React.JSX.Element {
  return (
    <span className="review-state review-face-badge" data-review-state={state}>
      {FACE_GLYPHS[state]}
    </span>
  );
}

/** Someone the pull request names, by their face and name, hanging their card, as every actor is drawn. */
export function PersonRef({ person }: { person: GitHubPerson }): React.JSX.Element {
  return <ActorRef actor={useNamer()(person)} />;
}

/** Where a review left its reviewer, its glyph in its colour beside the words for it. */
export function ReviewStanding({ state }: { state: ReviewState }): React.JSX.Element {
  return (
    <span className="changes-comment-state" data-review-state={state}>
      <ReviewBadge state={state} />
      {REVIEW_WORDS[state]}
    </span>
  );
}

/** The reviewers as a facepile, each face wearing where they stand and hanging their card. */
function ReviewerPile({
  reviewers,
  drawn = 5,
}: {
  reviewers: NonNullable<CodingAgentChangesPeople["reviewers"]>;
  /** How many faces stand before the rest are counted. */
  drawn?: number;
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

/** Who opened the pull request, in a line: "Opened by [face] dana". */
export function OpenedBy({ person }: { person: GitHubPerson }): React.JSX.Element {
  return (
    <ActorLine>
      {"Opened by "}
      <PersonRef person={person} />
    </ActorLine>
  );
}

/** The reviewers in a line: "Reviewers [faces]". */
export function ReviewersLine({
  reviewers,
}: {
  reviewers: NonNullable<CodingAgentChangesPeople["reviewers"]>;
}): React.JSX.Element {
  return (
    <ActorLine>
      {"Reviewers "}
      <ReviewerPile reviewers={reviewers} />
    </ActorLine>
  );
}

/**
 * Who opened the pull request and when, in a pull request's header, as one
 * phrase: "[face] dana opened 3h ago", or, once it merged, "[face] dana
 * opened · merged 1h ago", the moment that matters once it has; without
 * anyone to name, the phrase alone.
 */
export function OpenedLine({
  person,
  opened,
  merged,
}: {
  person: GitHubPerson | undefined;
  /** When it was opened, as the header says a time. */
  opened: ReactNode;
  /** When it merged, where it has. */
  merged: ReactNode | undefined;
}): React.JSX.Element {
  const verb = person === undefined ? "Opened" : "opened";
  return (
    <span className="pull-request-opened">
      {person === undefined ? null : <PersonRef person={person} />}
      <span className="pull-request-quiet">
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

/** How many reviewers' faces a pull request's header draws before it counts the rest, as stage-cli's header does. */
const HEADER_FACES = 3;

/** The reviewers compactly, as a pull request's header names them: their first faces, each wearing where they stand, and a count of the rest. */
export function HeaderReviewers({
  reviewers,
}: {
  reviewers: NonNullable<CodingAgentChangesPeople["reviewers"]>;
}): React.JSX.Element {
  return <ReviewerPile reviewers={reviewers} drawn={HEADER_FACES} />;
}
