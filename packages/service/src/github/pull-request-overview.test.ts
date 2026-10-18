import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  createCodingAgent,
  recordCodingAgentPublished,
  updateCodingAgentBranch,
} from "@luke/database/models/coding-agent-store";
import { account, user } from "@luke/database/schemas/auth";
import { getTestDB, openWorkspace, startTask } from "@luke/database/testing";
import {
  CHECK_STATE,
  CHECK_SUMMARY,
  CODING_AGENT_AUTHOR,
  CONVERSATION_ENTRY,
  DEPLOYMENT_STATE,
  DIFF_SIDE,
  MERGE_STATE,
  OVERVIEW_BOUNDS,
  PULL_REQUEST_STATE,
  REVIEW_STATE,
} from "@luke/features/coding-agent-wire";
import { REACTION } from "@luke/features/pull-request-write-wire";
import { Duration, Effect, Fiber, Option, Redacted } from "effect";
import { TestClock } from "effect/testing";
import {
  GITHUB_FIXTURE_BOT,
  githubReaching,
  type RepositoryScript,
} from "../testing/github-app-fake.js";
import { GITHUB_PROVIDER_ID } from "./github-app.js";
import { namedOverviewConversation, namedOverviewPullRequest } from "./github-people.js";
import {
  pullRequestChecks,
  pullRequestConversation,
  pullRequestDeployments,
  pullRequestOverview,
  viewerReactionsOf,
} from "./pull-requests.js";

/**
 * An agent's pull request as its Pull request tab draws it, read off a
 * scripted GitHub over a real dialect in its three reads: the pull request
 * itself, its description, branches, and mergeability; every check on its
 * head, a check run or a commit status, by where it stands; and its
 * comments and reviews as one conversation in time order, its people named
 * as an agent's changes name them. Each read stands without the others.
 * Synthetic accounts throughout.
 */

const REPOSITORY = "acme/relay";
const NUMBER = 7;
const TOKEN = Redacted.make("ghs_fixture_installation_token");
const PULL = `/repos/acme/relay/pulls/${NUMBER}`;
const COMMENTS = `/repos/acme/relay/issues/${NUMBER}/comments`;
/** The pull request's head as its checks are asked for: the ref GitHub keeps on it, one segment. */
const COMMIT = `/repos/acme/relay/commits/refs%2Fpull%2F${NUMBER}%2Fhead`;
const PAGE = `https://github.com/acme/relay/pull/${NUMBER}`;

/** GitHub's record of an account. */
function githubUser(id: number, login: string) {
  return {
    id,
    login,
    type: login.endsWith("[bot]") ? "Bot" : "User",
    avatar_url: `https://avatars.githubusercontent.com/u/${id}?v=4`,
  };
}

const CHARLES = githubUser(1001, "charlespan");
const PRIYA = githubUser(1002, "priyan");
const LUKE = githubUser(GITHUB_FIXTURE_BOT.id, GITHUB_FIXTURE_BOT.login);
/** Another App's bot, which GitHub draws by its App's logo, at its App's address. */
const DEVIN = {
  ...githubUser(1004, "devin-ai-integration[bot]"),
  avatar_url: "https://avatars.githubusercontent.com/in/811515?v=4",
};

/** What a test changes of the pull request GitHub answers. */
interface PullOverrides {
  readonly state?: string;
  readonly merged?: boolean;
  readonly merged_at?: string | null;
  readonly mergeable_state?: string;
  readonly body?: string | null;
  readonly body_html?: string | null;
  readonly draft?: boolean;
  readonly labels?: readonly { readonly name: string; readonly color: string }[];
  readonly base?: { readonly ref: string };
}

/** The pull request as GitHub answers it whole, open and ready unless said otherwise. */
function pull(overrides: PullOverrides = {}) {
  return {
    number: NUMBER,
    title: "Send the invite once",
    html_url: PAGE,
    state: "open",
    draft: false,
    merged: false,
    merged_at: null,
    additions: 12,
    deletions: 3,
    changed_files: 2,
    body: "Sends the invite **once**.",
    body_html: '<p dir="auto">Sends the invite <strong>once</strong>.</p>',
    base: { ref: "main" },
    head: { ref: "luke/invite-once", sha: "a1b2c3d" },
    created_at: "2026-10-15T09:00:00Z",
    mergeable_state: "clean",
    user: LUKE,
    requested_reviewers: [PRIYA],
    ...overrides,
  };
}

/** A check run as GitHub lists one. */
function checkRun(name: string, status: string, conclusion: string | null) {
  return {
    name,
    status,
    conclusion,
    html_url: `https://github.com/acme/relay/runs/${name}`,
    started_at: "2026-10-15T09:01:00Z",
    completed_at: status === "completed" ? "2026-10-15T09:04:00Z" : null,
    app: { id: 15368, name: "GitHub Actions" },
  };
}

/** GitHub's GraphQL answer to the deployments read, the head's deployments newest first, as given, as many as the query asks for; none where none are given. */
function deploymentsAnswer(
  deployments: readonly object[] | Response | undefined,
  query: string,
): object | Response | undefined {
  if (deployments === undefined || deployments instanceof Response) return deployments;
  const first = Number(/deployments\(first: (\d+)/u.exec(query)?.[1] ?? "0");
  const nodes = deployments.slice(0, first);
  return {
    data: {
      repository: {
        pullRequest: { commits: { nodes: [{ commit: { deployments: { nodes } } }] } },
      },
    },
  };
}

/** A deployment as GitHub's GraphQL names one, with its newest status; one with none yet stands as queued. */
function deployment(environment: string, status: string | null, url: string | null) {
  return {
    environment,
    state: status === null ? "QUEUED" : "ACTIVE",
    creator: { avatarUrl: "https://avatars.githubusercontent.com/in/8329?v=4" },
    latestStatus: status === null ? null : { state: status, environmentUrl: url },
  };
}

/** A repository answering the overview's reads as given, and not found for the rest. */
function repository(answers: {
  readonly pull?: object;
  readonly checkRuns?: readonly object[] | Response;
  readonly statuses?: readonly object[];
  readonly comments?: readonly object[];
  readonly reviews?: readonly object[];
  readonly graphql?: object | Response;
  readonly deployments?: readonly object[] | Response;
  /** The repository's open pull requests, as the stack's GraphQL read lists them. */
  readonly open?: readonly object[] | Response;
}): RepositoryScript {
  return (sent) => {
    const { pathname } = new URL(sent.url);
    if (
      pathname === "/graphql" &&
      sent.method === "POST" &&
      sent.body.includes("OpenPullRequests")
    ) {
      const asked: { variables: { owner: string; name: string; after: string | null } } =
        JSON.parse(sent.body);
      // Note that the stack is read of the agent's repository alone.
      assert.deepEqual([asked.variables.owner, asked.variables.name], ["acme", "relay"]);
      const open = answers.open ?? [];
      if (open instanceof Response) return open;
      // GitHub pages the listing a hundred to a page, the cursor here the place the next one starts.
      const from = Number(asked.variables.after ?? "0");
      const nodes = open.slice(from, from + 100);
      const more = from + 100 < open.length;
      return Response.json({
        data: {
          repository: {
            pullRequests: {
              nodes,
              pageInfo: { hasNextPage: more, endCursor: more ? String(from + 100) : null },
            },
          },
        },
      });
    }
    if (pathname === "/graphql" && sent.method === "POST") {
      const asked: { query: string; variables?: object } = JSON.parse(sent.body);
      // Note that the threads and the deployments are each asked of this one pull request by name and number.
      assert.deepEqual(asked.variables, { owner: "acme", name: "relay", number: NUMBER });
      const answer = asked.query.startsWith("query Deployments")
        ? deploymentsAnswer(answers.deployments, asked.query)
        : answers.graphql;
      if (answer !== undefined) {
        return answer instanceof Response ? answer : Response.json(answer);
      }
    }
    // Note that the bodies are GitHub's to render, so a read of one that does not ask for its rendering is refused.
    const rendered = sent.headers.get("accept") === "application/vnd.github.full+json";
    if ([PULL, COMMENTS, `${PULL}/reviews`].includes(pathname) && !rendered) {
      return Response.json({ message: "Unsupported Media Type" }, { status: 415 });
    }
    if (pathname === PULL && answers.pull !== undefined) return Response.json(answers.pull);
    if (pathname === `${COMMIT}/check-runs`) {
      const runs = answers.checkRuns ?? [];
      return runs instanceof Response ? runs : Response.json({ check_runs: runs });
    }
    if (pathname === `${COMMIT}/status`) return Response.json({ statuses: answers.statuses ?? [] });
    if (pathname === COMMENTS) {
      // GitHub pages a listing a hundred to a page.
      const page = Number(new URL(sent.url).searchParams.get("page") ?? "1");
      return Response.json((answers.comments ?? []).slice((page - 1) * 100, page * 100));
    }
    if (pathname === `${PULL}/reviews`) return Response.json(answers.reviews ?? []);
    return undefined;
  };
}

/** One open pull request as the stack's GraphQL read lists it. */
function openPull(number: number, head: string, base: string) {
  return {
    number,
    title: `Pull request ${number}`,
    url: `https://github.com/acme/relay/pull/${number}`,
    isDraft: false,
    headRefName: head,
    baseRefName: base,
    isCrossRepository: false,
  };
}

/** A coding agent the account started on a plan of the repository, its sandbox on the branch given, its pull request as last read the one numbered. */
const agentPublishing = (userId: string, branch: string, number: number) =>
  Effect.gen(function* () {
    const task = yield* startTask(userId, { name: "Invites", repository: REPOSITORY });
    const started = yield* createCodingAgent(userId, {
      taskId: task.id,
      idempotencyKey: `start-${randomUUID()}`,
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      planSnapshot: "# Invites\n",
      prompt: null,
      repository: REPOSITORY,
    });
    assert.ok(Option.isSome(started));
    const { agent } = started.value;
    yield* updateCodingAgentBranch(userId, agent.id, branch);
    yield* recordCodingAgentPublished(userId, agent.id, {
      number,
      title: `Pull request ${number}`,
      url: `https://github.com/acme/relay/pull/${number}`,
      state: PULL_REQUEST_STATE.OPEN,
      checks: CHECK_SUMMARY.NONE,
      additions: 1,
      deletions: 0,
      changedFiles: 1,
    });
    return agent;
  });

/** A Luke account that signed in with GitHub as the GitHub account given. */
const linkedAccount = (githubId: number) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
    yield* db.insert(account).values({
      id: `account-${randomUUID()}`,
      accountId: String(githubId),
      providerId: GITHUB_PROVIDER_ID,
      userId,
      updatedAt: new Date(0),
    });
    return userId;
  });

/** The pull request itself read off the repository given and named for an agent of the workspace given, its stack read where `stacked` says so; none where GitHub holds no such pull request. */
const pullRequestPartOf = (organizationId: string, stacked = true) =>
  Effect.flatMap(pullRequestOverview(TOKEN, REPOSITORY, NUMBER, stacked), (read) =>
    Option.isNone(read)
      ? Effect.succeed(undefined)
      : namedOverviewPullRequest(
          { organizationId, repository: REPOSITORY, author: CODING_AGENT_AUTHOR.DEVELOPER },
          read.value,
        ),
  );

/** The conversation read off the repository given and named for an agent of the workspace given. */
const conversationPartOf = (organizationId: string) =>
  Effect.flatMap(
    pullRequestConversation(TOKEN, REPOSITORY, { number: NUMBER, url: PAGE }),
    (read) => namedOverviewConversation({ organizationId }, NUMBER, read),
  );

/** GitHub as the script given answers it. */
const answering = (script: RepositoryScript) =>
  Effect.provide(githubReaching([], undefined, undefined, script).layer);

/** The overview's three reads off the repository given, at once, as the tab draws them together; none where GitHub holds no such pull request. */
const overviewOf = (organizationId: string, script: RepositoryScript) =>
  Effect.gen(function* () {
    const [pullRequest, checks, conversation] = yield* Effect.all(
      [
        pullRequestPartOf(organizationId),
        pullRequestChecks(TOKEN, REPOSITORY, NUMBER),
        conversationPartOf(organizationId),
      ],
      { concurrency: "unbounded" },
    );
    return pullRequest === undefined ? undefined : { ...pullRequest, checks, ...conversation };
  }).pipe(answering(script));

it.layer(getTestDB())("a pull request's overview", (it) => {
  it.effect(
    "its description, branches, and mergeability; each check by where it stands; and its comments and reviews in time order, a review that only wraps line comments and an empty comment left out",
    () =>
      Effect.gen(function* () {
        const charles = yield* linkedAccount(CHARLES.id);
        const workspace = yield* openWorkspace(charles);

        const overview = yield* overviewOf(
          workspace,
          repository({
            pull: pull(),
            checkRuns: [
              checkRun("test", "completed", "success"),
              checkRun("lint", "completed", "failure"),
              checkRun("build", "in_progress", null),
              checkRun("deploy", "completed", "skipped"),
            ],
            statuses: [
              {
                context: "vercel",
                state: "pending",
                target_url: "https://vercel.example/deploy",
                created_at: "2026-10-15T09:02:00Z",
                updated_at: "2026-10-15T09:03:00Z",
              },
            ],
            comments: [
              {
                user: CHARLES,
                body: "Why twice before?",
                body_html: '<p dir="auto">Why twice before?</p>',
                created_at: "2026-10-15T10:00:00Z",
                html_url: `${PAGE}#issuecomment-1`,
              },
              {
                user: PRIYA,
                body: "   ",
                body_html: "",
                created_at: "2026-10-15T10:01:00Z",
                html_url: `${PAGE}#issuecomment-2`,
              },
            ],
            reviews: [
              {
                user: PRIYA,
                state: "COMMENTED",
                body: "",
                submitted_at: "2026-10-15T09:30:00Z",
              },
              {
                user: CHARLES,
                state: "APPROVED",
                body: "",
                submitted_at: "2026-10-15T11:00:00Z",
                html_url: `${PAGE}#pullrequestreview-3`,
              },
              {
                user: PRIYA,
                state: "CHANGES_REQUESTED",
                body: "Rename the flag.",
                body_html: '<p dir="auto">Rename the flag.</p>',
                submitted_at: "2026-10-15T09:45:00Z",
                html_url: `${PAGE}#pullrequestreview-4`,
              },
              {
                user: DEVIN,
                state: "COMMENTED",
                body: "",
                submitted_at: "2026-10-15T11:05:00Z",
              },
            ],
          }),
        );

        const asCharles = {
          login: CHARLES.login,
          bot: false,
          avatarUrl: CHARLES.avatar_url,
          userId: charles,
        };
        const asPriya = { login: PRIYA.login, bot: false, avatarUrl: PRIYA.avatar_url };
        assert.ok(overview !== undefined);
        assert.equal(overview.state, PULL_REQUEST_STATE.OPEN);
        assert.equal(overview.html, '<p dir="auto">Sends the invite <strong>once</strong>.</p>');
        assert.equal(overview.base, "main");
        assert.equal(overview.head, "luke/invite-once");
        assert.equal(overview.createdAt, Date.parse("2026-10-15T09:00:00Z"));
        assert.equal(overview.merge, MERGE_STATE.CLEAN);
        assert.deepEqual(overview.author, {
          login: LUKE.login,
          bot: true,
          avatarUrl: LUKE.avatar_url,
        });
        assert.equal(overview.writtenAs, CODING_AGENT_AUTHOR.DEVELOPER);
        assert.deepEqual(
          overview.checks.map(({ name, app, state }) => ({ name, app, state })),
          [
            { name: "lint", app: "GitHub Actions", state: CHECK_STATE.FAILED },
            { name: "build", app: "GitHub Actions", state: CHECK_STATE.PENDING },
            { name: "vercel", app: null, state: CHECK_STATE.PENDING },
            { name: "test", app: "GitHub Actions", state: CHECK_STATE.PASSED },
            { name: "deploy", app: "GitHub Actions", state: CHECK_STATE.SKIPPED },
          ],
        );
        assert.equal(overview.checks[2]?.url, "https://vercel.example/deploy");
        assert.equal(overview.checks[2]?.completedAt, null);
        assert.deepEqual(overview.requested, [asPriya], "the pull request names who it still asks");
        assert.deepEqual(
          overview.reviewers,
          [
            { by: asPriya, state: REVIEW_STATE.CHANGES_REQUESTED },
            { by: asCharles, state: REVIEW_STATE.APPROVED },
            {
              by: {
                login: DEVIN.login,
                bot: true,
                avatarUrl: "https://avatars.githubusercontent.com/in/811515?v=4",
              },
              state: REVIEW_STATE.COMMENTED,
            },
          ],
          "the conversation names where each stands by their reviews, an App's bot by its App's logo",
        );
        assert.deepEqual(overview.conversation, [
          {
            kind: CONVERSATION_ENTRY.REVIEW,
            by: asPriya,
            state: REVIEW_STATE.CHANGES_REQUESTED,
            html: '<p dir="auto">Rename the flag.</p>',
            body: "",
            at: Date.parse("2026-10-15T09:45:00Z"),
            url: `${PAGE}#pullrequestreview-4`,
          },
          {
            kind: CONVERSATION_ENTRY.COMMENT,
            by: asCharles,
            html: '<p dir="auto">Why twice before?</p>',
            body: "",
            at: Date.parse("2026-10-15T10:00:00Z"),
            url: `${PAGE}#issuecomment-1`,
          },
          {
            kind: CONVERSATION_ENTRY.REVIEW,
            by: asCharles,
            state: REVIEW_STATE.APPROVED,
            html: null,
            body: "",
            at: Date.parse("2026-10-15T11:00:00Z"),
            url: `${PAGE}#pullrequestreview-3`,
          },
        ]);
      }),
  );

  it.effect(
    "each check wears its avatar: a run its App's logo, a status the picture GitHub names on it, and none for a picture GitHub serves from no host of its own",
    () =>
      Effect.gen(function* () {
        const checks = yield* pullRequestChecks(TOKEN, REPOSITORY, NUMBER).pipe(
          answering(
            repository({
              checkRuns: [checkRun("lint", "completed", "failure")],
              statuses: [
                {
                  context: "vercel",
                  state: "success",
                  target_url: null,
                  created_at: "2026-10-15T09:02:00Z",
                  updated_at: "2026-10-15T09:03:00Z",
                  avatar_url: "https://avatars.githubusercontent.com/in/8329?v=4",
                },
                {
                  context: "ci/legacy",
                  state: "success",
                  target_url: null,
                  created_at: "2026-10-15T09:02:00Z",
                  updated_at: "2026-10-15T09:03:00Z",
                  avatar_url: "https://ci.example.com/logo.png",
                },
              ],
            }),
          ),
        );
        assert.deepEqual(
          checks.map(({ name, avatarUrl }) => ({ name, avatarUrl })),
          [
            { name: "lint", avatarUrl: "https://avatars.githubusercontent.com/in/15368?v=4" },
            { name: "vercel", avatarUrl: "https://avatars.githubusercontent.com/in/8329?v=4" },
            { name: "ci/legacy", avatarUrl: undefined },
          ],
        );
      }),
  );

  it.effect(
    "a head's deployments: the newest of each environment, newest first, where its newest status left it, its https address alone, and its App's avatar, in one request whatever their number",
    () =>
      Effect.gen(function* () {
        let asked = 0;
        const script = repository({
          deployments: [
            deployment("Preview – luke-web", "SUCCESS", "https://luke-web-git-x.vercel.app"),
            deployment("Preview – docs", "IN_PROGRESS", "https://docs-git-x.vercel.app"),
            deployment("Preview – luke-web", "FAILURE", "https://luke-web-old.vercel.app"),
            deployment("staging", "ERROR", "http://staging.example.com"),
            deployment("review-app", "INACTIVE", null),
            deployment("queued", null, null),
          ],
        });
        const deployments = yield* pullRequestDeployments(TOKEN, REPOSITORY, NUMBER).pipe(
          answering((sent) => {
            asked += 1;
            return script(sent);
          }),
        );
        assert.deepEqual(deployments, [
          {
            environment: "Preview – luke-web",
            state: DEPLOYMENT_STATE.READY,
            url: "https://luke-web-git-x.vercel.app",
            avatarUrl: "https://avatars.githubusercontent.com/in/8329?v=4",
          },
          {
            environment: "Preview – docs",
            state: DEPLOYMENT_STATE.PENDING,
            url: "https://docs-git-x.vercel.app",
            avatarUrl: "https://avatars.githubusercontent.com/in/8329?v=4",
          },
          {
            environment: "staging",
            state: DEPLOYMENT_STATE.FAILED,
            url: null,
            avatarUrl: "https://avatars.githubusercontent.com/in/8329?v=4",
          },
          {
            environment: "review-app",
            state: DEPLOYMENT_STATE.INACTIVE,
            url: null,
            avatarUrl: "https://avatars.githubusercontent.com/in/8329?v=4",
          },
          {
            environment: "queued",
            state: DEPLOYMENT_STATE.PENDING,
            url: null,
            avatarUrl: "https://avatars.githubusercontent.com/in/8329?v=4",
          },
        ]);
        assert.equal(asked, 1, "one request reads every deployment and its newest status");
      }),
  );

  it.effect(
    "an environment deployed again and again on the head leaves room for an older one in the same one request",
    () =>
      Effect.gen(function* () {
        const redeployed = Array.from({ length: 30 }, () =>
          deployment("Preview", "INACTIVE", "https://preview.vercel.app"),
        );
        const deployments = yield* pullRequestDeployments(TOKEN, REPOSITORY, NUMBER).pipe(
          answering(
            repository({
              deployments: [...redeployed, deployment("staging", "SUCCESS", null)],
            }),
          ),
        );
        assert.deepEqual(
          deployments.map(({ environment }) => environment),
          ["Preview", "staging"],
        );
      }),
  );

  it.effect(
    "deployments GitHub refuses to name, or a read that fails, list none rather than failing beside the checks",
    () =>
      Effect.gen(function* () {
        const refused = yield* pullRequestDeployments(TOKEN, REPOSITORY, NUMBER).pipe(
          answering(
            repository({
              deployments: Response.json({
                data: { repository: { pullRequest: null } },
                errors: [{ message: "Resource not accessible by integration" }],
              }),
            }),
          ),
        );
        assert.deepEqual(refused, []);
        const failed = yield* pullRequestDeployments(TOKEN, REPOSITORY, NUMBER).pipe(
          answering(repository({ deployments: Response.json({}, { status: 502 }) })),
        );
        assert.deepEqual(failed, []);
      }),
  );

  it.effect(
    "a merged pull request says when, one GitHub has not yet worked out reads as unknown, a long comment stands whole, and checks the App may not read are listed as none",
    () =>
      Effect.gen(function* () {
        const workspace = yield* openWorkspace(yield* linkedAccount(CHARLES.id));
        const long = `<p>${"x".repeat(40_000)}</p>`;
        const overview = yield* overviewOf(
          workspace,
          repository({
            pull: pull({
              state: "closed",
              merged: true,
              merged_at: "2026-10-16T12:00:00Z",
              mergeable_state: "unknown",
              body: null,
              body_html: null,
            }),
            checkRuns: Response.json({ message: "Resource not accessible" }, { status: 403 }),
            comments: [
              {
                user: CHARLES,
                body: "x".repeat(40_000),
                body_html: long,
                created_at: "2026-10-15T10:00:00Z",
                html_url: `${PAGE}#issuecomment-1`,
              },
            ],
          }),
        );

        assert.ok(overview !== undefined);
        assert.equal(overview.state, PULL_REQUEST_STATE.MERGED);
        assert.equal(overview.mergedAt, Date.parse("2026-10-16T12:00:00Z"));
        assert.equal(overview.merge, MERGE_STATE.UNKNOWN);
        assert.equal(overview.html, "", "no description is drawn as none");
        assert.deepEqual(overview.checks, []);
        assert.equal(
          overview.conversation[0]?.html,
          long,
          "a long comment stands whole, never cut",
        );
        assert.equal(overview.earlier, 0);
      }),
  );

  it.effect("the newest hundred entries are kept, oldest first, and the earlier ones counted", () =>
    Effect.gen(function* () {
      const workspace = yield* openWorkspace(yield* linkedAccount(CHARLES.id));
      const many = yield* overviewOf(
        workspace,
        repository({
          pull: pull(),
          comments: Array.from({ length: OVERVIEW_BOUNDS.MAX_ENTRIES + 5 }, (_, at) => ({
            user: CHARLES,
            body: "hi",
            body_html: "<p>hi</p>",
            created_at: new Date(Date.parse("2026-10-15T10:00:00Z") + at * 60_000).toISOString(),
            html_url: `${PAGE}#issuecomment-${at}`,
          })),
        }),
      );
      assert.ok(many !== undefined);
      assert.equal(many.conversation.length, OVERVIEW_BOUNDS.MAX_ENTRIES);
      assert.equal(many.conversation[0]?.url, `${PAGE}#issuecomment-5`, "the newest are kept");
      assert.equal(many.earlier, 5);
    }),
  );

  it.effect(
    "a head with more checks than the bound keeps the one that failed, a commit status after a full page of passing runs",
    () =>
      Effect.gen(function* () {
        const workspace = yield* openWorkspace(yield* linkedAccount(CHARLES.id));
        const passing = Array.from({ length: OVERVIEW_BOUNDS.MAX_CHECKS }, (_, at) =>
          checkRun(`test ${at}`, "completed", "success"),
        );
        const overview = yield* overviewOf(
          workspace,
          repository({
            pull: pull(),
            checkRuns: passing,
            statuses: [
              {
                context: "vercel",
                state: "failure",
                target_url: null,
                created_at: "2026-10-15T09:02:00Z",
                updated_at: "2026-10-15T09:03:00Z",
              },
            ],
          }),
        );

        assert.ok(overview !== undefined);
        assert.equal(overview.checks.length, OVERVIEW_BOUNDS.MAX_CHECKS);
        assert.deepEqual(
          overview.checks
            .filter((each) => each.state === CHECK_STATE.FAILED)
            .map((each) => each.name),
          ["vercel"],
        );
      }),
  );

  it.effect(
    "a review that only left line comments stands with its threads, each with its file, lines, hunk, standing, comments, and GitHub's id for it; a draft's comment is left out, replies past the bound and threads left on GitHub are counted, and a thread whose review is unlisted stands at its own time",
    () =>
      Effect.gen(function* () {
        const charles = yield* linkedAccount(CHARLES.id);
        const workspace = yield* openWorkspace(charles);
        const hunk =
          "@@ -10,3 +10,4 @@ export function send()\n   const a = 1;\n-  twice();\n+  once();\n+  done();";
        /** A comment as GitHub's GraphQL answers one. */
        /** An author as GitHub's GraphQL names one. */
        interface Author {
          readonly __typename: string;
          readonly login: string;
          readonly avatarUrl: string;
          readonly databaseId: number;
        }
        const comment = (
          author: Author | null,
          at: string,
          id: number,
          review: { databaseId: number | null; state: string } | null,
        ) => ({
          author,
          body: `comment ${id}`,
          bodyHTML: `<p dir="auto">comment ${id}</p>`,
          createdAt: at,
          url: `${PAGE}#discussion_r${id}`,
          diffHunk: hunk,
          pullRequestReview: review,
        });
        const asPriyaNode = {
          __typename: "User",
          login: PRIYA.login,
          avatarUrl: PRIYA.avatar_url,
          databaseId: PRIYA.id,
        };
        const asCharlesNode = {
          __typename: "User",
          login: CHARLES.login,
          avatarUrl: CHARLES.avatar_url,
          databaseId: CHARLES.id,
        };
        const reviewer = {
          __typename: "Bot",
          login: "reviewer",
          avatarUrl: "https://avatars.githubusercontent.com/in/811515?v=4",
          databaseId: 4242,
        };
        const overview = yield* overviewOf(
          workspace,
          repository({
            pull: pull(),
            reviews: [
              {
                id: 5,
                user: PRIYA,
                state: "COMMENTED",
                body: "",
                submitted_at: "2026-10-15T09:30:00Z",
                html_url: `${PAGE}#pullrequestreview-5`,
              },
            ],
            graphql: {
              data: {
                repository: {
                  pullRequest: {
                    reviewThreads: {
                      totalCount: 4,
                      nodes: [
                        {
                          id: "PRRT_invite",
                          path: "src/invite.ts",
                          line: 12,
                          startLine: 11,
                          originalLine: 12,
                          originalStartLine: 11,
                          diffSide: "RIGHT",
                          startDiffSide: "RIGHT",
                          isResolved: false,
                          isOutdated: false,
                          comments: {
                            totalCount: 4,
                            nodes: [
                              comment(asPriyaNode, "2026-10-15T09:29:00Z", 1, {
                                databaseId: 5,
                                state: "COMMENTED",
                              }),
                              comment(asCharlesNode, "2026-10-15T10:30:00Z", 2, {
                                databaseId: 6,
                                state: "COMMENTED",
                              }),
                              comment(asCharlesNode, "2026-10-15T10:40:00Z", 3, {
                                databaseId: 7,
                                state: "PENDING",
                              }),
                            ],
                          },
                        },
                        {
                          id: "PRRT_old",
                          path: "src/old.ts",
                          line: null,
                          startLine: null,
                          originalLine: 3,
                          originalStartLine: null,
                          diffSide: "LEFT",
                          startDiffSide: null,
                          isResolved: true,
                          isOutdated: true,
                          comments: {
                            totalCount: 1,
                            nodes: [
                              comment(reviewer, "2026-10-15T12:00:00Z", 4, {
                                databaseId: 99,
                                state: "COMMENTED",
                              }),
                            ],
                          },
                        },
                        {
                          id: "PRRT_draft",
                          path: "src/draft.ts",
                          line: 1,
                          startLine: null,
                          originalLine: 1,
                          originalStartLine: null,
                          diffSide: "RIGHT",
                          startDiffSide: null,
                          isResolved: false,
                          isOutdated: false,
                          comments: {
                            totalCount: 1,
                            nodes: [
                              comment(asCharlesNode, "2026-10-15T13:00:00Z", 5, {
                                databaseId: 8,
                                state: "PENDING",
                              }),
                            ],
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          }),
        );

        assert.ok(overview !== undefined);
        const asPriya = { login: PRIYA.login, bot: false, avatarUrl: PRIYA.avatar_url };
        const asCharles = {
          login: CHARLES.login,
          bot: false,
          avatarUrl: CHARLES.avatar_url,
          userId: charles,
        };
        assert.deepEqual(overview.conversation, [
          {
            kind: CONVERSATION_ENTRY.REVIEW,
            by: asPriya,
            state: REVIEW_STATE.COMMENTED,
            html: null,
            body: "",
            at: Date.parse("2026-10-15T09:30:00Z"),
            url: `${PAGE}#pullrequestreview-5`,
            threads: [
              {
                path: "src/invite.ts",
                line: 12,
                startLine: 11,
                originalLine: 12,
                originalStartLine: 11,
                side: DIFF_SIDE.RIGHT,
                startSide: DIFF_SIDE.RIGHT,
                diffHunk: hunk,
                resolved: false,
                outdated: false,
                comments: [
                  {
                    by: asPriya,
                    html: '<p dir="auto">comment 1</p>',
                    body: "",
                    at: Date.parse("2026-10-15T09:29:00Z"),
                    url: `${PAGE}#discussion_r1`,
                  },
                  {
                    by: asCharles,
                    html: '<p dir="auto">comment 2</p>',
                    body: "",
                    at: Date.parse("2026-10-15T10:30:00Z"),
                    url: `${PAGE}#discussion_r2`,
                  },
                ],
                more: 1,
                id: "PRRT_invite",
              },
            ],
          },
          {
            kind: CONVERSATION_ENTRY.REVIEW,
            by: {
              login: "reviewer[bot]",
              bot: true,
              avatarUrl: "https://avatars.githubusercontent.com/in/811515?v=4",
            },
            state: REVIEW_STATE.COMMENTED,
            html: null,
            body: "",
            at: Date.parse("2026-10-15T12:00:00Z"),
            url: `${PAGE}#discussion_r4`,
            threads: [
              {
                path: "src/old.ts",
                line: null,
                startLine: null,
                originalLine: 3,
                originalStartLine: null,
                side: DIFF_SIDE.LEFT,
                startSide: null,
                diffHunk: hunk,
                resolved: true,
                outdated: true,
                comments: [
                  {
                    by: {
                      login: "reviewer[bot]",
                      bot: true,
                      avatarUrl: "https://avatars.githubusercontent.com/in/811515?v=4",
                    },
                    html: '<p dir="auto">comment 4</p>',
                    body: "",
                    at: Date.parse("2026-10-15T12:00:00Z"),
                    url: `${PAGE}#discussion_r4`,
                  },
                ],
                more: 0,
                id: "PRRT_old",
              },
            ],
          },
        ]);
        assert.equal(overview.earlier, 1, "the thread GitHub holds past the bound is counted");
      }),
  );

  it.effect(
    "the reactions the description, a comment, a review, and a thread comment wear come with the conversation, in GitHub's order, those given only, each naming who gave it as the conversation names people; a thread comment's, and a comment's the GraphQL read did not reach, counted only",
    () =>
      Effect.gen(function* () {
        const charles = yield* linkedAccount(CHARLES.id);
        const workspace = yield* openWorkspace(charles);
        const asNode = (who: typeof CHARLES) => ({
          __typename: who.type,
          login: who.login.replace("[bot]", ""),
          avatarUrl: who.avatar_url,
          databaseId: who.id,
        });
        /** A reaction as GitHub's GraphQL answers one, naming those given. */
        const group = (content: string, totalCount: number, nodes?: readonly object[]) => ({
          content,
          reactors: nodes === undefined ? { totalCount } : { totalCount, nodes },
        });
        const overview = yield* overviewOf(
          workspace,
          repository({
            pull: pull(),
            comments: [
              {
                id: 11,
                user: PRIYA,
                body: "Ship it.",
                body_html: '<p dir="auto">Ship it.</p>',
                created_at: "2026-10-15T10:00:00Z",
                html_url: `${PAGE}#issuecomment-11`,
              },
              {
                id: 12,
                user: PRIYA,
                body: "Merged it locally.",
                body_html: '<p dir="auto">Merged it locally.</p>',
                created_at: "2026-10-15T12:00:00Z",
                html_url: `${PAGE}#issuecomment-12`,
                reactions: { "+1": 2, "-1": 0, heart: 1, url: "https://api.github.com/x" },
              },
            ],
            reviews: [
              {
                id: 5,
                user: PRIYA,
                state: "APPROVED",
                body: "",
                submitted_at: "2026-10-15T11:00:00Z",
                html_url: `${PAGE}#pullrequestreview-5`,
              },
            ],
            graphql: {
              data: {
                repository: {
                  pullRequest: {
                    reactionGroups: [
                      group("THUMBS_UP", 0, []),
                      group("ROCKET", 1, [asNode(LUKE)]),
                      group("HEART", 2, [asNode(CHARLES), asNode(PRIYA)]),
                      group("SPARKLES", 1, [asNode(PRIYA)]),
                    ],
                    comments: {
                      nodes: [
                        { databaseId: 11, reactionGroups: [group("EYES", 12, [asNode(CHARLES)])] },
                      ],
                    },
                    reviews: { nodes: [{ databaseId: 5, reactionGroups: [] }] },
                    reviewThreads: {
                      totalCount: 1,
                      nodes: [
                        {
                          id: "PRRT_reacted",
                          path: "src/invite.ts",
                          line: 12,
                          startLine: null,
                          originalLine: 12,
                          originalStartLine: null,
                          diffSide: "RIGHT",
                          startDiffSide: null,
                          isResolved: false,
                          isOutdated: false,
                          comments: {
                            totalCount: 1,
                            nodes: [
                              {
                                author: asNode(PRIYA),
                                body: "Why once?",
                                bodyHTML: '<p dir="auto">Why once?</p>',
                                createdAt: "2026-10-15T10:59:00Z",
                                url: `${PAGE}#discussion_r1`,
                                diffHunk: "@@ -1 +1 @@\n-twice();\n+once();",
                                pullRequestReview: { databaseId: 5, state: "APPROVED" },
                                reactionGroups: [group("THUMBS_DOWN", 3), group("LAUGH", 0)],
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          }),
        );

        assert.ok(overview !== undefined);
        const asCharles = {
          login: CHARLES.login,
          bot: false,
          avatarUrl: CHARLES.avatar_url,
          userId: charles,
        };
        const asPriya = { login: PRIYA.login, bot: false, avatarUrl: PRIYA.avatar_url };
        assert.deepEqual(overview.descriptionReactions, [
          { content: REACTION.HEART, count: 2, by: [asCharles, asPriya] },
          {
            content: REACTION.ROCKET,
            count: 1,
            by: [{ login: LUKE.login, bot: true, avatarUrl: LUKE.avatar_url }],
          },
        ]);
        const [said, approved, past] = overview.conversation;
        assert.deepEqual(said?.reactions, [{ content: REACTION.EYES, count: 12, by: [asCharles] }]);
        assert.equal(approved?.state, REVIEW_STATE.APPROVED);
        assert.equal(
          approved !== undefined && "reactions" in approved,
          false,
          "none given, none carried",
        );
        assert.deepEqual(approved?.threads?.[0]?.comments[0]?.reactions, [
          { content: REACTION.THUMBS_DOWN, count: 3 },
        ]);
        assert.deepEqual(
          past?.reactions,
          [
            { content: REACTION.THUMBS_UP, count: 2 },
            { content: REACTION.HEART, count: 1 },
          ],
          "a comment the GraphQL read did not reach is counted by its REST rollup",
        );
      }),
  );

  it.effect(
    "each comment, review, thread comment, and the description carry the GraphQL id a reaction is added by, and the member's own read, on their own token, marks which reactions are theirs",
    () =>
      Effect.gen(function* () {
        const workspace = yield* openWorkspace(yield* linkedAccount(CHARLES.id));
        const member = Redacted.make("ghu_member_fixture");
        const bearers: string[] = [];
        const group = (content: string, totalCount: number) => ({
          content,
          reactors: { totalCount, nodes: [] },
        });
        const viewed = (content: string, viewerHasReacted: boolean) => ({
          content,
          viewerHasReacted,
        });
        const script = repository({
          pull: pull(),
          comments: [
            {
              id: 11,
              node_id: "IC_11",
              user: PRIYA,
              body: "Ship it.",
              body_html: '<p dir="auto">Ship it.</p>',
              created_at: "2026-10-15T10:00:00Z",
              html_url: `${PAGE}#issuecomment-11`,
            },
          ],
          reviews: [
            {
              id: 5,
              node_id: "PRR_5",
              user: PRIYA,
              state: "APPROVED",
              body: "",
              submitted_at: "2026-10-15T11:00:00Z",
              html_url: `${PAGE}#pullrequestreview-5`,
            },
          ],
        });
        const answered: RepositoryScript = (sent) => {
          if (new URL(sent.url).pathname !== "/graphql") return script(sent);
          bearers.push(sent.headers.get("authorization") ?? "");
          const viewer = JSON.parse(sent.body).query.includes("viewerHasReacted");
          return Response.json({
            data: {
              repository: {
                pullRequest: viewer
                  ? {
                      id: "PR_7",
                      reactionGroups: [viewed("HEART", true), viewed("ROCKET", false)],
                      comments: {
                        nodes: [{ id: "IC_11", reactionGroups: [viewed("EYES", false)] }],
                      },
                      reviews: { nodes: [] },
                      reviewThreads: {
                        nodes: [
                          {
                            comments: {
                              nodes: [
                                { id: "PRRC_1", reactionGroups: [viewed("THUMBS_UP", true)] },
                              ],
                            },
                          },
                        ],
                      },
                    }
                  : {
                      id: "PR_7",
                      reactionGroups: [group("HEART", 2), group("ROCKET", 1)],
                      comments: {
                        nodes: [{ databaseId: 11, reactionGroups: [group("EYES", 1)] }],
                      },
                      reviews: { nodes: [] },
                      reviewThreads: {
                        totalCount: 1,
                        nodes: [
                          {
                            id: "PRRT_viewed",
                            path: "src/invite.ts",
                            line: 12,
                            startLine: null,
                            originalLine: 12,
                            originalStartLine: null,
                            diffSide: "RIGHT",
                            startDiffSide: null,
                            isResolved: false,
                            isOutdated: false,
                            comments: {
                              totalCount: 1,
                              nodes: [
                                {
                                  author: null,
                                  body: "Why?",
                                  bodyHTML: '<p dir="auto">Why?</p>',
                                  createdAt: "2026-10-15T10:59:00Z",
                                  url: `${PAGE}#discussion_r1`,
                                  pullRequestReview: { databaseId: 5, state: "APPROVED" },
                                  id: "PRRC_1",
                                  reactionGroups: [
                                    { content: "THUMBS_UP", reactors: { totalCount: 1 } },
                                  ],
                                },
                              ],
                            },
                          },
                        ],
                      },
                    },
              },
            },
          });
        };

        const conversation = yield* Effect.flatMap(
          pullRequestConversation(
            TOKEN,
            REPOSITORY,
            { number: NUMBER, url: PAGE },
            viewerReactionsOf(member, REPOSITORY, NUMBER),
          ),
          (read) => namedOverviewConversation({ organizationId: workspace }, NUMBER, read),
        ).pipe(answering(answered));

        assert.deepEqual(
          [...bearers].sort(),
          [`Bearer ${Redacted.value(TOKEN)}`, `Bearer ${Redacted.value(member)}`].sort(),
          "the App's read on its token, the member's on theirs",
        );
        assert.equal(conversation.descriptionSubject, "PR_7");
        assert.deepEqual(
          conversation.descriptionReactions?.map(({ content, mine }) => [content, mine]),
          [
            [REACTION.HEART, true],
            [REACTION.ROCKET, false],
          ],
        );
        const [comment, approved] = conversation.conversation;
        assert.equal(comment?.subject, "IC_11");
        assert.deepEqual(
          comment?.reactions?.map(({ content, mine }) => [content, mine]),
          [[REACTION.EYES, false]],
        );
        assert.equal(approved?.subject, "PRR_5");
        const threadComment = approved?.threads?.[0]?.comments[0];
        assert.equal(threadComment?.subject, "PRRC_1");
        assert.deepEqual(threadComment?.reactions, [
          { content: REACTION.THUMBS_UP, count: 1, mine: true },
        ]);
      }),
  );

  it.effect(
    "a member's own read that does not answer in time leaves the conversation answered without saying which reactions are theirs",
    () =>
      Effect.gen(function* () {
        const workspace = yield* openWorkspace(yield* linkedAccount(CHARLES.id));
        const script = repository({
          pull: pull(),
          graphql: {
            data: {
              repository: {
                pullRequest: {
                  id: "PR_7",
                  reactionGroups: [{ content: "HEART", reactors: { totalCount: 1, nodes: [] } }],
                  reviewThreads: { totalCount: 0, nodes: [] },
                },
              },
            },
          },
        });
        const reading = yield* Effect.forkChild(
          Effect.flatMap(
            pullRequestConversation(TOKEN, REPOSITORY, { number: NUMBER, url: PAGE }, Effect.never),
            (read) => namedOverviewConversation({ organizationId: workspace }, NUMBER, read),
          ).pipe(answering(script)),
        );
        yield* TestClock.adjust(Duration.seconds(1));
        const conversation = yield* Fiber.join(reading);
        assert.deepEqual(conversation.descriptionReactions, [
          { content: REACTION.HEART, count: 1, by: [] },
        ]);
      }),
  );

  it.effect("review threads GitHub will not answer leave the rest of the overview standing", () =>
    Effect.gen(function* () {
      const workspace = yield* openWorkspace(yield* linkedAccount(CHARLES.id));
      for (const graphql of [
        Response.json({ message: "Resource not accessible" }, { status: 403 }),
        { data: null, errors: [{ message: "Something went wrong" }] },
      ]) {
        const overview = yield* overviewOf(
          workspace,
          repository({
            pull: pull(),
            reviews: [
              {
                id: 5,
                user: PRIYA,
                state: "APPROVED",
                body: "",
                submitted_at: "2026-10-15T09:30:00Z",
                html_url: `${PAGE}#pullrequestreview-5`,
              },
            ],
            graphql,
          }),
        );
        assert.ok(overview !== undefined);
        assert.deepEqual(
          overview.conversation.map((entry) => [entry.state, entry.threads]),
          [[REVIEW_STATE.APPROVED, undefined]],
        );
      }
    }),
  );

  it.effect(
    "each read stands on its own: the pull request's read failing leaves its checks, asked by its head ref, and its conversation read",
    () =>
      Effect.gen(function* () {
        const workspace = yield* openWorkspace(yield* linkedAccount(CHARLES.id));
        const script = repository({
          checkRuns: [checkRun("lint", "completed", "failure")],
          comments: [
            {
              user: CHARLES,
              body: "Looks right.",
              body_html: '<p dir="auto">Looks right.</p>',
              created_at: "2026-10-15T10:00:00Z",
              html_url: `${PAGE}#issuecomment-1`,
            },
          ],
        });
        const failing: RepositoryScript = (sent) =>
          new URL(sent.url).pathname === PULL
            ? Response.json({ message: "Service Unavailable" }, { status: 503 })
            : script(sent);

        const pullRequest = yield* Effect.exit(
          pullRequestPartOf(workspace).pipe(answering(failing)),
        );
        const checks = yield* pullRequestChecks(TOKEN, REPOSITORY, NUMBER).pipe(answering(failing));
        const conversation = yield* conversationPartOf(workspace).pipe(answering(failing));

        assert.equal(pullRequest._tag, "Failure", "the pull request's own read fails");
        assert.deepEqual(
          checks.map(({ name, state }) => ({ name, state })),
          [{ name: "lint", state: CHECK_STATE.FAILED }],
        );
        assert.deepEqual(
          conversation.conversation.map((entry) => entry.url),
          [`${PAGE}#issuecomment-1`],
        );
      }),
  );

  it.effect(
    "its labels, and the stack it stands in, base first, each pull request named by the agent of its workspace that published it",
    () =>
      Effect.gen(function* () {
        const charles = yield* linkedAccount(CHARLES.id);
        const workspace = yield* openWorkspace(charles);
        const below = yield* agentPublishing(charles, "luke/expiry-job", 5);
        // A newer agent on the same branch published another pull request, so it names none of the stack.
        yield* agentPublishing(charles, "luke/expiry-job", 12);
        // An agent of another workspace that published the one above names nothing here.
        const stranger = yield* linkedAccount(PRIYA.id);
        yield* openWorkspace(stranger);
        yield* agentPublishing(stranger, "luke/invite-copy", 9);

        const overview = yield* pullRequestPartOf(workspace).pipe(
          answering(
            repository({
              pull: pull({
                base: { ref: "luke/expiry-job" },
                labels: [
                  { name: "bug", color: "d73a4a" },
                  { name: "good first issue", color: "7057ff" },
                ],
              }),
              open: [
                openPull(9, "luke/invite-copy", "luke/invite-once"),
                openPull(NUMBER, "luke/invite-once", "luke/expiry-job"),
                openPull(5, "luke/expiry-job", "main"),
                openPull(11, "luke/unrelated", "main"),
              ],
            }),
          ),
        );

        assert.ok(overview !== undefined);
        assert.deepEqual(overview.labels, [
          { name: "bug", color: "d73a4a" },
          { name: "good first issue", color: "7057ff" },
        ]);
        assert.deepEqual(
          overview.stack?.map(({ number, agent }) => ({ number, agent })),
          [
            { number: 5, agent: { id: below.id, taskId: below.taskId } },
            { number: NUMBER, agent: undefined },
            { number: 9, agent: undefined },
          ],
        );
      }),
  );

  it.effect(
    "the stack is worked out from every page of the open pull requests, so a second child on a later page unmakes the edge, and a pull request from a fork stands in none",
    () =>
      Effect.gen(function* () {
        const workspace = yield* openWorkspace(yield* linkedAccount(CHARLES.id));
        const filler = Array.from({ length: 120 }, (_, at) =>
          openPull(100 + at, `luke/other-${at}`, "main"),
        );
        const stacked = [
          openPull(9, "luke/invite-copy", "luke/invite-once"),
          openPull(NUMBER, "luke/invite-once", "luke/expiry-job"),
          openPull(5, "luke/expiry-job", "main"),
        ];
        const pulled = pull({ base: { ref: "luke/expiry-job" } });

        const paged = yield* pullRequestPartOf(workspace).pipe(
          answering(
            repository({
              pull: pulled,
              open: [
                ...stacked,
                ...filler,
                openPull(300, "luke/invite-copy-2", "luke/invite-once"),
              ],
            }),
          ),
        );
        const forked = yield* pullRequestPartOf(workspace).pipe(
          answering(
            repository({
              pull: {
                ...pulled,
                head: { ref: "luke/invite-once", sha: "a1b2c3d", repo: { id: 2 } },
                base: { ref: "luke/expiry-job", repo: { id: 1 } },
              },
              open: stacked,
            }),
          ),
        );

        assert.deepEqual(
          paged?.stack?.map((entry) => entry.number),
          [5, NUMBER],
          "#9 is not the one child of luke/invite-once, since #300 on the second page targets it too",
        );
        assert.deepEqual(forked?.stack, []);
      }),
  );

  it.effect(
    "no stack for a pull request no longer open, or where GitHub will not list the open ones, the rest standing",
    () =>
      Effect.gen(function* () {
        const workspace = yield* openWorkspace(yield* linkedAccount(CHARLES.id));
        const open = [openPull(9, "luke/invite-copy", "luke/invite-once")];

        const merged = yield* pullRequestPartOf(workspace).pipe(
          answering(
            repository({
              pull: pull({ state: "closed", merged: true, merged_at: "2026-10-16T09:00:00Z" }),
              open,
            }),
          ),
        );
        const refused = yield* pullRequestPartOf(workspace).pipe(
          answering(
            repository({
              pull: pull(),
              open: Response.json({ message: "Resource not accessible" }, { status: 403 }),
            }),
          ),
        );
        const unasked = yield* pullRequestPartOf(workspace, false).pipe(
          answering(repository({ pull: pull(), open })),
        );

        assert.equal(merged?.state, PULL_REQUEST_STATE.MERGED);
        assert.deepEqual(merged?.stack, []);
        assert.equal(refused?.title, "Send the invite once");
        assert.deepEqual(refused?.stack, []);
        assert.deepEqual(unasked?.stack, []);
      }),
  );

  it.effect("none where the repository no longer holds the pull request", () =>
    Effect.gen(function* () {
      const workspace = yield* openWorkspace(yield* linkedAccount(CHARLES.id));
      assert.equal(yield* overviewOf(workspace, repository({})), undefined);
    }),
  );
});
