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
import { MENTION_KIND, type Mention, type NumberedTaskIdOf } from "@repo/features/mention-link";
import type { TasksView } from "@repo/features/tasks-view";
import { type Workspace, workspaceOfSlug } from "@repo/features/workspace-wire";
import type { AppLinkStanding, AppStateSnapshot } from "@repo/host/app-state";
import { repositoryParts } from "@repo/ui/task-list-model";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo } from "react";
import { linkStandingQuery } from "../live-reads.js";
import { appStateNow, appStateQuery } from "../use-app-state.js";
import { PULL_REQUEST_STATE_LABEL, QUEUED_LABEL } from "./agent-model.js";

export interface ChipWhere {
  readonly taskId: string | undefined;
  readonly workspace: string;
}

const WordsWorkspaceContext = createContext<string | undefined>(undefined);

export const WordsWorkspace = WordsWorkspaceContext.Provider;

export interface LinkStanding {
  readonly key: string;
  readonly title: string;
  readonly state: string | undefined;
  readonly pullRequest: StandingPullRequest | undefined;
  readonly issue: { readonly number: number; readonly state: IssueState } | undefined;
  readonly opener: GitHubPerson | undefined;
}

const BOT_LOGIN_SUFFIX = "[bot]";

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

export interface StandingPullRequest {
  readonly number: number;
  readonly state: PullRequestState;
  readonly lines: { readonly additions: number; readonly deletions: number } | undefined;
  readonly files: number | undefined;
  readonly when: { readonly moment: PullRequestMoment; readonly at: number } | undefined;
  readonly branches: { readonly base: string; readonly head: string } | undefined;
  readonly labels: readonly { readonly name: string; readonly color: string }[];
  readonly comments: number | undefined;
  readonly commits: number | undefined;
  readonly queued?: true;
}

export const PULL_REQUEST_MOMENT = {
  OPENED: "opened",
  MERGED: "merged",
  CLOSED: "closed",
} as const;

export type PullRequestMoment = (typeof PULL_REQUEST_MOMENT)[keyof typeof PULL_REQUEST_MOMENT];

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

function standingPullRequestOf(pullRequest: GitHubPullRequestSummary): StandingPullRequest {
  return {
    number: pullRequest.number,
    state: pullRequest.state,
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

function queuedOf(pullRequest: GitHubPullRequestSummary): boolean {
  return pullRequest.queued === true && pullRequest.state === PULL_REQUEST_STATE.OPEN;
}

const ISSUE_WORDS = {
  open: "Open",
  closed: "Closed",
  "not-planned": "Not planned",
} as const satisfies Record<IssueState, string>;

const GITHUB_PAGE = { PULL_REQUEST: "pull-request", ISSUE: "issue" } as const;

type GitHubPage = (typeof GITHUB_PAGE)[keyof typeof GITHUB_PAGE];

interface Asked {
  readonly page: GitHubPage;
  readonly repository: string;
  readonly number: number;
}

function askedOf(address: string): Asked | undefined {
  const pullRequest = pullRequestAddressOf(address);
  if (pullRequest !== undefined) return { page: GITHUB_PAGE.PULL_REQUEST, ...pullRequest };
  const issue = issueAddressOf(address);
  return issue === undefined ? undefined : { page: GITHUB_PAGE.ISSUE, ...issue };
}

function githubAddressOf(mention: Mention): string | undefined {
  if (mention.kind !== MENTION_KIND.LINK || !("provider" in mention)) return undefined;
  return mention.provider === INTEGRATION_PROVIDER.GITHUB ? mention.url : undefined;
}

function keyOf(asked: Asked): string {
  return `${repositoryParts(asked.repository).name}#${asked.number}`;
}

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

function connectedFor(workspace: Workspace | undefined): workspace is Workspace {
  return workspace?.github?.active === true;
}

type WorkspacePlaces = Pick<TasksView, "workspaces" | "tasks">;

const selectWorkspacePlaces = (state: AppStateSnapshot): WorkspacePlaces => ({
  workspaces: state.tasks.workspaces,
  tasks: state.tasks.tasks,
});

function useWorkspacePlaces(): WorkspacePlaces | undefined {
  return useQuery({ ...appStateQuery, select: selectWorkspacePlaces }).data;
}

function workspaceOf(
  planning: WorkspacePlaces | undefined,
  taskId: string | undefined,
  namedId: string | undefined,
): Workspace | undefined {
  const workspaces = planning?.workspaces ?? [];
  const taskWorkspaceId =
    taskId === undefined
      ? undefined
      : planning?.tasks.find((task) => task.id === taskId)?.workspaceId;
  return (
    workspaces.find((each) => each.id === taskWorkspaceId) ??
    workspaces.find((each) => each.id === namedId)
  );
}

function wordsWorkspace(
  planning: WorkspacePlaces | undefined,
  where: ChipWhere,
  namedId: string | undefined,
): Workspace | undefined {
  return (
    workspaceOf(planning, where.taskId, namedId) ??
    workspaceOfSlug(planning?.workspaces ?? [], where.workspace)
  );
}

export function useNumberedTaskId(
  workspace: string,
  number: number | undefined,
): string | undefined {
  const planning = useWorkspacePlaces();
  return number === undefined ? undefined : numberedTaskIdIn(planning, { workspace, number });
}

function numberedTaskIdIn(
  planning: WorkspacePlaces | undefined,
  { workspace, number }: { readonly workspace: string; readonly number: number },
): string | undefined {
  if (planning === undefined) return undefined;
  const named = workspaceOfSlug(planning.workspaces, workspace);
  if (named === undefined) return undefined;
  return planning.tasks.find((task) => task.workspaceId === named.id && task.number === number)?.id;
}

export const numberedTaskIdNow: NumberedTaskIdOf = (task) =>
  numberedTaskIdIn(appStateNow()?.tasks, task);

export function useNumberedTaskIdOf(): NumberedTaskIdOf {
  const planning = useWorkspacePlaces();
  return (task) => numberedTaskIdIn(planning, task);
}

const NUMBERED_PLACES: ReadonlySet<LinkPlace["kind"]> = new Set([
  LINK_PLACE.TASK,
  LINK_PLACE.SECTION,
  LINK_PLACE.COMMENT,
  LINK_PLACE.VERSION,
  LINK_PLACE.PAGE,
]);

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

export function useNumberedPlace(): (place: LinkPlace, workspace: string) => LinkPlace {
  const planning = useWorkspacePlaces();
  return (place, workspace) => numberedPlaceIn(planning, place, workspace);
}

export function useWordsWorkspaceId(where: ChipWhere): string | undefined {
  return wordsWorkspace(useWorkspacePlaces(), where, useContext(WordsWorkspaceContext))?.id;
}

function useStandingAt(
  workspace: Workspace | undefined,
  address: string | undefined,
): LinkStanding | undefined {
  const asked = address === undefined ? undefined : askedOf(address);
  const link =
    asked !== undefined && address !== undefined && connectedFor(workspace)
      ? { workspaceId: workspace.id, address }
      : undefined;
  const { data: rows } = useQuery(linkStandingQuery(link));
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

export function useLinkStanding(mention: Mention, where: ChipWhere): LinkStanding | undefined {
  const workspace = wordsWorkspace(useWorkspacePlaces(), where, useContext(WordsWorkspaceContext));
  return useStandingAt(workspace, githubAddressOf(mention));
}

export function usePlaceStanding(
  place: { readonly taskId: string | null; readonly workspaceId?: string | undefined },
  address: string | undefined,
): LinkStanding | undefined {
  const workspace = workspaceOf(useWorkspacePlaces(), place.taskId ?? undefined, place.workspaceId);
  return useStandingAt(workspace, address);
}
