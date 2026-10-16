import type {
  CodingAgentAuthor,
  CodingAgentChangesPeople,
  GitHubPerson,
  ReviewState,
} from "@luke/features/coding-agent-wire";
import { CODING_AGENT_AUTHOR, REVIEW_STATE } from "@luke/features/coding-agent-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import { ACTOR_KIND, type Actor, githubActor } from "@luke/ui/actor-model";
import {
  CheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  FileDiffIcon,
  MessageSquareIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { ActorLine, ActorRef, ActorStack, type StackFace } from "../actor-ref";
import { useMemberDirectory } from "../member-directory";
import { AgentCard, type AgentSubject } from "./agent-ref";

/**
 * pull-request-people.tsx -- who an agent's pull request names, drawn as every actor is: who opened it, its reviewers as a facepile wearing where each stands, and who authored its commits.
 *
 * GitHub names everyone by an account of its own; the window names each as
 * the actor they are to the reader (`githubActor`). Luke's own App's bot is
 * the agent whose pull request it is, by its tile and its tab's card; a
 * GitHub account linked to a member is that member, by their face and
 * card; anyone else is themself on GitHub, a person's circle or an App's
 * bot's square, by their avatar and a card saying so. A reviewer's face
 * wears where they stand at its corner, in GitHub's own colours: approved
 * green, changes asked for red, a review asked for and not given amber,
 * and a comment or a dismissed review quiet. A pull request the agent
 * opened as the Luke GitHub App, where it writes as the developer who
 * started it whenever it can, says why it could not. Every name and word here is
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

/**
 * Why the agent opened its pull request as the App rather than as the
 * developer who started it, as the "Opened by" line ends where Luke's own
 * bot opened it: the reason the agent writes as the App, or, for an agent
 * that writes as its developer, their sign-in failing it on the way.
 */
const WRITTEN_AS_WORDS = {
  [CODING_AGENT_AUTHOR.DEVELOPER]:
    " as the GitHub App, since its starter's GitHub sign-in could not be used",
  [CODING_AGENT_AUTHOR.APP_UNLINKED]: " as the GitHub App, since its starter has no GitHub linked",
  [CODING_AGENT_AUTHOR.APP_NO_PUSH]: " as the GitHub App, since its starter can't push here",
  [CODING_AGENT_AUTHOR.APP_AUTOMATION]: " as the GitHub App, for an automation",
  [CODING_AGENT_AUTHOR.APP_UNREAD]: " as the GitHub App, since GitHub didn't answer",
} as const satisfies Record<CodingAgentAuthor, string>;

/** The glyph a reviewer's standing wears, as GitHub draws each. */
const REVIEW_GLYPHS = {
  [REVIEW_STATE.APPROVED]: <CheckIcon />,
  [REVIEW_STATE.CHANGES_REQUESTED]: <FileDiffIcon />,
  [REVIEW_STATE.DISMISSED]: <CircleSlashIcon />,
  [REVIEW_STATE.COMMENTED]: <MessageSquareIcon />,
  [REVIEW_STATE.REQUESTED]: <CircleDashedIcon />,
} as const satisfies Record<ReviewState, ReactNode>;

/** What the window knows of the agent whose pull request it is, which Luke's own bot is drawn as. */
export interface PullRequestAgent {
  readonly subject: AgentSubject | undefined;
  readonly models: readonly CatalogModel[] | undefined;
}

/** Someone the pull request names as the window draws them, and the card they hang: the agent's tab's for the agent, their own for the rest. */
interface Named {
  readonly actor: Actor;
  readonly card: ReactNode;
}

/** Names the people as the members around the caller and the agent say. */
function useNamer(agent: PullRequestAgent): (person: GitHubPerson) => Named {
  const { members, readerId, former } = useMemberDirectory();
  const { subject, models } = agent;
  return (person) => {
    const actor = githubActor(person, { members, readerId, former, agent: subject?.tile });
    const card =
      actor.kind === ACTOR_KIND.AGENT && subject !== undefined ? (
        <AgentCard subject={subject} models={models} />
      ) : undefined;
    return { actor, card };
  };
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
export function PersonRef({
  person,
  agent,
}: {
  person: GitHubPerson;
  agent: PullRequestAgent;
}): React.JSX.Element {
  const { actor, card } = useNamer(agent)(person);
  return <ActorRef actor={actor} card={card} />;
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
  agent,
}: {
  reviewers: NonNullable<CodingAgentChangesPeople["reviewers"]>;
  agent: PullRequestAgent;
}): React.JSX.Element {
  const name = useNamer(agent);
  const named = reviewers.map(({ by, state }) => ({ ...name(by), state }));
  const faces: StackFace[] = named.map(({ card, state }) => ({
    says: REVIEW_WORDS[state],
    badge: <ReviewBadge state={state} />,
    card,
  }));
  return (
    <ActorStack
      actors={named.map(({ actor }) => actor)}
      faces={faces}
      drawn={5}
      label="Reviewers"
    />
  );
}

/** Who authored the commits, as a facepile, each face hanging their card. */
function CommitAuthorPile({
  authors,
  agent,
}: {
  authors: readonly GitHubPerson[];
  agent: PullRequestAgent;
}): React.JSX.Element {
  const name = useNamer(agent);
  const named = authors.map(name);
  return (
    <ActorStack
      actors={named.map(({ actor }) => actor)}
      faces={named.map(({ card }) => ({ card }))}
      drawn={5}
      label="Commit authors"
    />
  );
}

/**
 * Who opened the pull request, in a line: "Opened by [face] Luke", and,
 * where Luke's own bot opened it, why the agent wrote as the App.
 */
export function OpenedBy({
  person,
  writtenAs,
  agent,
}: {
  person: GitHubPerson;
  writtenAs: CodingAgentAuthor | undefined;
  agent: PullRequestAgent;
}): React.JSX.Element {
  const { actor, card } = useNamer(agent)(person);
  return (
    <ActorLine>
      {"Opened by "}
      <ActorRef actor={actor} card={card} />
      {person.luke === true && writtenAs !== undefined ? WRITTEN_AS_WORDS[writtenAs] : null}
    </ActorLine>
  );
}

/** The reviewers in a line: "Reviewers [faces]". */
export function ReviewersLine({
  reviewers,
  agent,
}: {
  reviewers: NonNullable<CodingAgentChangesPeople["reviewers"]>;
  agent: PullRequestAgent;
}): React.JSX.Element {
  return (
    <ActorLine>
      {"Reviewers "}
      <ReviewerPile reviewers={reviewers} agent={agent} />
    </ActorLine>
  );
}

/**
 * The strip a Changes tab leads with, under its bar: who opened the pull
 * request, its reviewers, and who authored its commits, each only where
 * the pull request names any; nothing where a service before them names
 * none.
 */
export function PullRequestPeople({
  people,
  agent,
}: {
  people: CodingAgentChangesPeople;
  agent: PullRequestAgent;
}): React.JSX.Element | null {
  const { author, writtenAs, reviewers = [], commitAuthors = [] } = people;
  if (author === undefined && reviewers.length === 0 && commitAuthors.length === 0) return null;
  return (
    <div className="changes-people ph-no-capture">
      {author === undefined ? null : (
        <OpenedBy person={author} writtenAs={writtenAs} agent={agent} />
      )}
      {reviewers.length === 0 ? null : <ReviewersLine reviewers={reviewers} agent={agent} />}
      {commitAuthors.length === 0 ? null : (
        <ActorLine>
          {"Commits by "}
          <CommitAuthorPile authors={commitAuthors} agent={agent} />
        </ActorLine>
      )}
    </div>
  );
}
