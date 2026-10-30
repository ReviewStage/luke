import {
  AGENT_CALL_FAILURE,
  type AgentChangesAnswerView,
  type AgentOverviewChecksAnswerView,
  type AgentOverviewConversationAnswerView,
  type AgentOverviewPullRequestAnswerView,
  type AgentPullRequestViewedAnswerView,
  type AgentPullRequestWriteAnswerView,
  type AgentReviewOptionsAnswerView,
} from "@luke/features/agent-view";
import { AGENT_STATUS, type AgentPullRequest } from "@luke/features/agent-wire";
import {
  PULL_REQUEST_CHAPTERS_CALL_FAILURE,
  type PullRequestChaptersAnswerView,
} from "@luke/features/pull-request-chapters-view";
import type { PullRequestActionRequest } from "@luke/features/pull-request-write-wire";
import { ACT_KIND } from "@luke/host/acts";
import { createContext, useContext, useMemo, useRef, useState } from "react";
import { type ActHandle, useAct } from "../act.js";
import { agentStillWriting } from "./agent-model.js";
import { pullRequestAsked, pullRequestOfTab } from "./pull-request-number.js";
import type { WritePlace } from "./pull-request-writes.js";
import type { AgentsControl } from "./use-agents.js";

/**
 * pull-request-source.ts -- where a Pull request tab reads and writes the pull request it shows: one door in front of every read and change the tab and its parts make.
 *
 * The tab and its parts, its header, Conversation, Checks, Chapters, and
 * Files changed, reach the pull request only through a `PullRequestSource`:
 * the pull request as last read, its overview's parts, its changed files,
 * its chapters, the member's viewed marks, and its changes, a review's among
 * them. A tab is an agent's for now (`agentPullRequestSource`), so each read
 * names the agent, and the pull request's number where the tab names one
 * (`pull-request-number.ts`). A pull request no agent opened is named by
 * its workspace, repository, and number instead
 * (`useRepositoryPullRequestSource`), and answers the same reads. The tab
 * hands its source down (`PullRequestSourceProvider`), so a change made
 * anywhere under it goes to the same pull request its reads came from.
 */

/** Every read and change a Pull request tab makes of the pull request it shows. */
export interface PullRequestSource {
  /** Whether what the pull request shows has settled, its agent no longer writing, which its reads are asked again on (`useAgentRead`). */
  readonly ended: boolean;
  /** Where a repository out of reach is mended, and the task its files' texts are read through. */
  readonly place: WritePlace;
  /** The pull request as last read, which names the tab before its overview lands; none before it is read. */
  readonly published: AgentPullRequest | undefined;
  /** Reads the pull request again, kept as `published` once it lands. */
  readonly readPublished: () => Promise<void>;
  /** The pull request itself as the overview draws it: its description, branches, mergeability, and people. */
  readonly readOverviewPullRequest: () => Promise<AgentOverviewPullRequestAnswerView>;
  /** Its conversation and where its reviewers stand. */
  readonly readOverviewConversation: () => Promise<AgentOverviewConversationAnswerView>;
  /** The checks on its head. */
  readonly readOverviewChecks: () => Promise<AgentOverviewChecksAnswerView>;
  /** What the reviewer and label pickers offer. */
  readonly readReviewOptions: () => Promise<AgentReviewOptionsAnswerView>;
  /** Its changed files, as Files changed draws them. */
  readonly readChanges: () => Promise<AgentChangesAnswerView>;
  /** Which of its files the member marked viewed on GitHub. */
  readonly readViewed: () => Promise<AgentPullRequestViewedAnswerView>;
  /** Its chapters, by the number the tab's own read of the pull request found. */
  readonly readChapters: (number: number) => Promise<PullRequestChaptersAnswerView>;
  /** Its chapters generated for its head now, answering once they land. */
  readonly generateChapters: () => Promise<PullRequestChaptersAnswerView>;
  /** One change to it, a viewed mark and a review among them. */
  readonly write: (request: PullRequestActionRequest) => Promise<AgentPullRequestWriteAnswerView>;
}

/** A pull request no agent opened, as a link names it: the workspace whose installation reaches its repository, the repository's full name, and the number. */
export interface RepositoryPullRequest {
  readonly workspaceId: string;
  readonly repository: string;
  readonly number: number;
}

/** What a read of the pickers' options answers while there is no read of them by a repository. */
const REVIEW_OPTIONS_UNANSWERED: AgentReviewOptionsAnswerView = {
  failure: AGENT_CALL_FAILURE.UNANSWERED,
};

/** What a read or a Generate of chapters answers where the host never did. */
const CHAPTERS_UNANSWERED: PullRequestChaptersAnswerView = {
  failure: PULL_REQUEST_CHAPTERS_CALL_FAILURE.UNANSWERED,
};

const PullRequestSourceContext = createContext<PullRequestSource | undefined>(undefined);

/** Hands everything under a Pull request tab the source it reads and writes through. */
export const PullRequestSourceProvider = PullRequestSourceContext.Provider;

/** The source of the Pull request tab the caller stands in; none outside one. */
export function usePullRequestSource(): PullRequestSource | undefined {
  return useContext(PullRequestSourceContext);
}

/** One change to the agent's pull request, or to the one of its repository by the number given. */
export function agentPullRequestWrite(
  act: ActHandle["act"],
  agentId: string,
  number: number | undefined,
): PullRequestSource["write"] {
  return (request) =>
    act(ACT_KIND.AGENTS_PULL_REQUEST_ACTION, { ...pullRequestAsked(agentId, number), request });
}

/**
 * The source of an agent's Pull request tab: the pull request from the
 * branch the agent stands on, or the one of its repository the tab names by
 * its number. The agent is found among the archived too, since an archived
 * agent's pull request keeps its tab.
 */
export function useAgentPullRequestSource(
  control: AgentsControl,
  agentId: string,
  number: number | undefined,
): PullRequestSource {
  const { act } = useAct();
  const agent =
    control.agents?.find((each) => each.id === agentId) ??
    control.archived?.find((each) => each.id === agentId);
  const ended = !agentStillWriting(agent?.status ?? AGENT_STATUS.RUNNING);
  const taskId = agent?.planId ?? null;
  const { workspaceId } = control;
  const published = pullRequestOfTab(control, { changes: agentId, number });
  const {
    readPullRequest,
    readNumberedPullRequest,
    readOverviewPullRequest,
    readOverviewConversation,
    readOverviewChecks,
    readReviewOptions,
    readChanges,
    readPullRequestViewed,
    readChapters,
    generateChapters,
  } = control;
  // Note that the doors are kept while what they name stands, because every part under the tab that hears the source draws anew on a new one.
  const doors = useMemo(
    () => ({
      readPublished: () =>
        (number === undefined
          ? readPullRequest(agentId)
          : readNumberedPullRequest(agentId, number)
        ).then(() => undefined),
      readOverviewPullRequest: () => readOverviewPullRequest(agentId, number),
      readOverviewConversation: () => readOverviewConversation(agentId, number),
      readOverviewChecks: () => readOverviewChecks(agentId, number),
      readReviewOptions: () => readReviewOptions(agentId),
      readChanges: () => readChanges(agentId, number),
      readViewed: () => readPullRequestViewed(agentId, number),
      readChapters: (found: number) => readChapters(agentId, found),
      generateChapters: () => generateChapters(agentId, number),
      write: agentPullRequestWrite(act, agentId, number),
    }),
    [
      act,
      agentId,
      number,
      readPullRequest,
      readNumberedPullRequest,
      readOverviewPullRequest,
      readOverviewConversation,
      readOverviewChecks,
      readReviewOptions,
      readChanges,
      readPullRequestViewed,
      readChapters,
      generateChapters,
    ],
  );
  // Note that a repository out of reach is mended in the agent's own workspace, by its task or, on none, its page's.
  const place = useMemo(() => ({ taskId, workspaceId }), [taskId, workspaceId]);
  return useMemo(() => ({ ...doors, ended, place, published }), [doors, ended, place, published]);
}

/** The pull request as last read, kept with the pull request it was read for, so a tab named anew never draws the one before. */
interface PublishedRead extends RepositoryPullRequest {
  readonly pullRequest: AgentPullRequest | undefined;
}

/** Whether a kept read is of the pull request named. */
function readOf(read: PublishedRead | undefined, named: RepositoryPullRequest): boolean {
  return (
    read !== undefined &&
    read.workspaceId === named.workspaceId &&
    read.repository === named.repository &&
    read.number === named.number
  );
}

/**
 * The source of a Pull request tab no agent opened: the pull request of a
 * workspace's repository by its number, read through the workspace's GitHub
 * installation. Nothing writes to it under the tab, so it stands settled
 * from the first read, and its chapters are generated only when Generate
 * asks. Its changes are mended, where its repository is out of reach, in
 * its workspace, with no task.
 */
export function useRepositoryPullRequestSource(named: RepositoryPullRequest): PullRequestSource {
  const { act } = useAct();
  const { workspaceId, repository, number } = named;
  const [read, setRead] = useState<PublishedRead | undefined>(undefined);
  // Each read of the pull request is numbered, so an older one landing late never takes back a newer one.
  const asked = useRef(0);
  // Note that the doors are kept while what they name stands, because every part under the tab that hears the source draws anew on a new one.
  const doors = useMemo(() => {
    const asks = { workspaceId, repository, number };
    return {
      readPublished: () => {
        asked.current += 1;
        const ask = asked.current;
        return act(ACT_KIND.PULL_REQUESTS_READ, asks).then((answer) => {
          if (ask !== asked.current || "failure" in answer) return;
          setRead({ ...asks, pullRequest: answer.pullRequest ?? undefined });
        });
      },
      readOverviewPullRequest: () => act(ACT_KIND.PULL_REQUESTS_OVERVIEW_PULL_REQUEST, asks),
      readOverviewConversation: () => act(ACT_KIND.PULL_REQUESTS_OVERVIEW_CONVERSATION, asks),
      readOverviewChecks: () => act(ACT_KIND.PULL_REQUESTS_OVERVIEW_CHECKS, asks),
      // Note that the service reads no pickers' options by a repository yet, so until it does the pickers say they could not be read.
      readReviewOptions: () => Promise.resolve(REVIEW_OPTIONS_UNANSWERED),
      readChanges: () => act(ACT_KIND.PULL_REQUESTS_CHANGES, asks),
      readViewed: () => act(ACT_KIND.PULL_REQUESTS_VIEWED, asks),
      // Note that the pull request is named already, so the number the tab's own read found adds nothing.
      readChapters: () =>
        act(ACT_KIND.PULL_REQUESTS_CHAPTERS, asks).catch(() => CHAPTERS_UNANSWERED),
      generateChapters: () =>
        act(ACT_KIND.PULL_REQUESTS_CHAPTERS_GENERATE, asks).catch(() => CHAPTERS_UNANSWERED),
      write: (request: PullRequestActionRequest) =>
        act(ACT_KIND.PULL_REQUESTS_ACTION, { ...asks, request }),
    };
  }, [act, workspaceId, repository, number]);
  const place = useMemo(() => ({ taskId: null, workspaceId }), [workspaceId]);
  const published = readOf(read, { workspaceId, repository, number })
    ? read?.pullRequest
    : undefined;
  return useMemo(() => ({ ...doors, ended: true, place, published }), [doors, place, published]);
}
