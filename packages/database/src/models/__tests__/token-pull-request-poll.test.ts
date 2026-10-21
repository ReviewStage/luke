import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
  type PullRequestState,
} from "@luke/features/coding-agent-wire";
import { GITHUB_ACCESS, type GitHubAccess } from "@luke/features/github-repositories-wire";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, startTask } from "../../testing/index.js";
import {
  archiveCodingAgent,
  createCodingAgent,
  recordCodingAgentPublished,
} from "../coding-agent-store.js";
import {
  claimTokenPullRequestPolls,
  recordTokenPullRequestPoll,
  type TokenPullRequestPollState,
} from "../token-pull-request-poll.js";

/**
 * The scheduled sweep's claim of the token agents' pull requests, over a
 * real dialect: it takes the open and draft pull requests of agents on a
 * member's token and no others, each once until its next poll is due, and
 * answers what the last poll read only while the pull request is the one
 * read. The claim is the deployment's, so each test reads back only the
 * agents it made. Synthetic accounts and pull requests throughout.
 */

const NOW = new Date("2026-10-20T12:00:00Z");
const NEXT = new Date("2026-10-20T12:01:00Z");
/** What a claim answers of a pull request no poll has read yet. */
const UNREAD: TokenPullRequestPollState = {
  etags: {},
  lastReviewId: null,
  lastCommentId: null,
  headSha: null,
  checkConclusion: null,
};
/** Larger than every agent the file's tests make, so a claim takes them all. */
const EVERY = 100;

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** An agent of the account's on the access given, its pull request numbered and standing as given where it has one. */
const openAgent = (
  userId: string,
  githubAccess: GitHubAccess,
  pullRequest?: { readonly number: number; readonly state: PullRequestState },
) =>
  Effect.gen(function* () {
    const task = yield* startTask(userId, { name: "Invitations", repository: "acme/relay" });
    const started = yield* createCodingAgent(userId, {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      planSnapshot: "# Invitations\n",
      prompt: null,
      repository: "acme/relay",
      githubAccess,
    });
    const { agent } = Option.getOrThrow(started);
    if (pullRequest !== undefined) {
      yield* recordCodingAgentPublished(userId, agent.id, {
        number: pullRequest.number,
        title: "Expire invitations",
        url: `https://github.com/acme/relay/pull/${pullRequest.number}`,
        state: pullRequest.state,
        checks: CHECK_SUMMARY.PENDING,
        additions: 1,
        deletions: 0,
        changedFiles: 1,
      });
    }
    return agent.id;
  });

/** The agents named a claim at `now` took, in the order named. */
const claimedOf = (now: Date, agentIds: readonly string[]) =>
  Effect.map(claimTokenPullRequestPolls(now, NEXT, EVERY), (claimed) =>
    agentIds.filter((id) => claimed.some((each) => each.agentId === id)),
  );

it.layer(getTestDB())("the token agents' pull requests due a poll", (it) => {
  it.effect(
    "a claim takes the open and draft pull requests of token agents once until their next poll, and none of an App agent's, an archived agent's, a merged one, or an agent with none",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const open = yield* openAgent(owner, GITHUB_ACCESS.TOKEN, {
          number: 1,
          state: PULL_REQUEST_STATE.OPEN,
        });
        const draft = yield* openAgent(owner, GITHUB_ACCESS.TOKEN, {
          number: 2,
          state: PULL_REQUEST_STATE.DRAFT,
        });
        const onApp = yield* openAgent(owner, GITHUB_ACCESS.APP, {
          number: 3,
          state: PULL_REQUEST_STATE.OPEN,
        });
        const merged = yield* openAgent(owner, GITHUB_ACCESS.TOKEN, {
          number: 4,
          state: PULL_REQUEST_STATE.MERGED,
        });
        const archived = yield* openAgent(owner, GITHUB_ACCESS.TOKEN, {
          number: 5,
          state: PULL_REQUEST_STATE.OPEN,
        });
        yield* archiveCodingAgent(owner, archived, true);
        const unpublished = yield* openAgent(owner, GITHUB_ACCESS.TOKEN);
        const ours = [open, draft, onApp, merged, archived, unpublished];

        assert.deepEqual(yield* claimedOf(NOW, ours), [open, draft]);
        assert.deepEqual(yield* claimedOf(NOW, ours), [], "a second call in the minute takes none");
        assert.deepEqual(yield* claimedOf(NEXT, ours), [open, draft]);
      }),
  );

  it.effect(
    "a claim answers what the last poll read, nothing before the first, and nothing once the agent's pull request is another",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const agentId = yield* openAgent(owner, GITHUB_ACCESS.TOKEN, {
          number: 7,
          state: PULL_REQUEST_STATE.OPEN,
        });
        const [first] = (yield* claimTokenPullRequestPolls(NOW, NEXT, EVERY)).filter(
          (each) => each.agentId === agentId,
        );
        assert.deepEqual(first, { agentId, userId: owner, pullRequest: 7, state: UNREAD });
        const read: TokenPullRequestPollState = {
          etags: { pullRequest: 'W/"pull"', reviews: 'W/"reviews"' },
          lastReviewId: 3_100_000_001,
          lastCommentId: null,
          headSha: "0123abcd",
          checkConclusion: "failure",
        };
        yield* recordTokenPullRequestPoll(agentId, 7, read);

        const [again] = (yield* claimTokenPullRequestPolls(
          NEXT,
          new Date(NEXT.getTime() + 60_000),
          EVERY,
        )).filter((each) => each.agentId === agentId);
        assert.deepEqual(again?.state, read);

        yield* recordCodingAgentPublished(owner, agentId, {
          number: 8,
          title: "Expire invitations again",
          url: "https://github.com/acme/relay/pull/8",
          state: PULL_REQUEST_STATE.OPEN,
          checks: CHECK_SUMMARY.PENDING,
          additions: 1,
          deletions: 0,
          changedFiles: 1,
        });
        const later = new Date(NEXT.getTime() + 60_000);
        const [another] = (yield* claimTokenPullRequestPolls(
          later,
          new Date(later.getTime() + 60_000),
          EVERY,
        )).filter((each) => each.agentId === agentId);
        assert.deepEqual(another, { agentId, userId: owner, pullRequest: 8, state: null });
      }),
  );
});
