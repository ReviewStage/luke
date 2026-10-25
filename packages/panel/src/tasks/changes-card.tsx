import type {
  CodingAgentChangesPeople,
  CodingAgentPullRequest,
} from "@luke/features/coding-agent-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import { HoverCard, HoverCardHead, HoverCardNote } from "@luke/ui";
import { useEffect } from "react";
import { PULL_REQUEST_TAB } from "../desktop/pages-on-demand.js";
import { LinesChanged } from "./agent-published.js";
import { AgentActorRef, type AgentSubject } from "./agent-ref.js";
import { pullRequestNumberLabel } from "./coding-agent-model.js";
import { PullRequestMark } from "./pull-request-mark.js";
import { OpenedBy, ReviewersLine } from "./pull-request-people.js";
import type { HeldPeople } from "./use-coding-agents.js";

/**
 * changes-card.tsx -- the card a Pull request tab hangs, and its row in the task's summary, kept apart from the tab itself so the window draws the card without the tab's chunk.
 *
 * The tab (`agent-pull-request-tab.tsx`) is a chunk of its own, read the
 * first time one is drawn (`pages-on-demand.ts`); the card hanging is the
 * pointer resting on its tab or its row, so it starts that read, and the
 * press that follows finds the tab landed.
 */

/** Who a pull request names, as its tab last read them for that very pull request; none where the tab read them for another, or has not yet. */
export function peopleOf(
  held: HeldPeople | undefined,
  pullRequest: Pick<CodingAgentPullRequest, "url">,
): CodingAgentChangesPeople | undefined {
  return held?.url === pullRequest.url ? held.people : undefined;
}

/**
 * The card a Changes tab hangs, and its row in the task's summary, in a tab
 * card's look: the pull request's title with its mark and number at the
 * right, the coding agent whose pull request it is under the title, by its
 * tile and name as every place naming an agent draws it (`ActorRef`),
 * which hang the agent's card and open its tab, and under them how many
 * files it changes, where that is known, and the lines it adds and
 * removes, as GitHub counts them, then, once its Changes tab has read them,
 * who opened it and its reviewers, each face wearing where they stand
 * (`pull-request-people.tsx`).
 */
export function ChangesCard({
  subject,
  models,
  pullRequest,
  people,
  onOpenAgent,
}: {
  /** The agent whose pull request it is, as the plan's list names it. */
  subject: AgentSubject;
  /** The catalog as last read, which names the agent's model on its card. */
  models: readonly CatalogModel[] | undefined;
  pullRequest: CodingAgentPullRequest;
  /** Who the pull request names, as its Changes tab last read them; none before it has. */
  people: CodingAgentChangesPeople | undefined;
  /** Opens the agent's tab in the plan's column. */
  onOpenAgent: () => void;
}): React.JSX.Element {
  // The card hanging is the pointer on its tab, so the tab's chunk is read now rather than at the press.
  useEffect(PULL_REQUEST_TAB.prefetch, []);
  const count = pullRequest.changedFiles;
  const reviewers = people?.reviewers ?? [];
  return (
    <HoverCard data-tab-card="">
      <HoverCardHead
        name={pullRequest.title}
        sub={<AgentActorRef subject={subject} models={models} onOpen={onOpenAgent} />}
        corner={
          <>
            <PullRequestMark pullRequest={pullRequest} className="card-corner-mark" />
            {pullRequestNumberLabel(pullRequest)}
          </>
        }
      />
      <HoverCardNote>
        {/* Note that no files is a count unknown, as a pull request the task list pushed for an archived agent says none (`useTaskPullRequests`). */}
        {count === 0 ? null : `${count} ${count === 1 ? "file" : "files"} changed `}
        <LinesChanged additions={pullRequest.additions} deletions={pullRequest.deletions} />
      </HoverCardNote>
      {people?.author === undefined ? null : (
        <HoverCardNote oneLine>
          <OpenedBy person={people.author} />
        </HoverCardNote>
      )}
      {reviewers.length === 0 ? null : (
        <HoverCardNote>
          <ReviewersLine reviewers={reviewers} />
        </HoverCardNote>
      )}
    </HoverCard>
  );
}
