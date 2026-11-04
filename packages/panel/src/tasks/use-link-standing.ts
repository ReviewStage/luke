import {
  type GitHubPerson,
  PULL_REQUEST_STATE,
  type PullRequestState,
} from "@repo/features/agent-wire";
import type { GitHubPullRequestSummary, IssueState } from "@repo/features/github-repositories-wire";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import {
  issueAddressOf,
  LINK_PLACE,
  type LinkPlace,
  pullRequestAddressOf,
  taskLinkStep,
  withTaskId,
} from "@repo/features/link-grammar";
import { LIVE_READ } from "@repo/features/live-wire";
import { MENTION_KIND, type Mention, type NumberedTaskIdOf } from "@repo/features/mention-link";
import type { TasksView } from "@repo/features/tasks-view";
import { type Workspace, workspaceOfSlug } from "@repo/features/workspace-wire";
import type { AppLinkStanding } from "@repo/host/app-state";
import { repositoryParts } from "@repo/ui/task-list-model";
import * as Atom from "effect/reactivity/Atom";
import { createContext, useContext, useMemo } from "react";
import { APP_SLICE, appStateNow, useAppSlice } from "../use-app-state.js";
import { useHostRead } from "../use-host-read.js";
import { PULL_REQUEST_STATE_LABEL, QUEUED_LABEL } from "./agent-model.js";

/**
 * use-link-standing.ts -- a GitHub pull request or issue a link in the app's words names, as its chip says it: its key, its title, where it stands, who opened it, and a pull request's lines added and removed, read through the workspace's own GitHub App.
 *
 * The workspace is the one the words are of: the plan's, where they are a
 * plan's, else the one the place drawing them names, as the window's Inbox
 * names an item's own, its plan's or its agent's (`WordsWorkspace`), else the
 * one their mentions are written under.
 * Words that name neither, as an Inbox item whose workspace the service did
 * not name, read nothing, since a page read through another workspace's
 * connection would be drawn in the wrong one. A pull request or a GitHub
 * issue is held by the host while a chip draws it (`LIVE_READ.LINK_STANDINGS`),
 * by the workspace and the link's own address, read through the workspace's
 * GitHub App on the service, and only where that workspace has the App, so a
 * chip in a workspace without it asks nothing. Until it first answers, or
 * where it never does, a repository the App does not reach among them, the
 * chip says what the address says, as it always has. A chip drawn again, as a
 * plan's text is when a section opens in its editor and when it closes, says
 * the last answer at once while the host asks again, rather than its address
 * until the read lands; and an answer is drawn only while that workspace
 * still has the App, so a workspace that disconnects stops drawing it. A
 * Linear issue's chip asks nothing and says what its address says.
 */

/** Where the words a chip stands in are: the plan's id, none off a plan, and the workspace's slug its mentions are written under. */
export interface ChipWhere {
  readonly taskId: string | undefined;
  readonly workspace: string;
}

/**
 * The workspace words drawn off a plan's page are of, where the place
 * drawing them knows it, as the window's Inbox knows an item's: by its id,
 * since a workspace an older service answered may have no slug. None where
 * it does not know it, so a link there reads nothing rather than another
 * workspace's.
 */
const WordsWorkspaceContext = createContext<string | undefined>(undefined);

/** Hands the words under it the workspace they are of, by its id. */
export const WordsWorkspace = WordsWorkspaceContext.Provider;

/** A GitHub page as GitHub answered for it: its key, `relay#42`, its title, the state it stands in, and a pull request's or an issue's own state for its mark. */
export interface LinkStanding {
  readonly key: string;
  readonly title: string;
  readonly state: string | undefined;
  readonly pullRequest: StandingPullRequest | undefined;
  readonly issue: { readonly number: number; readonly state: IssueState } | undefined;
  /** Who opened a pull request or a GitHub issue, as its card draws them by their face; none where GitHub named no one. */
  readonly opener: GitHubPerson | undefined;
}

/** The suffix GitHub gives an App's bot's login, which names a bot where an older service answered no more than the login. */
const BOT_LOGIN_SUFFIX = "[bot]";

/** Who opened a pull request or a GitHub issue, as GitHub named them on it: their login, their avatar where the service answered one, and whether they are an App's bot. */
export function openerOf(summary: {
  readonly author?: string;
  readonly authorAvatarUrl?: string;
  readonly authorBot?: boolean;
}): GitHubPerson | undefined {
  const { author, authorAvatarUrl, authorBot } = summary;
  if (author === undefined) return undefined;
  const person = { login: author, bot: authorBot ?? author.endsWith(BOT_LOGIN_SUFFIX) };
  return authorAvatarUrl === undefined ? person : { ...person, avatarUrl: authorAvatarUrl };
}

/** A pull request as its chip draws it: its number and state for its mark, and for its card what the service answered of it, each none, or no labels, where an older service answered none. */
export interface StandingPullRequest {
  readonly number: number;
  readonly state: PullRequestState;
  readonly lines: { readonly additions: number; readonly deletions: number } | undefined;
  readonly files: number | undefined;
  /** When it was last opened, merged, or closed, as its state says: merged when merged, closed when closed, and opened otherwise. */
  readonly when: { readonly moment: PullRequestMoment; readonly at: number } | undefined;
  readonly branches: { readonly base: string; readonly head: string } | undefined;
  readonly labels: readonly { readonly name: string; readonly color: string }[];
  readonly comments: number | undefined;
  readonly commits: number | undefined;
  /** True where it is open and GitHub's merge queue holds it, which its mark and its words say as its Pull request tab does. */
  readonly queued?: true;
}

/** The moment a pull request's card names when it says how long ago: when it was opened, merged, or closed. */
export const PULL_REQUEST_MOMENT = {
  OPENED: "opened",
  MERGED: "merged",
  CLOSED: "closed",
} as const;

export type PullRequestMoment = (typeof PULL_REQUEST_MOMENT)[keyof typeof PULL_REQUEST_MOMENT];

/** When the card says a pull request last moved, as its state names it: merged or closed when it was, and opened otherwise; none where the service answered no time for it. */
function whenOf(pullRequest: GitHubPullRequestSummary): StandingPullRequest["when"] {
  if (pullRequest.state === PULL_REQUEST_STATE.MERGED && pullRequest.mergedAt !== undefined) {
    return { moment: PULL_REQUEST_MOMENT.MERGED, at: pullRequest.mergedAt };
  }
  if (pullRequest.state === PULL_REQUEST_STATE.CLOSED && pullRequest.closedAt !== undefined) {
    return { moment: PULL_REQUEST_MOMENT.CLOSED, at: pullRequest.closedAt };
  }
  return pullRequest.openedAt === undefined
    ? undefined
    : { moment: PULL_REQUEST_MOMENT.OPENED, at: pullRequest.openedAt };
}

/** A pull request as the service answered it for a chip, as its card draws it. */
function standingPullRequestOf(pullRequest: GitHubPullRequestSummary): StandingPullRequest {
  return {
    number: pullRequest.number,
    state: pullRequest.state,
    // Note that an older service answers none of what follows, so its card draws none of it.
    lines:
      pullRequest.additions === undefined || pullRequest.deletions === undefined
        ? undefined
        : { additions: pullRequest.additions, deletions: pullRequest.deletions },
    files: pullRequest.changedFiles,
    when: whenOf(pullRequest),
    branches:
      pullRequest.baseRef === undefined || pullRequest.headRef === undefined
        ? undefined
        : { base: pullRequest.baseRef, head: pullRequest.headRef },
    labels: pullRequest.labels ?? [],
    comments: pullRequest.comments,
    commits: pullRequest.commits,
    ...(queuedOf(pullRequest) ? { queued: true } : undefined),
  };
}

/** Whether a pull request is drawn queued: open, and held in GitHub's merge queue. */
function queuedOf(pullRequest: GitHubPullRequestSummary): boolean {
  return pullRequest.queued === true && pullRequest.state === PULL_REQUEST_STATE.OPEN;
}

/** A GitHub issue's state in words, as its chip says it. */
const ISSUE_WORDS = {
  open: "Open",
  closed: "Closed",
  "not-planned": "Not planned",
} as const satisfies Record<IssueState, string>;

/** The numbered pages of GitHub's a link may name. */
const GITHUB_PAGE = { PULL_REQUEST: "pull-request", ISSUE: "issue" } as const;

type GitHubPage = (typeof GITHUB_PAGE)[keyof typeof GITHUB_PAGE];

/** What a link mention asks GitHub: a pull request or an issue by repository and number. */
interface Asked {
  readonly page: GitHubPage;
  readonly repository: string;
  readonly number: number;
}

/** What a mention asks GitHub for, where it is a link to a pull request or a GitHub issue. */
function askedOf(mention: Mention): Asked | undefined {
  // Note that a well-known site's page names no provider to ask.
  if (mention.kind !== MENTION_KIND.LINK || !("provider" in mention)) return undefined;
  if (mention.provider !== INTEGRATION_PROVIDER.GITHUB) return undefined;
  const pullRequest = pullRequestAddressOf(mention.url);
  if (pullRequest !== undefined) return { page: GITHUB_PAGE.PULL_REQUEST, ...pullRequest };
  const issue = issueAddressOf(mention.url);
  return issue === undefined ? undefined : { page: GITHUB_PAGE.ISSUE, ...issue };
}

/** The key a chip names an asked page by: the repository's name and the pull request's or the issue's number. */
function keyOf(asked: Asked): string {
  return `${repositoryParts(asked.repository).name}#${asked.number}`;
}

/** What a chip draws of the page a link names, from what GitHub holds of it as the host last read it; none where GitHub holds no such page. */
function standingOf(asked: Asked, held: AppLinkStanding): LinkStanding | undefined {
  const key = keyOf(asked);
  if ("issue" in held) {
    const { issue } = held;
    return issue === null
      ? undefined
      : {
          key,
          title: issue.title,
          state: ISSUE_WORDS[issue.state],
          pullRequest: undefined,
          issue: { number: issue.number, state: issue.state },
          opener: openerOf(issue),
        };
  }
  const { pullRequest } = held;
  return pullRequest === null
    ? undefined
    : {
        key,
        title: pullRequest.title,
        state: queuedOf(pullRequest) ? QUEUED_LABEL : PULL_REQUEST_STATE_LABEL[pullRequest.state],
        pullRequest: standingPullRequestOf(pullRequest),
        issue: undefined,
        opener: openerOf(pullRequest),
      };
}

/** Whether the workspace has the connection an ask is read through: an active GitHub installation. */
function connectedFor(workspace: Workspace | undefined): boolean {
  return workspace?.github?.active === true;
}

/** What of the tasks a chip's workspace is found by: the workspaces, and the tasks that name theirs. */
type WorkspacePlaces = Pick<TasksView, "workspaces" | "tasks">;

/**
 * The workspaces and tasks of the document, which tells the chips only as
 * either moves, so a transcript of chips is not drawn again for each word an
 * agent streams into the slice beside them.
 */
const workspacePlacesAtom: Atom.Atom<WorkspacePlaces | undefined> = Atom.withEquality(
  Atom.map(APP_SLICE.TASKS, (planning) =>
    planning === undefined ? undefined : { workspaces: planning.workspaces, tasks: planning.tasks },
  ),
  (held, next) => held?.workspaces === next?.workspaces && held?.tasks === next?.tasks,
);

/** The workspace the words a chip stands in are of: the plan's, else the one the place drawing them names, else the one their mentions are written under; none where they name none. */
function wordsWorkspace(
  planning: WorkspacePlaces | undefined,
  where: ChipWhere,
  namedId: string | undefined,
): Workspace | undefined {
  const workspaces = planning?.workspaces ?? [];
  const { taskId } = where;
  const taskWorkspaceId =
    taskId === undefined
      ? undefined
      : planning?.tasks.find((task) => task.id === taskId)?.workspaceId;
  return (
    workspaces.find((each) => each.id === taskWorkspaceId) ??
    workspaces.find((each) => each.id === namedId) ??
    workspaceOfSlug(workspaces, where.workspace)
  );
}

/**
 * The id of the task a link names by its number, `…/task/42`, among the
 * tasks the window lists: the one of that number in the workspace the
 * link's first step names among the reader's own (`workspaceOfSlug`); none
 * where it names no number, or the window lists no such task, as one moved
 * out of the workspace since, which only the service still finds.
 */
export function useNumberedTaskId(
  workspace: string,
  number: number | undefined,
): string | undefined {
  const planning = useAppSlice(workspacePlacesAtom);
  return number === undefined ? undefined : numberedTaskIdIn(planning, { workspace, number });
}

/** The id of the task a link names by its number among the tasks `planning` lists (`useNumberedTaskId`); none where it lists none. */
function numberedTaskIdIn(
  planning: WorkspacePlaces | undefined,
  { workspace, number }: { readonly workspace: string; readonly number: number },
): string | undefined {
  if (planning === undefined) return undefined;
  const named = workspaceOfSlug(planning.workspaces, workspace);
  if (named === undefined) return undefined;
  return planning.tasks.find((task) => task.workspaceId === named.id && task.number === number)?.id;
}

/** The id of the task a link names by its number among the tasks the window lists as it stands now (`useNumberedTaskId`), for a press that cannot wait a render; nothing redraws for it. */
export const numberedTaskIdNow: NumberedTaskIdOf = (task) =>
  numberedTaskIdIn(appStateNow()?.tasks, task);

/** How the id of the task a link names by its number is found among the tasks the window lists (`useNumberedTaskId`), for words pasted. */
export function useNumberedTaskIdOf(): NumberedTaskIdOf {
  const planning = useAppSlice(workspacePlacesAtom);
  return (task) => numberedTaskIdIn(planning, task);
}

/** The places a task's links name it in, which a link written by the task's number names it in too. */
const NUMBERED_PLACES: ReadonlySet<LinkPlace["kind"]> = new Set([
  LINK_PLACE.TASK,
  LINK_PLACE.SECTION,
  LINK_PLACE.COMMENT,
  LINK_PLACE.VERSION,
  LINK_PLACE.PAGE,
]);

/**
 * A place naming its task by its id, named by the task's number
 * (`taskLinkStep`) where the window lists the task with one in the
 * workspace its link is written under, `workspace`, since a number names a
 * task only in its own workspace; any other place as it is.
 */
function numberedPlaceIn(
  planning: WorkspacePlaces | undefined,
  place: LinkPlace,
  workspace: string,
): LinkPlace {
  if (!NUMBERED_PLACES.has(place.kind) || !("planId" in place)) return place;
  const task = planning?.tasks.find((each) => each.id === place.planId);
  if (planning === undefined || task?.number === undefined) return place;
  const home = workspaceOfSlug(planning.workspaces, workspace);
  return home?.id === task.workspaceId ? withTaskId(place, taskLinkStep(task)) : place;
}

/** How a place's link is written by its task's number where the window lists one (`numberedPlaceIn`), as Copy link writes it. */
export function useNumberedPlace(): (place: LinkPlace, workspace: string) => LinkPlace {
  const planning = useAppSlice(workspacePlacesAtom);
  return (place, workspace) => numberedPlaceIn(planning, place, workspace);
}

/** The id of the workspace the words a chip stands in are of (`wordsWorkspace`); none where they name none. */
export function useWordsWorkspaceId(where: ChipWhere): string | undefined {
  return wordsWorkspace(useAppSlice(workspacePlacesAtom), where, useContext(WordsWorkspaceContext))
    ?.id;
}

/**
 * What the provider answers for the page a link mention names, through the
 * workspace `where` stands in; none for any other mention, while unread or
 * unconnected, or where GitHub holds no such page. The host holds it while
 * the chip draws it (`LIVE_READ.LINK_STANDINGS`), by the workspace and the
 * link's own address, so a chip drawn again draws it at once.
 */
export function useLinkStanding(mention: Mention, where: ChipWhere): LinkStanding | undefined {
  const asked = askedOf(mention);
  const workspace = wordsWorkspace(
    useAppSlice(workspacePlacesAtom),
    where,
    useContext(WordsWorkspaceContext),
  );
  // Note that a standing stands only for the workspace and the connection it was read through, so a disconnect or another workspace holds none.
  const link =
    asked !== undefined && workspace !== undefined && connectedFor(workspace) && "url" in mention
      ? { workspaceId: workspace.id, address: mention.url }
      : undefined;
  const { rows } = useHostRead(LIVE_READ.LINK_STANDINGS, link);
  const page = asked?.page;
  const repository = asked?.repository;
  const number = asked?.number;
  return useMemo(
    () =>
      page === undefined || repository === undefined || number === undefined || rows === undefined
        ? undefined
        : standingOf({ page, repository, number }, rows),
    [page, repository, number, rows],
  );
}
