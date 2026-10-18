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
  UsersIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { ActorLine, ActorRef, ActorStack, type StackFace } from "../actor-ref";
import { useMemberDirectory } from "../member-directory";

/**
 * pull-request-people.tsx -- who an agent's pull request names, drawn as every actor is: who opened it, and its reviewers as a facepile wearing where each stands.
 *
 * GitHub names everyone by an account of its own; the window names each as
 * the actor they are to the reader (`githubActor`). A GitHub account linked
 * to a member is that member, by their face and card; anyone else is
 * themself on GitHub, a person's circle or an App's bot's square, by their
 * avatar and a card saying so, Luke's own App's bot among them. A
 * reviewer's face wears where they stand at its corner, in GitHub's own
 * colours: approved green, changes asked for red, a review asked for and
 * not given amber, and a comment or a dismissed review quiet. Every name and word here is
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

/** Names the people as the members around the caller say. */
function useNamer(): (person: GitHubPerson) => Actor {
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
    badge: <ReviewBadge state={state} />,
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

/** How many reviewers' faces a pull request's header draws before it counts the rest, as stage-cli's header does. */
const HEADER_FACES = 3;

/** The reviewers compactly, as a pull request's header names them: a glyph for what they are, then their first faces and a count of the rest. */
export function HeaderReviewers({
  reviewers,
}: {
  reviewers: NonNullable<CodingAgentChangesPeople["reviewers"]>;
}): React.JSX.Element {
  return (
    <ActorLine>
      <UsersIcon className="pull-request-reviewers-glyph" aria-hidden="true" />
      <ReviewerPile reviewers={reviewers} drawn={HEADER_FACES} />
    </ActorLine>
  );
}
