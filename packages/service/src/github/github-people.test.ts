import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { account, user } from "@luke/database/schemas/auth";
import { getTestDB, joinWorkspace, openWorkspace } from "@luke/database/testing";
import { CHANGES_BOUNDS, REVIEW_STATE } from "@luke/features/coding-agent-wire";
import { Effect, Redacted } from "effect";
import {
  GITHUB_FIXTURE,
  GITHUB_FIXTURE_BOT,
  githubReaching,
  type RepositoryScript,
} from "../testing/github-app-fake.js";
import { GITHUB_PROVIDER_ID } from "./github-app.js";
import { changesPeople } from "./github-people.js";

/**
 * Who an agent's pull request names, as its changes carry them, read off a
 * scripted GitHub over a real dialect: GitHub's accounts by login and
 * avatar, a reviewer by where they stand, Luke's own App's bot an App's bot
 * like any other, and a teammate named by their Luke account only while they
 * are a member of the agent's workspace. Synthetic accounts throughout.
 */

const REPOSITORY = "acme/relay";
const NUMBER = 7;
const TOKEN = Redacted.make("ghs_fixture_installation_token");
const PULL = `/repos/acme/relay/pulls/${NUMBER}`;

/** GitHub's record of an account, its avatar on GitHub's own host unless said otherwise. */
function githubUser(
  id: number,
  login: string,
  avatar = `https://avatars.githubusercontent.com/u/${id}?v=4`,
) {
  return {
    id,
    login,
    type: login.endsWith("[bot]") ? "Bot" : "User",
    avatar_url: avatar,
  };
}

/** An account as GitHub records it. */
type GitHubRecord = ReturnType<typeof githubUser>;

const CHARLES = githubUser(1001, "charlespan");
const PRIYA = githubUser(1002, "priyan");
const STRANGER = githubUser(1003, "octostranger", "https://evil.example.com/a.png");
/** An App's bot GitHub draws by its App's logo, at its App's address. */
const DEVIN_AVATAR = "https://avatars.githubusercontent.com/in/811515?v=4";
const DEVIN = githubUser(1004, "devin-ai-integration[bot]", DEVIN_AVATAR);
const PAIR = githubUser(1005, "pairdev");
const RENOVATE = githubUser(
  1006,
  "renovate[bot]",
  "https://avatars.githubusercontent.com/in/2740?v=4",
);
/** Luke's own App's bot, whose logo GitHub serves at the fixture App's id. */
const LUKE_AVATAR = `https://avatars.githubusercontent.com/in/${GITHUB_FIXTURE.APP_ID}?v=4`;
const LUKE = githubUser(GITHUB_FIXTURE_BOT.id, GITHUB_FIXTURE_BOT.login, LUKE_AVATAR);

/** A review as GitHub lists one. */
function review(by: GitHubRecord, state: string, body: string, at: string) {
  return { user: by, state, body, submitted_at: at };
}

/** A repository answering the pull request's own reads as given, and not found for the rest. */
function repository(answers: {
  readonly pull?: object;
  readonly reviews?: readonly object[] | Response;
  readonly commits?: readonly object[];
}): RepositoryScript {
  return (sent) => {
    const { pathname } = new URL(sent.url);
    if (pathname === PULL && answers.pull !== undefined) return Response.json(answers.pull);
    if (pathname === `${PULL}/reviews` && answers.reviews !== undefined) {
      return answers.reviews instanceof Response ? answers.reviews : Response.json(answers.reviews);
    }
    if (pathname === `${PULL}/commits` && answers.commits !== undefined) {
      return Response.json(answers.commits);
    }
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

/** Who the pull request names, read off the repository given for an agent of the workspace given. */
const peopleOf = (organizationId: string, script: RepositoryScript) =>
  changesPeople(TOKEN, { repository: REPOSITORY, organizationId }, NUMBER).pipe(
    Effect.provide(githubReaching([], undefined, undefined, script).layer),
  );

it.layer(getTestDB())("who a pull request names", (it) => {
  it.effect(
    "its opener, each reviewer by their newest decision and one asked again as asked, its commit authors once each, and its reviews that said something; Luke's bot and another App's are bots, and only a member of the agent's workspace is named by their Luke account",
    () =>
      Effect.gen(function* () {
        const charles = yield* linkedAccount(CHARLES.id);
        const priya = yield* linkedAccount(PRIYA.id);
        const workspace = yield* openWorkspace(charles);
        // Priya signed in with GitHub too, but in a workspace of her own.
        yield* openWorkspace(priya);

        const people = yield* peopleOf(
          workspace,
          repository({
            pull: { user: LUKE, requested_reviewers: [PRIYA] },
            reviews: [
              review(CHARLES, "CHANGES_REQUESTED", "Rename the flag.", "2026-10-15T10:00:00Z"),
              review(PRIYA, "APPROVED", "", "2026-10-15T10:05:00Z"),
              review(CHARLES, "APPROVED", "Looks good   now.\n\nShip it.", "2026-10-15T11:00:00Z"),
              review(CHARLES, "COMMENTED", "", "2026-10-15T11:10:00Z"),
              review(DEVIN, "COMMENTED", "Found 1 potential issue.", "2026-10-15T11:20:00Z"),
              review(STRANGER, "PENDING", "A draft nobody sees.", "2026-10-15T11:30:00Z"),
            ],
            commits: [{ author: LUKE }, { author: null }, { author: CHARLES }, { author: LUKE }],
          }),
        );

        const luke = {
          login: LUKE.login,
          bot: true,
          avatarUrl: LUKE.avatar_url,
        };
        const asCharles = {
          login: CHARLES.login,
          bot: false,
          avatarUrl: CHARLES.avatar_url,
          userId: charles,
        };
        const asPriya = { login: PRIYA.login, bot: false, avatarUrl: PRIYA.avatar_url };
        // Note that a bot reviewer stands by its App's logo, the address GitHub gives it.
        const devin = { login: DEVIN.login, bot: true, avatarUrl: DEVIN_AVATAR };
        assert.deepEqual(people.author, luke);
        assert.deepEqual(people.reviewers, [
          { by: asCharles, state: REVIEW_STATE.APPROVED },
          { by: asPriya, state: REVIEW_STATE.REQUESTED },
          { by: devin, state: REVIEW_STATE.COMMENTED },
        ]);
        assert.deepEqual(people.commitAuthors, [luke, asCharles]);
        assert.deepEqual(people.comments, [
          {
            by: asCharles,
            state: REVIEW_STATE.CHANGES_REQUESTED,
            excerpt: "Rename the flag.",
            at: Date.parse("2026-10-15T10:00:00Z"),
          },
          {
            by: asCharles,
            state: REVIEW_STATE.APPROVED,
            excerpt: "Looks good now. Ship it.",
            at: Date.parse("2026-10-15T11:00:00Z"),
          },
          {
            by: devin,
            state: REVIEW_STATE.COMMENTED,
            excerpt: "Found 1 potential issue.",
            at: Date.parse("2026-10-15T11:20:00Z"),
          },
        ]);

        // Priya joins the workspace, and is named by her Luke account from then on.
        yield* joinWorkspace(workspace, priya);
        const joined = yield* peopleOf(
          workspace,
          repository({ pull: { user: PRIYA, requested_reviewers: [] }, reviews: [], commits: [] }),
        );
        assert.equal(joined.author?.userId, priya);
      }),
  );

  it.effect(
    "every page of reviews and commits is read, so a reviewer stands by their newest decision and a later commit's author is named, and only the newest comments are kept past the bound",
    () =>
      Effect.gen(function* () {
        const workspace = yield* openWorkspace(yield* linkedAccount(CHARLES.id));
        const early = Array.from({ length: 100 }, (_, at) =>
          review(DEVIN, "COMMENTED", `Note ${at}.`, "2026-10-15T09:00:00Z"),
        );
        early[0] = review(CHARLES, "CHANGES_REQUESTED", "Rename the flag.", "2026-10-15T08:00:00Z");
        const pages = (url: string) => Number(new URL(url).searchParams.get("page") ?? 1);
        const people = yield* peopleOf(workspace, (sent) => {
          const { pathname } = new URL(sent.url);
          if (pathname === PULL) return Response.json({ user: LUKE });
          if (pathname === `${PULL}/reviews`) {
            return Response.json(
              pages(sent.url) === 1
                ? early
                : [review(CHARLES, "APPROVED", "Ship it.", "2026-10-15T10:00:00Z")],
            );
          }
          if (pathname === `${PULL}/commits`) {
            return Response.json(
              pages(sent.url) === 1
                ? Array.from({ length: 100 }, () => ({ author: LUKE }))
                : [{ author: PRIYA }],
            );
          }
          return undefined;
        });

        assert.equal(
          people.reviewers?.find((reviewer) => reviewer.by.login === CHARLES.login)?.state,
          REVIEW_STATE.APPROVED,
        );
        assert.deepEqual(
          people.commitAuthors?.map((author) => author.login),
          [LUKE.login, PRIYA.login],
        );
        assert.equal(people.comments?.length, CHANGES_BOUNDS.MAX_PEOPLE);
        assert.equal(people.comments?.at(-1)?.excerpt, "Ship it.");
      }),
  );

  it.effect(
    "a pull request reviewed past many pages is read to its newest review, which is where its reviewer stands and the comment it ends on",
    () =>
      Effect.gen(function* () {
        const workspace = yield* openWorkspace(yield* linkedAccount(CHARLES.id));
        const NEWEST_PAGE = 7;
        const people = yield* peopleOf(workspace, (sent) => {
          const { pathname, searchParams } = new URL(sent.url);
          const page = Number(searchParams.get("page") ?? 1);
          if (pathname === PULL) return Response.json({ user: LUKE });
          if (pathname === `${PULL}/commits`) return Response.json([]);
          if (pathname !== `${PULL}/reviews`) return undefined;
          if (page === NEWEST_PAGE) {
            return Response.json([
              review(CHARLES, "CHANGES_REQUESTED", "Not yet.", "2026-10-16T09:00:00Z"),
            ]);
          }
          const notes = Array.from({ length: 100 }, (_, at) =>
            review(DEVIN, "COMMENTED", `Note ${page}.${at}.`, "2026-10-15T09:00:00Z"),
          );
          if (page === 1)
            notes[0] = review(CHARLES, "APPROVED", "Ship it.", "2026-10-15T08:00:00Z");
          return Response.json(notes);
        });

        assert.equal(
          people.reviewers?.find((reviewer) => reviewer.by.login === CHARLES.login)?.state,
          REVIEW_STATE.CHANGES_REQUESTED,
        );
        assert.equal(people.comments?.at(-1)?.excerpt, "Not yet.");
      }),
  );

  it.effect(
    "a pull request a developer opened with Luke's agent names Luke's bot among the commit authors, as the co-author its commits' trailers name by its noreply address, by its App's logo; another App's bot co-authoring there by the logo the read gives it elsewhere, and by its robot where the read gives none; a person co-authoring there by the avatar GitHub serves for their id; and a co-author at any other address, or a trailer-shaped line in a commit's body, is left out",
    () =>
      Effect.gen(function* () {
        const charles = yield* linkedAccount(CHARLES.id);
        const workspace = yield* openWorkspace(charles);
        const coAuthor = `Co-authored-by: ${LUKE.login} <${LUKE.id}+${LUKE.login}@users.noreply.github.com>`;

        const people = yield* peopleOf(
          workspace,
          repository({
            pull: { user: CHARLES, requested_reviewers: [] },
            reviews: [
              review(DEVIN, "COMMENTED", "Found 1 potential issue.", "2026-10-15T10:00:00Z"),
            ],
            commits: [
              { author: CHARLES, commit: { message: `Add invitations\n\n${coAuthor}` } },
              {
                author: CHARLES,
                commit: { message: "Rename the flag\n\nCo-authored-by: Priya <priya@example.com>" },
              },
              {
                author: CHARLES,
                commit: {
                  message: `Quote the trailer\n\nThe agent ends each commit on\n${coAuthor.replace(String(LUKE.id), "4242")}\nas its instructions say.\n\nSigned-off-by: Charles <charles@example.com>`,
                },
              },
              { author: CHARLES, commit: { message: `Fix the test\n\n${coAuthor}\n` } },
              {
                author: CHARLES,
                commit: {
                  message: `Pair on the copy\n\nCo-authored-by: ${PAIR.login} <${PAIR.id}+${PAIR.login}@users.noreply.github.com>`,
                },
              },
              {
                author: CHARLES,
                commit: {
                  message: `Apply the review\n\nCo-authored-by: Devin <${DEVIN.id}+${DEVIN.login}@users.noreply.github.com>\nCo-authored-by: Renovate <${RENOVATE.id}+${RENOVATE.login}@users.noreply.github.com>`,
                },
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
        assert.deepEqual(people.author, asCharles);
        assert.deepEqual(people.commitAuthors, [
          asCharles,
          { login: LUKE.login, bot: true, avatarUrl: LUKE_AVATAR },
          {
            login: PAIR.login,
            bot: false,
            avatarUrl: "https://avatars.githubusercontent.com/u/1005?v=4",
          },
          { login: DEVIN.login, bot: true, avatarUrl: DEVIN_AVATAR },
          { login: RENOVATE.login, bot: true },
        ]);
      }),
  );

  it.effect(
    "an avatar off GitHub's own avatar host is left out, and a review's words are cut at the bound",
    () =>
      Effect.gen(function* () {
        const workspace = yield* openWorkspace(yield* linkedAccount(CHARLES.id));
        const people = yield* peopleOf(
          workspace,
          repository({
            pull: { user: STRANGER },
            reviews: [review(STRANGER, "COMMENTED", "x".repeat(1_000), "2026-10-15T10:00:00Z")],
            commits: [],
          }),
        );

        assert.deepEqual(people.author, { login: STRANGER.login, bot: false });
        assert.equal(people.comments?.[0]?.excerpt.length, CHANGES_BOUNDS.MAX_EXCERPT_CHARS);
      }),
  );

  it.effect(
    "a read GitHub does not answer leaves the people out, and a pull request the repository no longer holds names nobody",
    () =>
      Effect.gen(function* () {
        const workspace = yield* openWorkspace(yield* linkedAccount(CHARLES.id));
        const unanswered = yield* peopleOf(
          workspace,
          repository({
            pull: { user: CHARLES },
            reviews: Response.json({ message: "Service Unavailable" }, { status: 503 }),
            commits: [],
          }),
        );
        assert.deepEqual(unanswered, {});

        const gone = yield* peopleOf(workspace, repository({}));
        assert.deepEqual(gone, { reviewers: [], commitAuthors: [], comments: [] });
      }),
  );
});
