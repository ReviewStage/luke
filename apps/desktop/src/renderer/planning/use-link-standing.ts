import type { PullRequestState } from "@luke/features/coding-agent-wire";
import {
  type IssueState,
  issueAddressOf,
  pullRequestAddressOf,
} from "@luke/features/github-repositories-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { linearIssueIdentifierOf } from "@luke/features/linear-wire";
import { MENTION_KIND, type Mention } from "@luke/features/mention-link";
import type { TasksView } from "@luke/features/tasks-view";
import type { Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { createContext, useContext, useEffect, useState } from "react";
import { useAct } from "../act";
import { useAppState } from "../use-app-state";

/**
 * use-link-standing.ts -- a Linear issue, or a GitHub pull request or issue, a link in Luke's words names, as its chip says it: its key, its title, and where it stands, read through the workspace's own connection.
 *
 * The workspace is the one the words are of: the plan's, where they are a
 * plan's, else the one the place drawing them names, as the window's Inbox
 * names an item's own, its plan's or its agent's (`WordsWorkspace`), else the
 * one their mentions are written under.
 * Words that name neither, as an Inbox item whose workspace the service did
 * not name, read nothing, since a page read through another workspace's
 * connection would be drawn in the wrong one. A Linear issue is
 * read by its identifier through the workspace's Linear grant, and a pull
 * request or a GitHub issue by its repository and number through the
 * workspace's GitHub App, each on the service, once per chip, and only where that workspace has the
 * connection, so a chip in a workspace without it asks nothing. Until it
 * answers, or where it never does, a repository the App does not reach
 * among them, the chip says what the address says, as it always has, and an
 * answer is held to the workspace it was read through and the connection it
 * was read over, so a workspace that disconnects stops drawing it.
 */

/** Where the words a chip stands in are: the plan's id, or none off a plan, and the workspace's slug its mentions are written under. */
export interface ChipWhere {
  readonly planId: string;
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

/** A provider's page as its provider answered for it: its key, `ENG-123` or `relay#42`, its title, the state it stands in, and a pull request's or a GitHub issue's own state for its mark. */
export interface LinkStanding {
  readonly key: string;
  readonly title: string;
  readonly state: string | undefined;
  readonly pullRequest: { readonly number: number; readonly state: PullRequestState } | undefined;
  readonly issue: { readonly number: number; readonly state: IssueState } | undefined;
}

/** A pull request's state in words, as its chip says it. */
const PULL_REQUEST_WORDS = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
} as const satisfies Record<PullRequestState, string>;

/** A GitHub issue's state in words, as its chip says it. */
const ISSUE_WORDS = {
  open: "Open",
  closed: "Closed",
  "not-planned": "Not planned",
} as const satisfies Record<IssueState, string>;

/** The numbered pages of GitHub's a link may name. */
const GITHUB_PAGE = { PULL_REQUEST: "pull-request", ISSUE: "issue" } as const;

type GitHubPage = (typeof GITHUB_PAGE)[keyof typeof GITHUB_PAGE];

/** What a link mention asks its provider: a Linear issue by identifier, a pull request or a GitHub issue by repository and number; nothing for any other mention. */
type Asked =
  | { readonly provider: typeof INTEGRATION_PROVIDER.LINEAR; readonly identifier: string }
  | {
      readonly provider: typeof INTEGRATION_PROVIDER.GITHUB;
      readonly page: GitHubPage;
      readonly repository: string;
      readonly number: number;
    };

/** What a GitHub link asks for: the pull request or the issue its address names, if either. */
function githubAskedOf(url: string): Asked | undefined {
  const pullRequest = pullRequestAddressOf(url);
  if (pullRequest !== undefined) {
    return {
      provider: INTEGRATION_PROVIDER.GITHUB,
      page: GITHUB_PAGE.PULL_REQUEST,
      ...pullRequest,
    };
  }
  const issue = issueAddressOf(url);
  return issue === undefined
    ? undefined
    : { provider: INTEGRATION_PROVIDER.GITHUB, page: GITHUB_PAGE.ISSUE, ...issue };
}

/** What a mention asks its provider for, where it is a link to a Linear issue, a pull request, or a GitHub issue. */
function askedOf(mention: Mention): Asked | undefined {
  if (mention.kind !== MENTION_KIND.LINK) return undefined;
  if (mention.provider === INTEGRATION_PROVIDER.LINEAR) {
    const identifier = linearIssueIdentifierOf(mention.url);
    return identifier === undefined ? undefined : { provider: mention.provider, identifier };
  }
  if (mention.provider === INTEGRATION_PROVIDER.GITHUB) return githubAskedOf(mention.url);
  return undefined;
}

/** The key a chip names an asked page by: the Linear issue's identifier, or the repository's name and the pull request's or the issue's number. */
function keyOf(asked: Asked): string {
  return asked.provider === INTEGRATION_PROVIDER.LINEAR
    ? asked.identifier
    : `${asked.repository.split("/")[1] ?? asked.repository}#${asked.number}`;
}

/** Whether two asks ask for the same page. */
function sameAsked(first: Asked, second: Asked): boolean {
  if (first.provider === INTEGRATION_PROVIDER.LINEAR) {
    return (
      second.provider === INTEGRATION_PROVIDER.LINEAR && first.identifier === second.identifier
    );
  }
  return (
    second.provider === INTEGRATION_PROVIDER.GITHUB &&
    first.page === second.page &&
    first.repository === second.repository &&
    first.number === second.number
  );
}

/** The provider's answer for an ask, through the workspace's connection: a Linear issue by identifier, a pull request or a GitHub issue by repository and number; none where it holds none. */
function readStanding(
  act: ReturnType<typeof useAct>["act"],
  workspaceId: string,
  asked: Asked,
): Promise<LinkStanding | undefined> {
  const key = keyOf(asked);
  if (asked.provider === INTEGRATION_PROVIDER.LINEAR) {
    return act(ACT_KIND.WORKSPACE_LINEAR_ISSUES, {
      workspaceId,
      identifier: asked.identifier,
    }).then(([issue]) =>
      issue === undefined
        ? undefined
        : { key, title: issue.title, state: issue.state, pullRequest: undefined, issue: undefined },
    );
  }
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
          state: PULL_REQUEST_WORDS[pullRequest.state],
          pullRequest: { number: pullRequest.number, state: pullRequest.state },
          issue: undefined,
        },
  );
}

/** Whether the workspace has the connection an ask is read through: Linear connected, or an active GitHub installation. */
function connectedFor(asked: Asked, workspace: Workspace | undefined): boolean {
  if (workspace === undefined) return false;
  return asked.provider === INTEGRATION_PROVIDER.LINEAR
    ? workspace.linear?.active === true
    : workspace.github?.active === true;
}

/** The workspace the words a chip stands in are of: the plan's, else the one the place drawing them names, else the one their mentions are written under; none where they name none. */
function wordsWorkspace(
  planning: TasksView | undefined,
  where: ChipWhere,
  namedId: string | undefined,
): Workspace | undefined {
  const workspaces = planning?.workspaces ?? [];
  const planWorkspaceId = planning?.tasks.find((plan) => plan.id === where.planId)?.workspaceId;
  return (
    workspaces.find((each) => each.id === planWorkspaceId) ??
    workspaces.find((each) => each.id === namedId) ??
    workspaces.find((each) => each.slug === where.workspace)
  );
}

/** What the provider answers for the page a link mention names, through the workspace `where` stands in; none for any other mention, while unread, refused, or unconnected. */
export function useLinkStanding(mention: Mention, where: ChipWhere): LinkStanding | undefined {
  const { act } = useAct();
  const asked = askedOf(mention);
  const workspace = wordsWorkspace(useAppState()?.tasks, where, useContext(WordsWorkspaceContext));
  const workspaceId = workspace?.id;
  const connected = asked !== undefined && connectedFor(asked, workspace);
  const [read, setRead] = useState<{
    workspaceId: string;
    asked: Asked;
    standing: LinkStanding;
  }>();
  // Note that the read stands on what it asks, field by field, so a chip redrawn asks no more.
  const identifier = asked?.provider === INTEGRATION_PROVIDER.LINEAR ? asked.identifier : undefined;
  const page = asked?.provider === INTEGRATION_PROVIDER.GITHUB ? asked.page : undefined;
  const repository = asked?.provider === INTEGRATION_PROVIDER.GITHUB ? asked.repository : undefined;
  const number = asked?.provider === INTEGRATION_PROVIDER.GITHUB ? asked.number : undefined;
  useEffect(() => {
    const ask: Asked | undefined =
      identifier !== undefined
        ? { provider: INTEGRATION_PROVIDER.LINEAR, identifier }
        : page !== undefined && repository !== undefined && number !== undefined
          ? { provider: INTEGRATION_PROVIDER.GITHUB, page, repository, number }
          : undefined;
    if (ask === undefined || workspaceId === undefined || !connected) return;
    let live = true;
    readStanding(act, workspaceId, ask).then(
      (standing) => {
        if (live && standing !== undefined) setRead({ workspaceId, asked: ask, standing });
      },
      // Note that a refused read leaves the chip as the address says it, which is how it always stood.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [act, identifier, page, repository, number, workspaceId, connected]);
  // Note that an answer stands only for the workspace and the connection it was read through, so a disconnect or another workspace drops it at once.
  const current =
    connected &&
    read !== undefined &&
    asked !== undefined &&
    read.workspaceId === workspaceId &&
    sameAsked(read.asked, asked);
  return current ? read.standing : undefined;
}
