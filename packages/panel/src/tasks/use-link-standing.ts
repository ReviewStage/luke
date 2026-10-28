import {
  type GitHubPerson,
  PULL_REQUEST_STATE,
  type PullRequestState,
} from "@luke/features/coding-agent-wire";
import type { GitHubPullRequestSummary, IssueState } from "@luke/features/github-repositories-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { issueAddressOf, pullRequestAddressOf } from "@luke/features/link-grammar";
import { MENTION_KIND, type Mention } from "@luke/features/mention-link";
import type { TasksView } from "@luke/features/tasks-view";
import type { Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import * as Atom from "effect/reactivity/Atom";
import { createContext, useContext, useEffect, useState } from "react";
import { useAct } from "../act.js";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import { PULL_REQUEST_STATE_LABEL, QUEUED_LABEL } from "./coding-agent-model.js";

/**
 * use-link-standing.ts -- a GitHub pull request or issue a link in Luke's words names, as its chip says it: its key, its title, where it stands, who opened it, and a pull request's lines added and removed, read through the workspace's own GitHub App.
 *
 * The workspace is the one the words are of: the plan's, where they are a
 * plan's, else the one the place drawing them names, as the window's Inbox
 * names an item's own, its plan's or its agent's (`WordsWorkspace`), else the
 * one their mentions are written under.
 * Words that name neither, as an Inbox item whose workspace the service did
 * not name, read nothing, since a page read through another workspace's
 * connection would be drawn in the wrong one. A pull request or a GitHub
 * issue is read by its repository and number through the workspace's
 * GitHub App, on the service, once per chip, and only where that workspace
 * has the App, so a chip in a workspace without it asks nothing. Until it
 * first answers, or where it never does, a repository the App does not reach
 * among them, the chip says what the address says, as it always has. The
 * window keeps the last answer for each page by the workspace it was read
 * through, so a chip drawn again, as a plan's text is when a section opens
 * in its editor and when it closes, says it at once while it is read again,
 * rather than its address until the read lands; and a kept answer is drawn
 * only while that workspace still has the App, so a workspace that
 * disconnects stops drawing it. A Linear issue's chip asks nothing and says
 * what its address says.
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
  return `${asked.repository.split("/")[1] ?? asked.repository}#${asked.number}`;
}

/** A page's last answer as the window keeps it: the order its read was asked in, and what it answered, none where GitHub holds no such page. */
interface HeldStanding {
  readonly order: number;
  readonly standing: LinkStanding | undefined;
}

/**
 * The last answer this window read for each page, by the workspace it was
 * read through and then by the page's kind, repository, and number, let go
 * as the account signed in changes (`forgetStandings`), since what a page
 * answers may be the account's. Note that each is small and replaced by the
 * next read of the same page, so the window keeps every one it read rather
 * than bound them.
 */
const heldStandings = new Map<string, Map<GitHubPage, Map<string, Map<number, HeldStanding>>>>();

/** How many reads the window has asked, which orders their answers. */
let asks = 0;

/** What the window keeps for an ask through a workspace; nothing before any read landed. */
function heldOf(workspaceId: string, asked: Asked): HeldStanding | undefined {
  return heldStandings.get(workspaceId)?.get(asked.page)?.get(asked.repository)?.get(asked.number);
}

/**
 * An answer kept as the last for its ask through a workspace, an answer
 * that the page is gone included, so a chip stops saying a title GitHub no
 * longer answers. Note that an answer to a read asked before the one kept
 * is dropped, so reads landing out of order never put back what a later
 * one replaced.
 */
function keepStanding(workspaceId: string, asked: Asked, answer: HeldStanding): void {
  if ((heldOf(workspaceId, asked)?.order ?? -1) > answer.order) return;
  const pages =
    heldStandings.get(workspaceId) ?? new Map<GitHubPage, Map<string, Map<number, HeldStanding>>>();
  heldStandings.set(workspaceId, pages);
  const repositories = pages.get(asked.page) ?? new Map<string, Map<number, HeldStanding>>();
  pages.set(asked.page, repositories);
  const numbers = repositories.get(asked.repository) ?? new Map<number, HeldStanding>();
  repositories.set(asked.repository, numbers);
  numbers.set(asked.number, answer);
}

/** Lets go of every answer the window kept, as the account signed in changes. */
export function forgetStandings(): void {
  heldStandings.clear();
}

/** GitHub's answer for an ask, through the workspace's App: a pull request or an issue by repository and number; none where it holds none. */
function readStanding(
  act: ReturnType<typeof useAct>["act"],
  workspaceId: string,
  asked: Asked,
): Promise<LinkStanding | undefined> {
  const key = keyOf(asked);
  const numbered = { workspaceId, repository: asked.repository, number: asked.number };
  if (asked.page === GITHUB_PAGE.ISSUE) {
    return act(ACT_KIND.TASKS_ISSUE, numbered).then((issue) =>
      issue === null
        ? undefined
        : {
            key,
            title: issue.title,
            state: ISSUE_WORDS[issue.state],
            pullRequest: undefined,
            issue: { number: issue.number, state: issue.state },
            opener: openerOf(issue),
          },
    );
  }
  return act(ACT_KIND.TASKS_PULL_REQUEST, {
    workspaceId,
    repository: asked.repository,
    number: asked.number,
  }).then((pullRequest) =>
    pullRequest === null
      ? undefined
      : {
          key,
          title: pullRequest.title,
          state: queuedOf(pullRequest) ? QUEUED_LABEL : PULL_REQUEST_STATE_LABEL[pullRequest.state],
          pullRequest: standingPullRequestOf(pullRequest),
          issue: undefined,
          opener: openerOf(pullRequest),
        },
  );
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
    workspaces.find((each) => each.slug === where.workspace)
  );
}

/** The id of the workspace the words a chip stands in are of (`wordsWorkspace`); none where they name none. */
export function useWordsWorkspaceId(where: ChipWhere): string | undefined {
  return wordsWorkspace(useAppSlice(workspacePlacesAtom), where, useContext(WordsWorkspaceContext))
    ?.id;
}

/** What the provider answers for the page a link mention names, through the workspace `where` stands in; none for any other mention, while unread, refused, or unconnected. */
export function useLinkStanding(mention: Mention, where: ChipWhere): LinkStanding | undefined {
  const { act } = useAct();
  const asked = askedOf(mention);
  const workspace = wordsWorkspace(
    useAppSlice(workspacePlacesAtom),
    where,
    useContext(WordsWorkspaceContext),
  );
  const workspaceId = workspace?.id;
  const connected = asked !== undefined && connectedFor(workspace);
  // Note that the answer itself is kept by the window, so this only draws the chip again as it lands.
  const [, setAnswered] = useState<HeldStanding>();
  // Note that the read stands on what it asks, field by field, so a chip redrawn asks no more.
  const page = asked?.page;
  const repository = asked?.repository;
  const number = asked?.number;
  useEffect(() => {
    const ask: Asked | undefined =
      page !== undefined && repository !== undefined && number !== undefined
        ? { page, repository, number }
        : undefined;
    if (ask === undefined || workspaceId === undefined || !connected) return;
    let live = true;
    asks += 1;
    const order = asks;
    readStanding(act, workspaceId, ask).then(
      (standing) => {
        const answer = { order, standing };
        keepStanding(workspaceId, ask, answer);
        if (live) setAnswered(answer);
      },
      // Note that a refused read leaves the chip as the address says it, which is how it always stood.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [act, page, repository, number, workspaceId, connected]);
  // Note that an answer stands only for the workspace and the connection it was read through, so a disconnect or another workspace drops it at once.
  return connected && workspaceId !== undefined ? heldOf(workspaceId, asked)?.standing : undefined;
}
