/**
 * task-issue-links.ts -- the issues a task links after its start, as its page and the agents' tools read and change them: each read from its provider before it is linked, and drawn with where it stands now.
 *
 * A link is made from what the provider answers for the issue, never from
 * what a caller says of it: a Linear issue by its id or its key, read
 * through the workspace's own Linear connection (`linear-issues.ts`), and a
 * GitHub issue by its repository and number, read through the workspace's
 * installation where it has granted the App issues (`github-app.ts`'s
 * `repositoryIssueAccess`, `github/issues.ts`'s `issueLink`), as New task's
 * start reads one. An issue the provider answers none for, or a repository
 * whose issues the installation does not grant, is refused as not found;
 * Linear unread as Linear's own refusal.
 *
 * A read of a task's links answers each with where its issue stands now,
 * read live through the same connections and never kept: GitHub's mark, and
 * the name of Linear's workflow state. What a chip draws of a link, its key
 * and title, is written back where the provider now answers otherwise
 * (`refreshTaskIssue`), so a renamed issue reads renamed everywhere the row
 * is read. A provider that answers nothing for a link, unconnected,
 * refused, or out of reach, leaves that link drawn as its row keeps it, with
 * no standing, and refuses nothing else.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  type NewTaskIssueLink,
  refreshTaskIssue,
  type TaskIssueLink,
} from "@luke/database/models/task-issue-store";
import {
  TASK_ISSUE_PROVIDER,
  type TaskIssueChoice,
  type TaskIssueLinkView,
  type TaskIssueStanding,
} from "@luke/features/task-issue-wire";
import { Effect, Option, Result } from "effect";
import type { HttpClient } from "effect/http";
import { GitHubApp, ISSUE_ACCESS } from "../github/github-app.js";
import { githubReadOrRefusal } from "../github/github-refusal.js";
import { issueByNumber, issueLink } from "../github/issues.js";
import { HOSTED_REFUSAL } from "../http/http-effect.js";
import type { WorkspaceLinearConnect } from "../integrations/integration-connect.js";
import {
  linearIssue,
  linearIssueByIdentifier,
  linearOrRefused,
  throughWorkspaceLinear,
  workspaceLinearToken,
} from "../integrations/linear-issues.js";

/** What reading a task's issues reaches: the store, the workspace's Linear and GitHub, and the network. */
export type TaskIssueReadServices =
  | DatabaseServices
  | GitHubApp
  | WorkspaceLinearConnect
  | HttpClient.HttpClient;

/** How many providers' reads one task's links stand on at once. */
const LIVE_READS = 4;

/** The Linear issue an id or a key names, as a task links it, or the Linear refusal. */
export const linkedLinearIssue = (organizationId: string, issueId: string) =>
  linearOrRefused(
    throughWorkspaceLinear(organizationId, (token) => linearIssue(token, issueId)),
    "Linear gave no issue to link",
  );

/**
 * The GitHub issue a repository and number name, as a task links it: read
 * through the workspace's installation, and refused as not found where it
 * reaches no such issue or has not granted the App issues.
 */
export const linkedGitHubIssue = /* @__PURE__ */ Effect.fnUntraced(function* (
  organizationId: string,
  chosen: { readonly repository: string; readonly number: number },
) {
  const app = yield* GitHubApp;
  const access = yield* githubReadOrRefusal(
    app.repositoryIssueAccess(organizationId, chosen.repository),
  );
  if (access.kind !== ISSUE_ACCESS.READABLE) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const read = yield* githubReadOrRefusal(
    issueLink(access.token, access.repository.fullName, chosen.number),
  );
  if (Option.isNone(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.value;
});

/** The issue a choice names, read from its provider, with the relation the choice names where it names one. */
export const linkedIssue = /* @__PURE__ */ Effect.fnUntraced(function* (
  organizationId: string,
  choice: TaskIssueChoice,
) {
  const read: NewTaskIssueLink =
    choice.provider === TASK_ISSUE_PROVIDER.LINEAR
      ? yield* linkedLinearIssue(organizationId, choice.id)
      : yield* linkedGitHubIssue(organizationId, choice);
  return choice.relation === undefined ? read : { ...read, relation: choice.relation };
});

/** A link as the page draws it, with where its issue stands where that was read. */
export function linkViewOf(
  link: TaskIssueLink,
  standing: TaskIssueStanding | undefined,
): TaskIssueLinkView {
  return {
    id: link.id,
    provider: link.provider,
    externalId: link.externalId,
    key: link.key,
    url: link.url,
    title: link.title,
    ...(link.repository === null ? undefined : { repository: link.repository }),
    ...(link.number === null ? undefined : { number: link.number }),
    relation: link.relation,
    ...(standing === undefined ? undefined : { standing }),
  };
}

/** What a provider answered for a link now: what its chip draws and where it stands. */
interface LiveIssue {
  readonly key: string;
  readonly title: string;
  readonly standing: TaskIssueStanding;
}

/** The repositories whose issues the workspace's installation reads, each once, by the name the links keep. */
function githubTokens(organizationId: string, links: readonly TaskIssueLink[]) {
  const names = [
    ...new Set(links.flatMap((link) => (link.repository === null ? [] : [link.repository]))),
  ];
  return Effect.map(
    Effect.forEach(
      names,
      (name) =>
        Effect.flatMap(GitHubApp, (app) => app.repositoryIssueAccess(organizationId, name)).pipe(
          Effect.map((access) => [name, access] as const),
          Effect.orElseSucceed(() => [name, undefined] as const),
        ),
      { concurrency: LIVE_READS },
    ),
    (read) => new Map(read),
  );
}

/** The Linear token the workspace reads its issues on, where it has one. */
const linearToken = (organizationId: string) =>
  Effect.map(
    Effect.orElseSucceed(workspaceLinearToken(organizationId), () => undefined),
    (token) => (token === undefined || Result.isFailure(token) ? undefined : token.success.token),
  );

/**
 * Every link of the task with where its issue stands now, read live, and
 * what its chip draws written back where the provider now answers
 * otherwise; a link the provider answered nothing for stands as its row
 * keeps it.
 */
export const liveTaskIssues = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  taskId: string,
  organizationId: string,
  links: readonly TaskIssueLink[],
) {
  const github = links.filter((link) => link.provider === TASK_ISSUE_PROVIDER.GITHUB);
  const tokens = github.length === 0 ? new Map() : yield* githubTokens(organizationId, github);
  const linear = links.some((link) => link.provider === TASK_ISSUE_PROVIDER.LINEAR)
    ? yield* linearToken(organizationId)
    : undefined;
  const liveOf = (
    link: TaskIssueLink,
  ): Effect.Effect<LiveIssue | undefined, never, TaskIssueReadServices> => {
    if (link.provider === TASK_ISSUE_PROVIDER.LINEAR) {
      if (linear === undefined) return Effect.succeed(undefined);
      return linearIssueByIdentifier(linear, link.externalId).pipe(
        Effect.map(([issue]) =>
          issue?.state === undefined
            ? undefined
            : {
                key: issue.identifier,
                title: issue.title,
                standing: { provider: TASK_ISSUE_PROVIDER.LINEAR, state: issue.state },
              },
        ),
        Effect.orElseSucceed(() => undefined),
      );
    }
    const access = link.repository === null ? undefined : tokens.get(link.repository);
    if (access?.kind !== ISSUE_ACCESS.READABLE || link.number === null) {
      return Effect.succeed(undefined);
    }
    const fullName: string = access.repository.fullName;
    return issueByNumber(access.token, fullName, link.number).pipe(
      Effect.map((read) =>
        Option.isNone(read)
          ? undefined
          : {
              key: `${fullName}#${read.value.number}`,
              title: read.value.title,
              standing: { provider: TASK_ISSUE_PROVIDER.GITHUB, state: read.value.state },
            },
      ),
      Effect.orElseSucceed(() => undefined),
    );
  };
  return yield* Effect.forEach(
    links,
    (link) =>
      Effect.gen(function* () {
        const live = yield* liveOf(link);
        if (live === undefined) return linkViewOf(link, undefined);
        const drawn = { key: live.key, title: live.title };
        const changed = drawn.key !== link.key || drawn.title !== link.title;
        // Note that a refresh refused leaves the row as it was, because the read is the page's and the row is only its chip's words.
        if (changed) {
          yield* Effect.ignore(refreshTaskIssue(userId, taskId, link.id, drawn));
        }
        return linkViewOf({ ...link, ...drawn }, live.standing);
      }),
    { concurrency: LIVE_READS },
  );
});
