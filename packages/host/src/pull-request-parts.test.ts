import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  AGENT_CALL_FAILURE,
  type AgentOverviewPullRequestAnswerView,
  PULL_REQUEST_PART,
  type PullRequestPart,
} from "@repo/features/agent-view";
import {
  AGENT_STATUS,
  type AgentPullRequest,
  CHECK_SUMMARY,
  MERGE_STATE,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { PULL_REQUEST_WRITE_OUTCOME } from "@repo/features/pull-request-write-wire";
import { Effect, PubSub, Stream } from "effect";
import { type AppPullRequestParts, OWN_PULL_REQUEST } from "./app-state.js";
import {
  type PullRequestKey,
  type PullRequestListing,
  pullRequestParts,
} from "./pull-request-parts.js";
import { windowFocus } from "./window-focus.js";

/**
 * pull-request-parts.test.ts -- the parts of a pull request a Pull request tab holds are asked again together as the task list says it moved, or first names the agent's own, and keep an answer over a later failure.
 */

const AGENT = "3c2e1d0f-9a8b-4c7d-8e6f-5a4b3c2d1e0f";
const REVIEWER = "7d6c5b4a-3e2f-4a1b-9c8d-7e6f5a4b3c2d";
const OWN = "https://github.com/acme/relay/pull/42";
const OTHER = "https://github.com/acme/relay/pull/7";

/** A pull request as the task list's line for it stands. */
function line(
  url: string,
  number: number,
  moved: Partial<AgentPullRequest> = {},
): AgentPullRequest {
  return {
    number,
    title: "Send the invite once",
    url,
    state: PULL_REQUEST_STATE.OPEN,
    checks: CHECK_SUMMARY.PENDING,
    additions: 12,
    deletions: 3,
    changedFiles: 2,
    headSha: "a1b2c3d",
    ...moved,
  };
}

/** The pull request part as the service answers it for the pull request at `url`. */
function overview(url: string, number: number): AgentOverviewPullRequestAnswerView {
  return {
    pullRequest: {
      number,
      title: "Send the invite once",
      url,
      state: PULL_REQUEST_STATE.OPEN,
      html: "<p>Sends the invite once.</p>",
      base: "main",
      head: "agent/invite-once",
      createdAt: 1_800_000_000_000,
      mergedAt: null,
      merge: MERGE_STATE.CLEAN,
      requested: [],
    },
  };
}

/** The list with the taskless agent working on its own pull request, and the reviewer's pull request beside it. */
function listing(
  moved: { own?: Partial<AgentPullRequest>; other?: Partial<AgentPullRequest> } = {},
  status: (typeof AGENT_STATUS)[keyof typeof AGENT_STATUS] = AGENT_STATUS.RUNNING,
): PullRequestListing {
  return {
    statuses: new Map([
      [AGENT, status],
      [REVIEWER, AGENT_STATUS.COMPLETED],
    ]),
    pullRequests: [
      { agentId: AGENT, taskId: null, pullRequest: line(OWN, 42, moved.own) },
      { agentId: REVIEWER, taskId: null, pullRequest: line(OTHER, 7, moved.other) },
    ],
  };
}

const PARTS = Object.values(PULL_REQUEST_PART);

/** The parts asked again together as the pull request or its agent moves; the viewed marks move with its head alone, and the pickers' options with nothing. */
const MOVING = [
  PULL_REQUEST_PART.PULL_REQUEST,
  PULL_REQUEST_PART.CHECKS,
  PULL_REQUEST_PART.CONVERSATION,
  PULL_REQUEST_PART.PUBLISHED,
];

const settled = Effect.repeat(Effect.yieldNow, { times: 100 });

/** The parts over a fake service, each ask written down as `part number`, the agent's own written `own`, with the list's drawings handed through `draw`. */
function subject(failing: Set<PullRequestPart> = new Set()) {
  return Effect.gen(function* () {
    const asked: string[] = [];
    const told: Partial<AppPullRequestParts>[] = [];
    const drawings = yield* PubSub.unbounded<PullRequestListing>();
    const failure = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;
    const answering =
      <Answer>(part: PullRequestPart, answer: (key: PullRequestKey) => Answer) =>
      (key: PullRequestKey) =>
        Effect.sync(() => {
          asked.push(`${part} ${key.number ?? "own"}`);
          return failing.has(part) ? failure : answer(key);
        });
    const parts = yield* pullRequestParts({
      gate: () => true,
      focus: yield* windowFocus,
      ask: {
        pullRequest: answering(PULL_REQUEST_PART.PULL_REQUEST, (key) =>
          key.number === undefined ? overview(OWN, 42) : overview(OTHER, key.number),
        ),
        checks: answering(PULL_REQUEST_PART.CHECKS, () => ({ pullRequest: { checks: [] } })),
        conversation: answering(PULL_REQUEST_PART.CONVERSATION, () => ({
          pullRequest: { reviewers: [], conversation: [], earlier: 0 },
        })),
        published: answering(PULL_REQUEST_PART.PUBLISHED, (key) => ({
          repository: "acme/relay",
          branch: "agent/invite-once",
          pullRequest: key.number === undefined ? line(OWN, 42) : line(OTHER, key.number),
        })),
        reviewOptions: answering(PULL_REQUEST_PART.REVIEW_OPTIONS, () => ({
          labels: [],
          users: [],
          teams: [],
        })),
        viewed: answering(PULL_REQUEST_PART.VIEWED, () => ({
          outcome: PULL_REQUEST_WRITE_OUTCOME.DONE,
          files: [],
        })),
      },
      listings: Effect.map(PubSub.subscribe(drawings), Stream.fromSubscription),
      tell: {
        [LIVE_READ.PULL_REQUEST]: (held) => void told.push({ [LIVE_READ.PULL_REQUEST]: held }),
        [LIVE_READ.PULL_REQUEST_CHECKS]: (held) =>
          void told.push({ [LIVE_READ.PULL_REQUEST_CHECKS]: held }),
        [LIVE_READ.PULL_REQUEST_CONVERSATION]: (held) =>
          void told.push({ [LIVE_READ.PULL_REQUEST_CONVERSATION]: held }),
        [LIVE_READ.PULL_REQUEST_PUBLISHED]: (held) =>
          void told.push({ [LIVE_READ.PULL_REQUEST_PUBLISHED]: held }),
        [LIVE_READ.REVIEW_OPTIONS]: (held) => void told.push({ [LIVE_READ.REVIEW_OPTIONS]: held }),
        [LIVE_READ.PULL_REQUEST_VIEWED]: (held) =>
          void told.push({ [LIVE_READ.PULL_REQUEST_VIEWED]: held }),
      },
    });
    return {
      parts,
      asked,
      told,
      draw: (drawn: PullRequestListing) => Effect.andThen(PubSub.publish(drawings, drawn), settled),
      /** Holds every part of the agent's own pull request, and of the reviewer's that its tab names by number, for the caller's scope. */
      holdBoth: Effect.andThen(
        Effect.forEach(PARTS, (part) =>
          Effect.andThen(
            parts.hold({ part, agentId: AGENT }),
            parts.hold({ part, agentId: AGENT, number: 7 }),
          ),
        ),
        settled,
      ),
    };
  });
}

it.effect(
  "every part a tab holds is asked again together as the list's line for its pull request moves, a head moved by a push among it, and nothing is asked where nothing moved",
  () =>
    Effect.gen(function* () {
      const { asked, draw, holdBoth } = yield* subject();
      yield* holdBoth;
      yield* draw(listing());
      asked.length = 0;

      yield* draw(listing());
      assert.deepEqual(asked, []);

      yield* draw(listing({ own: { headSha: "e4f5a6b" } }));
      assert.deepEqual(
        asked.toSorted(),
        [...MOVING, PULL_REQUEST_PART.VIEWED].map((part) => `${part} own`).toSorted(),
      );

      asked.length = 0;
      yield* draw(
        listing({ own: { headSha: "e4f5a6b" }, other: { checks: CHECK_SUMMARY.PASSING } }),
      );
      assert.deepEqual(asked.toSorted(), MOVING.map((part) => `${part} 7`).toSorted());
    }),
);

it.effect(
  "every part of an agent's pull request is asked again as the agent's status moves, its end among it",
  () =>
    Effect.gen(function* () {
      const { asked, draw, holdBoth } = yield* subject();
      yield* holdBoth;
      yield* draw(listing());
      asked.length = 0;

      yield* draw(listing({}, AGENT_STATUS.COMPLETED));

      assert.deepEqual(
        asked.toSorted(),
        MOVING.flatMap((part) => [`${part} own`, `${part} 7`]).toSorted(),
      );
    }),
);

it.effect(
  "an agent's own parts are asked again as the list first names a pull request it published, which is how a window drawing it from the list hears its branch",
  () =>
    Effect.gen(function* () {
      const { parts, asked, draw } = yield* subject();
      yield* Effect.forEach(MOVING, (part) => parts.hold({ part, agentId: AGENT }));
      const listed = listing();
      yield* draw({
        ...listed,
        pullRequests: listed.pullRequests.filter((each) => each.agentId !== AGENT),
      });
      asked.length = 0;

      yield* draw(listed);

      assert.deepEqual(asked.toSorted(), MOVING.map((part) => `${part} own`).toSorted());
    }),
);

it.effect(
  "the viewed marks hold every answer, so a read that fails after one landed takes the marks away",
  () =>
    Effect.gen(function* () {
      const failing = new Set<PullRequestPart>();
      const { parts, told } = yield* subject(failing);
      const viewedHeld = () => told.findLast((held) => LIVE_READ.PULL_REQUEST_VIEWED in held);
      const key = { part: PULL_REQUEST_PART.VIEWED, agentId: AGENT } as const;

      yield* parts.hold(key);
      yield* settled;
      failing.add(PULL_REQUEST_PART.VIEWED);
      yield* parts.retry(key);

      assert.deepEqual(viewedHeld(), {
        [LIVE_READ.PULL_REQUEST_VIEWED]: {
          [AGENT]: { [OWN_PULL_REQUEST]: { rows: { failure: AGENT_CALL_FAILURE.UNANSWERED } } },
        },
      });
    }),
);

it.effect(
  "a part whose ask fails holds why until one answers, and an answer stands over a later failure",
  () =>
    Effect.gen(function* () {
      const failing = new Set<PullRequestPart>([PULL_REQUEST_PART.CHECKS]);
      const { parts, told } = yield* subject(failing);
      const checksHeld = () => told.findLast((held) => LIVE_READ.PULL_REQUEST_CHECKS in held);
      const key = { part: PULL_REQUEST_PART.CHECKS, agentId: AGENT } as const;

      yield* parts.hold(key);
      yield* settled;
      assert.deepEqual(checksHeld(), {
        [LIVE_READ.PULL_REQUEST_CHECKS]: {
          [AGENT]: { [OWN_PULL_REQUEST]: { rows: { failure: AGENT_CALL_FAILURE.UNANSWERED } } },
        },
      });

      failing.clear();
      yield* parts.retry(key);
      failing.add(PULL_REQUEST_PART.CHECKS);
      yield* parts.retry(key);

      assert.deepEqual(checksHeld(), {
        [LIVE_READ.PULL_REQUEST_CHECKS]: {
          [AGENT]: { [OWN_PULL_REQUEST]: { rows: { pullRequest: { checks: [] } } } },
        },
      });
    }),
);
