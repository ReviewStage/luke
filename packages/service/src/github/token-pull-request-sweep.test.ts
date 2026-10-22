import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  createCodingAgent,
  recordCodingAgentPublished,
  updateCodingAgentBranch,
} from "@luke/database/models/coding-agent-store";
import { claimRuntimeSession } from "@luke/database/models/recorded-session";
import { turns } from "@luke/database/schemas/storage";
import { getTestDB, startTask } from "@luke/database/testing";
import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { TURN_ORIGIN, TURN_STATUS } from "@luke/wire";
import { Effect, Option, Result, Stream } from "effect";
import {
  type AgentSessions,
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
} from "../agents/brain-host/eve-sessions.js";
import {
  GITHUB_APP_WITH_TOKENS,
  GITHUB_FIXTURE_MEMBER,
  GITHUB_FIXTURE_TOKEN_RING,
  githubReaching,
  memberRepositoryJson,
  openTokenMember,
  type SentToGitHub,
} from "../testing/github-app-fake.js";
import { GITHUB_TOKEN_ABSENCE, openMemberGitHubToken } from "./github-token.js";
import { sweepTokenPullRequests } from "./token-pull-request-sweep.js";

/**
 * The poll of a token agent's pull request, which no webhook reaches: a new
 * review is told to its agent once, a pull request GitHub answers 304 to
 * tells nothing, a comment by the member's login made while the agent's
 * turn ran is the agent's own and tells nothing, a failed check is told,
 * and a token GitHub refuses is marked invalid. Over a real dialect, eve a
 * fake at the client's boundary and GitHub a script that answers each read
 * with an ETag. The claim is the deployment's, so each test polls a pull
 * request numbered for it alone. Synthetic throughout.
 */

const RELAY = { owner: "Acme", name: "Relay" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;
const MADE_AT = Date.parse("2026-10-20T12:00:00Z");
const HEAD = "0123abcd0123abcd0123abcd0123abcd0123abcd";
const MINUTE = 60_000;

let pullRequestsOpened = 40;

/** What the scripted GitHub holds on one pull request, which a test changes between sweeps. */
interface PullRequestOnGitHub {
  readonly number: number;
  readonly ref: string;
  reviews: object[];
  comments: object[];
  checkRuns: object[];
  statuses: object[];
}

/** eve's coding-agent service as the deployment reaches it for each account, writing down every message sent. */
function fakeEve() {
  const sent: EveMessage[] = [];
  const sessions: AgentSessions = {
    open: () =>
      Effect.succeed({ outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: `wrun_${randomUUID()}` }),
    send: (sessionId, message) =>
      Effect.sync(() => {
        sent.push(message);
        return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId, deliveryId: randomUUID() } as const;
      }),
    cancel: () => Effect.succeed({ outcome: EVE_CANCEL_OUTCOME.ACCEPTED }),
    reset: () => Effect.succeed({ outcome: EVE_RESET_OUTCOME.RESET }),
    stream: () => Stream.empty,
  };
  return { sent, eveFor: () => Effect.succeed(sessions) };
}

/** The words of a message sent to eve. */
function sentText(message: EveMessage["message"] | undefined): string {
  if (message === undefined || !Array.isArray(message)) return message ?? "";
  return message.map((part) => (part.type === "text" ? part.text : "")).join("\n");
}

/**
 * A GitHub where the member's token may push to the repository, answering
 * the pull request's reads from what it holds now, each with an ETag of its
 * body and a 304 where the request names that ETag; the statuses it
 * answered the poll's reads with are written down.
 */
function githubHolding(pull: PullRequestOnGitHub) {
  const answered: { readonly path: string; readonly status: number }[] = [];
  const repo = `/repos/${RELAY_FULL_NAME}`;
  const pulls = `${repo}/pulls/${pull.number}`;
  const conditional = (sent: SentToGitHub, path: string, json: string) => {
    const etag = `"${createHash("sha256").update(json).digest("hex")}"`;
    const status = sent.headers.get("if-none-match") === etag ? 304 : 200;
    answered.push({ path, status });
    return status === 304
      ? new Response(null, { status, headers: { etag } })
      : new Response(json, { headers: { etag, "content-type": "application/json" } });
  };
  const record = {
    number: pull.number,
    title: "Expire invitations",
    html_url: `https://github.com/${RELAY_FULL_NAME}/pull/${pull.number}`,
    state: "open",
    draft: false,
    merged: false,
    additions: 1,
    deletions: 0,
    changed_files: 1,
    head: { ref: pull.ref, sha: HEAD },
  };
  const script = (sent: SentToGitHub): Response | undefined => {
    if (sent.headers.get("authorization") !== `Bearer ${GITHUB_FIXTURE_MEMBER.TOKEN}`) {
      return undefined;
    }
    const { pathname, searchParams } = new URL(sent.url);
    if (pathname === repo) return Response.json(memberRepositoryJson(RELAY, true));
    if (pathname === `${repo}/pulls` && searchParams.get("head") === `${RELAY.owner}:${pull.ref}`) {
      return Response.json([{ number: pull.number }]);
    }
    const reads = new Map<string, string>([
      [pulls, JSON.stringify(record)],
      [`${pulls}/reviews`, JSON.stringify(pull.reviews)],
      [`${repo}/issues/${pull.number}/comments`, JSON.stringify(pull.comments)],
      [`${repo}/commits/${HEAD}/check-runs`, JSON.stringify({ check_runs: pull.checkRuns })],
      [`${repo}/commits/${HEAD}/status`, JSON.stringify({ statuses: pull.statuses })],
    ]);
    const read = reads.get(pathname);
    if (read !== undefined) return conditional(sent, pathname, read);
    if (pathname === `${pulls}/files` || pathname.startsWith(`${pulls}/reviews/`)) {
      return Response.json([]);
    }
    return undefined;
  };
  const reaching = githubReaching([], GITHUB_APP_WITH_TOKENS, {}, script);
  return { layer: reaching.layer, answered, sent: reaching.sent };
}

/** A member's agent on their own token, on a branch of its own with an open pull request numbered for the test, its session opened, its last turn run over the window given, or still running where it has no end; in the repository given, the relay's where none is. */
const openTokenAgent = (
  turn: { readonly startedAt: number; readonly settledAt?: number },
  repository: string | null = RELAY_FULL_NAME,
) =>
  Effect.gen(function* () {
    const owner = yield* openTokenMember();
    const task = yield* startTask(owner, {
      name: "Invitations",
      ...(repository === null ? undefined : { repository }),
    });
    const started = yield* createCodingAgent(owner, {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      planSnapshot: "# Invitations\n",
      prompt: null,
      repository,
      githubAccess: GITHUB_ACCESS.TOKEN,
    });
    const { agent } = Option.getOrThrow(started);
    const ref = `luke/invitations-${randomUUID()}`;
    const number = ++pullRequestsOpened;
    yield* updateCodingAgentBranch(owner, agent.id, ref);
    yield* recordCodingAgentPublished(owner, agent.id, {
      number,
      title: "Expire invitations",
      url: `https://github.com/${RELAY_FULL_NAME}/pull/${number}`,
      state: PULL_REQUEST_STATE.OPEN,
      checks: CHECK_SUMMARY.PENDING,
      additions: 1,
      deletions: 0,
      changedFiles: 1,
    });
    yield* claimRuntimeSession(
      { userId: owner, conversationId: agent.conversationId },
      `wrun_${randomUUID()}`,
      new Date(MADE_AT - 3_600_000),
    );
    const db = yield* Database;
    yield* db.insert(turns).values({
      userId: owner,
      conversationId: agent.conversationId,
      origin: TURN_ORIGIN.TYPED,
      status: turn.settledAt === undefined ? TURN_STATUS.RUNNING : TURN_STATUS.SETTLED,
      queuedAt: new Date(turn.startedAt),
      startedAt: new Date(turn.startedAt),
      settledAt: turn.settledAt === undefined ? null : new Date(turn.settledAt),
    });
    const pull: PullRequestOnGitHub = {
      number,
      ref,
      reviews: [],
      comments: [],
      checkRuns: [],
      statuses: [],
    };
    return { owner, pull };
  });

/** One sweep at the instant given, over the GitHub and eve given. */
const sweepAt = (
  at: number,
  github: Pick<ReturnType<typeof githubHolding>, "layer">,
  eve: ReturnType<typeof fakeEve>,
) =>
  sweepTokenPullRequests(eve.eveFor, GITHUB_FIXTURE_TOKEN_RING, new Date(at)).pipe(
    Effect.provide(github.layer),
  );

/** A review GitHub lists, by the login given. */
function review(id: number, login: string, body: string) {
  return {
    id,
    user: { login },
    state: "CHANGES_REQUESTED",
    body,
    html_url: `https://github.com/${RELAY_FULL_NAME}/pull/1#pullrequestreview-${id}`,
    submitted_at: new Date(MADE_AT).toISOString(),
  };
}

/** A conversation comment GitHub lists, by the login given, made at the instant given. */
function comment(id: number, login: string, body: string, at: number) {
  return {
    id,
    user: { login },
    body,
    html_url: `https://github.com/${RELAY_FULL_NAME}/pull/1#issuecomment-${id}`,
    created_at: new Date(at).toISOString(),
  };
}

/** An agent idle since ten minutes before the instant everything below is made at. */
const IDLE = { startedAt: MADE_AT - 20 * MINUTE, settledAt: MADE_AT - 10 * MINUTE };

it.layer(getTestDB())("the poll of a token agent's pull request", (it) => {
  it.effect("a new review wakes the agent once, however often its listing is read again", () =>
    Effect.gen(function* () {
      const eve = fakeEve();
      const { pull } = yield* openTokenAgent(IDLE);
      const github = githubHolding(pull);
      pull.reviews = [review(9, "octocat", "Cover the expired invitation too.")];

      yield* sweepAt(MADE_AT + MINUTE, github, eve);
      pull.reviews = [...pull.reviews, review(10, "hubot", "And the revoked seat.")];
      yield* sweepAt(MADE_AT + 2 * MINUTE, github, eve);

      const texts = eve.sent.map((sent) => sentText(sent.message));
      assert.equal(texts.length, 2);
      assert.ok(texts[0]?.startsWith("@octocat requested changes on your pull request"));
      assert.ok(texts[0]?.includes("Cover the expired invitation too."));
      assert.ok(texts[1]?.startsWith("@hubot requested changes on your pull request"));
    }),
  );

  it.effect(
    "a pull request unchanged since the last poll is read conditionally, answered 304, and tells nothing",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { pull } = yield* openTokenAgent(IDLE);
        const github = githubHolding(pull);

        yield* sweepAt(MADE_AT + MINUTE, github, eve);
        const first = github.answered.length;
        yield* sweepAt(MADE_AT + 2 * MINUTE, github, eve);

        const again = github.answered.slice(first);
        assert.equal(
          again.length,
          5,
          "the pull request, its reviews, comments, check runs, and status",
        );
        assert.deepEqual(
          again.map((answer) => answer.status),
          [304, 304, 304, 304, 304],
        );
        assert.equal(eve.sent.length, 0);
      }),
  );

  it.effect(
    "a comment by the member's login made while the agent's turn ran is the agent's own and wakes nothing, and one made after wakes it",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { pull } = yield* openTokenAgent(IDLE);
        const github = githubHolding(pull);
        pull.comments = [
          comment(7, GITHUB_FIXTURE_MEMBER.LOGIN, "Pushed the fix.", MADE_AT - 15 * MINUTE),
          comment(8, GITHUB_FIXTURE_MEMBER.LOGIN, "Also cover the revoked seat.", MADE_AT),
        ];

        yield* sweepAt(MADE_AT + MINUTE, github, eve);

        const texts = eve.sent.map((sent) => sentText(sent.message));
        assert.equal(texts.length, 1);
        assert.ok(texts[0]?.includes("Also cover the revoked seat."));
        assert.ok(!texts[0]?.includes("Pushed the fix."));
      }),
  );

  it.effect(
    "an agent with no repository is polled for nothing: GitHub is asked nothing and the agent told nothing",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { pull } = yield* openTokenAgent(IDLE, null);
        const github = githubHolding(pull);
        pull.reviews = [review(11, "octocat", "Cover the expired invitation too.")];

        yield* sweepAt(MADE_AT + MINUTE, github, eve);

        assert.deepEqual(
          github.sent.filter((sent) => sent.url.includes(`/pulls/${pull.number}`)),
          [],
        );
        assert.deepEqual(eve.sent, []);
      }),
  );

  it.effect("a check that failed after the agent's turn ended wakes it once", () =>
    Effect.gen(function* () {
      const eve = fakeEve();
      const { pull } = yield* openTokenAgent(IDLE);
      const github = githubHolding(pull);
      pull.checkRuns = [
        {
          status: "completed",
          conclusion: "failure",
          completed_at: new Date(MADE_AT).toISOString(),
          app: { slug: "github-actions" },
        },
      ];

      yield* sweepAt(MADE_AT + MINUTE, github, eve);
      pull.checkRuns = [
        ...pull.checkRuns,
        { status: "in_progress", conclusion: null, completed_at: null },
      ];
      yield* sweepAt(MADE_AT + 2 * MINUTE, github, eve);

      const texts = eve.sent.map((sent) => sentText(sent.message));
      assert.equal(texts.length, 1);
      assert.ok(texts[0]?.startsWith(`A check failed on your branch \`${pull.ref}\``));
      assert.ok(texts[0]?.includes(`/commit/${HEAD}/checks`));
    }),
  );

  it.effect(
    "every check on the head finished ends the wait of the agent at work once, and checks still running end none",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { pull } = yield* openTokenAgent({ startedAt: MADE_AT - 10 * MINUTE });
        const github = githubHolding(pull);
        pull.checkRuns = [
          {
            status: "completed",
            conclusion: "success",
            completed_at: new Date(MADE_AT).toISOString(),
            app: { slug: "github-actions" },
          },
          { status: "in_progress", conclusion: null, completed_at: null },
        ];

        yield* sweepAt(MADE_AT + MINUTE, github, eve);
        const whileRunning = eve.sent.length;
        pull.checkRuns = pull.checkRuns.map(() => ({
          status: "completed",
          conclusion: "success",
          completed_at: new Date(MADE_AT + MINUTE).toISOString(),
        }));
        yield* sweepAt(MADE_AT + 2 * MINUTE, github, eve);
        yield* sweepAt(MADE_AT + 3 * MINUTE, github, eve);

        const texts = eve.sent.map((sent) => sentText(sent.message));
        assert.equal(whileRunning, 0);
        assert.equal(texts.length, 1);
        assert.ok(texts[0]?.startsWith("Every check finished on `0123abc`"));
        assert.ok(texts[0]?.endsWith("None failed."));
      }),
  );

  it.effect("a token GitHub refuses is marked invalid, and its agent is polled no further", () =>
    Effect.gen(function* () {
      const eve = fakeEve();
      const { owner, pull } = yield* openTokenAgent(IDLE);
      const refusing = {
        layer: githubReaching([], GITHUB_APP_WITH_TOKENS, {}, () =>
          Response.json({ message: "Bad credentials" }, { status: 401 }),
        ).layer,
        answered: [],
      };

      yield* sweepAt(MADE_AT + MINUTE, refusing, eve);
      const github = githubHolding(pull);
      pull.reviews = [review(9, "octocat", "Cover the expired invitation too.")];
      yield* sweepAt(MADE_AT + 2 * MINUTE, github, eve);

      const held = yield* openMemberGitHubToken(GITHUB_FIXTURE_TOKEN_RING, owner);
      assert.ok(Result.isFailure(held) && held.failure === GITHUB_TOKEN_ABSENCE.INVALID);
      assert.equal(eve.sent.length, 0);
    }),
  );
});
