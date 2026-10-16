import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { account, user } from "@luke/database/schemas/auth";
import { getTestDB, openWorkspace } from "@luke/database/testing";
import {
  CHECK_STATE,
  CODING_AGENT_AUTHOR,
  CONVERSATION_ENTRY,
  MERGE_STATE,
  OVERVIEW_BOUNDS,
  PULL_REQUEST_STATE,
  REVIEW_STATE,
} from "@luke/features/coding-agent-wire";
import { Effect, Option, Redacted } from "effect";
import {
  GITHUB_FIXTURE_BOT,
  githubReaching,
  type RepositoryScript,
} from "../testing/github-app-fake.js";
import { GITHUB_PROVIDER_ID } from "./github-app.js";
import { namedOverview } from "./github-people.js";
import { pullRequestOverview } from "./pull-requests.js";

/**
 * An agent's pull request as its Pull request tab draws it, read off a
 * scripted GitHub over a real dialect: its description, branches, and
 * mergeability; every check on its head, a check run or a commit status,
 * by where it stands; and its comments and reviews as one conversation in
 * time order, its people named as an agent's changes name them. Synthetic
 * accounts throughout.
 */

const REPOSITORY = "acme/relay";
const NUMBER = 7;
const HEAD_SHA = "a1b2c3d";
const TOKEN = Redacted.make("ghs_fixture_installation_token");
const PULL = `/repos/acme/relay/pulls/${NUMBER}`;
const COMMENTS = `/repos/acme/relay/issues/${NUMBER}/comments`;
const COMMIT = `/repos/acme/relay/commits/${HEAD_SHA}`;
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

/** What a test changes of the pull request GitHub answers. */
interface PullOverrides {
  readonly state?: string;
  readonly merged?: boolean;
  readonly merged_at?: string | null;
  readonly mergeable_state?: string;
  readonly body?: string | null;
  readonly body_html?: string | null;
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
    head: { ref: "luke/invite-once", sha: HEAD_SHA },
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
    app: { name: "GitHub Actions" },
  };
}

/** A repository answering the overview's reads as given, and not found for the rest. */
function repository(answers: {
  readonly pull?: object;
  readonly checkRuns?: readonly object[] | Response;
  readonly statuses?: readonly object[];
  readonly comments?: readonly object[];
  readonly reviews?: readonly object[];
}): RepositoryScript {
  return (sent) => {
    const { pathname } = new URL(sent.url);
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

/** The overview read off the repository given and named for an agent of the workspace given; none where GitHub holds no such pull request. */
const overviewOf = (organizationId: string, script: RepositoryScript) =>
  Effect.gen(function* () {
    const read = yield* pullRequestOverview(TOKEN, REPOSITORY, NUMBER);
    if (Option.isNone(read)) return undefined;
    return yield* namedOverview(
      TOKEN,
      { organizationId, author: CODING_AGENT_AUTHOR.DEVELOPER },
      read.value,
    );
  }).pipe(Effect.provide(githubReaching([], undefined, undefined, script).layer));

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
        assert.equal(overview.cut, false);
        assert.equal(overview.base, "main");
        assert.equal(overview.head, "luke/invite-once");
        assert.equal(overview.createdAt, Date.parse("2026-10-15T09:00:00Z"));
        assert.equal(overview.merge, MERGE_STATE.CLEAN);
        assert.deepEqual(overview.author, {
          login: LUKE.login,
          bot: true,
          avatarUrl: LUKE.avatar_url,
          luke: true,
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
        assert.deepEqual(overview.reviewers, [
          { by: asPriya, state: REVIEW_STATE.REQUESTED },
          { by: asCharles, state: REVIEW_STATE.APPROVED },
        ]);
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
        assert.deepEqual([overview.html, overview.cut], ["", false], "no description is no cut");
        assert.deepEqual(overview.checks, []);
        assert.equal(
          overview.conversation[0]?.html,
          long,
          "a long comment stands whole, never cut",
        );
        assert.equal(overview.earlier, 0);
      }),
  );

  it.effect(
    "the newest entries are kept whole while they fit the room the description leaves, at most a hundred, and the earlier ones are counted",
    () =>
      Effect.gen(function* () {
        const workspace = yield* openWorkspace(yield* linkedAccount(CHARLES.id));
        const comment = (at: number, html: string) => ({
          user: CHARLES,
          body: "words",
          body_html: html,
          created_at: new Date(Date.parse("2026-10-15T10:00:00Z") + at * 60_000).toISOString(),
          html_url: `${PAGE}#issuecomment-${at}`,
        });
        // The description leaves room for the two newest comments and not the one before them.
        const third = OVERVIEW_BOUNDS.MAX_WORDS_CHARS / 3;
        const filled = yield* overviewOf(
          workspace,
          repository({
            pull: pull({ body_html: "d".repeat(third) }),
            comments: [
              comment(1, "small"),
              comment(2, "a".repeat(third + 100)),
              comment(3, "small"),
              comment(4, "b".repeat(third - 10)),
            ],
          }),
        );
        assert.ok(filled !== undefined);
        assert.equal(filled.html.length, third, "the description stands whole");
        assert.deepEqual(
          filled.conversation.map((entry) => entry.url),
          [`${PAGE}#issuecomment-3`, `${PAGE}#issuecomment-4`],
          "an entry that does not fit ends the run, so a smaller one before it is not drawn alone",
        );
        assert.equal(filled.earlier, 2);

        const many = yield* overviewOf(
          workspace,
          repository({
            pull: pull(),
            comments: Array.from({ length: OVERVIEW_BOUNDS.MAX_ENTRIES + 5 }, (_, at) =>
              comment(at, "<p>hi</p>"),
            ),
          }),
        );
        assert.ok(many !== undefined);
        assert.equal(many.conversation.length, OVERVIEW_BOUNDS.MAX_ENTRIES);
        assert.equal(many.conversation[0]?.url, `${PAGE}#issuecomment-5`, "the newest are kept");
        assert.equal(many.earlier, 5);

        const huge = yield* overviewOf(
          workspace,
          repository({
            pull: pull({ body_html: "d".repeat(OVERVIEW_BOUNDS.MAX_WORDS_CHARS + 1) }),
          }),
        );
        assert.deepEqual(
          [huge?.html, huge?.cut],
          ["", true],
          "a description alone past the bound says so",
        );
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

  it.effect("none where the repository no longer holds the pull request", () =>
    Effect.gen(function* () {
      const workspace = yield* openWorkspace(yield* linkedAccount(CHARLES.id));
      assert.equal(yield* overviewOf(workspace, repository({})), undefined);
    }),
  );
});
