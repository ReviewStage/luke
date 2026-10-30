/**
 * agents-app-pull-request.test.ts -- an agent's pull request through the hosted router: its changes, its reviews and labels, and the kept pull request, over a faked GitHub.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  archiveAgent,
  createAgent,
  readAgentPublished,
  updateAgentBranch,
} from "@luke/database/models/agent-store";
import { unreadOperatorNotices } from "@luke/database/models/operator-notices";
import { OPERATOR_NOTICE_KIND } from "@luke/database/storage-vocabulary";
import { getTestDB, joinWorkspace } from "@luke/database/testing";
import { HOSTED_API_ERROR } from "@luke/features";
import {
  AGENT_KIND,
  agentChangesAnswerSchema,
  agentOverviewConversationAnswerSchema,
  agentOverviewPullRequestAnswerSchema,
  agentPullRequestAnswerSchema,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
} from "@luke/features/agent-wire";
import { PULL_REQUEST_WRITE_BOUNDS, REACTION } from "@luke/features/pull-request-write-wire";
import type { WireBoundaryInput } from "@luke/wire";
import { Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { SERVER_EVENT } from "../events/server-events.js";
import { PULL_REQUEST_QUEUED_OPERATION } from "../github/pull-request-merging.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  AGENT_CHANGES,
  AGENT_OVERVIEW,
  AGENT_OVERVIEW_PULL_REQUEST,
  AGENT_PULL_REQUEST,
  AGENT_PULL_REQUEST_ACTION,
  AGENT_PULL_REQUEST_VIEWED,
  type Answer,
  countedFor,
  openTask,
  PUBLISHED,
  PULL_REQUEST_NODE_ID,
  publishedPullRequest,
  publishedPullRequestDrafted,
  RELAY,
  RELAY_FULL_NAME,
  readAnswer,
  refusal,
  request,
  startedAgent,
} from "../testing/agents-app-support.js";
import {
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  type RepositoryScript,
  type SentToGitHub,
} from "../testing/github-app-fake.js";
import { CODER } from "./coder-host/bounds.js";

/** One GraphQL call as GitHub saw it: the bearer it came under, and its document's words. */
interface GraphqlCall {
  readonly authorization: string | null;
  readonly query: string;
  readonly variables: Readonly<Record<string, string | number>>;
}

/**
 * The repository answering the published pull request's reads as
 * `publishedPullRequest` does, and GitHub's GraphQL endpoint answering each
 * call as `answer` says, every call written down: by default the pull
 * request's id for its read and an empty answer for any mutation.
 */
function graphqlAnswering(
  calls: GraphqlCall[],
  answer: (call: GraphqlCall) => Response = (call) =>
    Response.json({
      data: call.query.includes("mutation")
        ? {}
        : { repository: { pullRequest: { id: PULL_REQUEST_NODE_ID } } },
    }),
  repository: RepositoryScript = publishedPullRequest,
): RepositoryScript {
  return (sent) => {
    if (new URL(sent.url).pathname !== "/graphql") return repository(sent);
    const { query, variables } = JSON.parse(sent.body);
    // The published read's merge-queue ask rides with its REST reads on the App's token, as they do, and is no call the member made.
    if (query.includes(PULL_REQUEST_QUEUED_OPERATION)) {
      return Response.json({ data: { repository: { pullRequest: { mergeQueueEntry: null } } } });
    }
    const call = { authorization: sent.headers.get("authorization"), query, variables };
    calls.push(call);
    return answer(call);
  };
}

/** A change to the agent's pull request as the bearer given, with the fields beside its action given. */
function actionAs(
  bearer: string,
  agentId: string,
  action: string,
  fields: Readonly<Record<string, string>> = {},
): Request {
  return request(AGENT_PULL_REQUEST_ACTION, bearer, {
    method: "POST",
    id: agentId,
    body: { action, ...fields },
  });
}

/** How the published pull request may be merged, as GitHub's GraphQL answers the merge box's read. */
const MERGING_ANSWER = {
  data: {
    repository: {
      mergeCommitAllowed: false,
      squashMergeAllowed: true,
      rebaseMergeAllowed: true,
      autoMergeAllowed: true,
      pullRequest: {
        headRefOid: PUBLISHED.headSha,
        isMergeQueueEnabled: false,
        mergeQueueEntry: null,
        autoMergeRequest: { mergeMethod: "SQUASH" },
        reviewDecision: "REVIEW_REQUIRED",
        commits: { nodes: [{ commit: { statusCheckRollup: { state: "PENDING" } } }] },
      },
    },
  },
} as const;

/** The mutation a GraphQL call made, by the field it named; none for a read. */
function mutationOf(call: GraphqlCall): string | undefined {
  return /mutation[^{]*\{\s*(\w+)/u.exec(call.query)?.[1];
}

/** A review submitted on the agent's pull request as the bearer given. */
function reviewAs(
  bearer: string,
  agentId: string,
  review: { readonly event: string; readonly body: string },
): Request {
  return request(AGENT_PULL_REQUEST_ACTION, bearer, {
    method: "POST",
    id: agentId,
    body: { action: "submit-review", ...review },
  });
}

/** One of the pull request's pending reviews as GitHub answers it: its id, whether the asker wrote it, and the commit it was started on where told. */
interface PendingNode {
  readonly id: string;
  readonly viewerDidAuthor: boolean;
  readonly commit?: { readonly oid: string };
}

/**
 * GitHub answering a review's calls: the pull request's id, the pending
 * reviews given for its read of them, and each mutation as `mutation`
 * says, an empty answer by default.
 */
function reviewsAnswering(
  pending: readonly PendingNode[],
  mutation: (call: GraphqlCall) => Response = () => Response.json({ data: {} }),
): (call: GraphqlCall) => Response {
  return (call) => {
    if (call.query.includes("mutation")) return mutation(call);
    if (call.query.includes("reviews(states: PENDING")) {
      return Response.json({ data: { node: { reviews: { nodes: pending } } } });
    }
    return Response.json({ data: { repository: { pullRequest: { id: PULL_REQUEST_NODE_ID } } } });
  };
}

/** The review mutations GitHub was sent, each as which (a new review, or a pending one submitted) and its variables. */
function reviewMutations(calls: readonly GraphqlCall[]) {
  return calls
    .filter((call) => call.query.includes("mutation"))
    .map((call) => [
      call.query.includes("submitPullRequestReview") ? "submit" : "add",
      call.variables,
    ]);
}

/** A change to one of the pull request's review threads as the bearer given. */
function threadActionAs(bearer: string, agentId: string, body: WireBoundaryInput): Request {
  return request(AGENT_PULL_REQUEST_ACTION, bearer, { method: "POST", id: agentId, body });
}

/**
 * GitHub answering the viewed read a page at a time, the first page's
 * cursor naming the second, and the pull request's id and an empty answer
 * to each mutation.
 */
function viewedAnswering(call: GraphqlCall): Response {
  if (call.query.includes("mutation")) return Response.json({ data: {} });
  if (!call.query.includes("viewerViewedState")) {
    return Response.json({ data: { repository: { pullRequest: { id: PULL_REQUEST_NODE_ID } } } });
  }
  const first = call.variables.after === null;
  const nodes = first
    ? [
        { path: "src/seats.ts", viewerViewedState: "VIEWED" },
        { path: "src/plan.ts", viewerViewedState: "DISMISSED" },
      ]
    : [{ path: "README.md", viewerViewedState: "UNVIEWED" }];
  return Response.json({
    data: {
      repository: {
        pullRequest: {
          files: {
            nodes,
            pageInfo: { hasNextPage: first, endCursor: first ? "cursor-2" : null },
          },
        },
      },
    },
  });
}

/** GitHub answering a thread's calls: the pull request's id, every thread named as one of the pull request given, and an empty answer to each mutation. */
function threadsAnswering(threadPullRequestId: string): (call: GraphqlCall) => Response {
  return (call) => {
    if (call.query.includes("mutation")) return Response.json({ data: {} });
    if (call.query.includes("PullRequestReviewThread")) {
      return Response.json({ data: { node: { pullRequest: { id: threadPullRequestId } } } });
    }
    return Response.json({ data: { repository: { pullRequest: { id: PULL_REQUEST_NODE_ID } } } });
  };
}

/** The GitHub mutation a document makes, by the name its first field spells. */
function mutationName(query: string): string {
  return /\{\s*(\w+)\(/u.exec(query)?.[1] ?? "";
}

/**
 * The pull request's threads as the member's own token reads them for their
 * pending review: a published thread they replied on in it, a thread their
 * pending review starts on a range of the old side, a published thread
 * whose last comments are all their pending replies, a thread another's
 * pending review starts, and one whose comments are all published.
 */
const PENDING_THREADS = [
  {
    id: "PRRT_published",
    path: "src/invite.ts",
    line: 12,
    startLine: 12,
    diffSide: "RIGHT",
    startDiffSide: null,
    comments: {
      nodes: [
        {
          id: "PRRC_first",
          state: "SUBMITTED",
          body: "Rename this.",
          bodyHTML: "<p>Rename this.</p>",
          createdAt: "2026-09-30T10:00:00Z",
          author: { __typename: "User", login: "reviewer", databaseId: 7 },
          pullRequestReview: { id: "PRR_submitted" },
        },
        {
          id: "PRRC_reply",
          state: "PENDING",
          body: "Still?",
          bodyHTML: "<p>Still?</p>",
          createdAt: "2026-10-01T10:00:00Z",
          author: { __typename: "User", login: "teammate", databaseId: 8 },
          pullRequestReview: { id: "PRR_own" },
        },
      ],
    },
  },
  {
    id: "PRRT_started",
    path: "src/invite.ts",
    line: 40,
    startLine: 38,
    diffSide: "LEFT",
    startDiffSide: "LEFT",
    comments: {
      nodes: [
        {
          id: "PRRC_start",
          state: "PENDING",
          body: "Why drop these?",
          bodyHTML: null,
          createdAt: "2026-10-01T11:00:00Z",
          author: { __typename: "User", login: "teammate", databaseId: 8 },
          pullRequestReview: { id: "PRR_own" },
        },
      ],
    },
  },
  {
    id: "PRRT_long",
    path: "src/invite.ts",
    line: 20,
    startLine: 20,
    diffSide: "RIGHT",
    startDiffSide: null,
    opening: { nodes: [{ state: "SUBMITTED" }] },
    comments: {
      nodes: [
        {
          id: "PRRC_long",
          state: "PENDING",
          body: "And here?",
          createdAt: "2026-10-01T10:30:00Z",
          author: { __typename: "User", login: "teammate", databaseId: 8 },
          pullRequestReview: { id: "PRR_own" },
        },
      ],
    },
  },
  {
    id: "PRRT_others",
    path: "src/invite.ts",
    line: 3,
    startLine: 3,
    diffSide: "RIGHT",
    startDiffSide: null,
    comments: {
      nodes: [
        {
          id: "PRRC_others",
          state: "PENDING",
          body: "Not yours.",
          createdAt: "2026-10-01T09:00:00Z",
          author: { __typename: "User", login: "someone", databaseId: 9 },
          pullRequestReview: { id: "PRR_other" },
        },
      ],
    },
  },
];

/** The head a line comment names, as GitHub spells a commit. */
const LINE_HEAD = "c0ffee1c0ffee1c0ffee1c0ffee1c0ffee1c0ffe";

/** A comment on lines of the agent's pull request as the bearer given, on `src/invite.ts` line 12 on the new side unless the fields say otherwise. */
function lineCommentAs(
  bearer: string,
  agentId: string,
  fields: Readonly<Record<string, string | number>>,
): Request {
  return request(AGENT_PULL_REQUEST_ACTION, bearer, {
    method: "POST",
    id: agentId,
    body: {
      action: "add-review-comment",
      path: "src/invite.ts",
      line: 12,
      side: "right",
      body: "Rename this.",
      headSha: LINE_HEAD,
      ...fields,
    },
  });
}

/** GitHub answering a line comment's and a discard's calls: the member's pending reviews as given, and an empty answer to every mutation. */
function linesAnswering(pending: readonly PendingNode[]): (call: GraphqlCall) => Response {
  return reviewsAnswering(pending);
}

it.layer(getTestDB())("changing an agent's pull request", (it) => {
  /** The owner's plan with an agent that published a pull request, and the other account where the test makes it a member. */
  const published = (options: {
    readonly answer?: (call: GraphqlCall) => Response;
    readonly repository?: RepositoryScript;
    readonly otherToken?: string | null;
    readonly otherJoins?: boolean;
  }) =>
    Effect.gen(function* () {
      const calls: GraphqlCall[] = [];
      const opened = yield* openTask({
        github: graphqlAnswering(calls, options.answer, options.repository),
        ...(options.otherToken === undefined ? undefined : { otherToken: options.otherToken }),
      });
      if (options.otherJoins ?? true) yield* joinWorkspace(opened.task.workspaceId, opened.other);
      const { agent } = yield* startedAgent(opened.owner, opened.task.id, opened.ask);
      yield* updateAgentBranch(opened.owner, agent.id, PUBLISHED.branch);
      return { ...opened, agent, calls };
    });

  it.effect(
    "a teammate marks the owner's agent's draft ready for review and turns it back into a draft, each on the teammate's own GitHub token and never the App's",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({ otherToken: "ghu_teammate" });

        const ready = yield* ask(actionAs(other, agent.id, "ready-for-review"));
        const draft = yield* ask(actionAs(other, agent.id, "convert-to-draft"));

        assert.deepEqual(ready, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        assert.deepEqual(draft, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        assert.ok(calls.length > 0);
        assert.ok(calls.every((call) => call.authorization === "Bearer ghu_teammate"));
        const mutations = calls.filter((call) => call.query.includes("mutation"));
        assert.deepEqual(
          mutations.map((call) => [
            call.query.includes("markPullRequestReadyForReview")
              ? "ready"
              : call.query.includes("convertPullRequestToDraft")
                ? "draft"
                : "other",
            call.variables.id,
          ]),
          [
            ["ready", PULL_REQUEST_NODE_ID],
            ["draft", PULL_REQUEST_NODE_ID],
          ],
        );
        assert.deepEqual(calls[0]?.variables, {
          owner: RELAY.owner,
          name: RELAY.name,
          number: PUBLISHED.number,
        });
      }),
  );

  it.effect(
    "a merge, auto-merge on and off, and leaving the merge queue are each made on GitHub as the member, a merge and auto-merge against the head they saw",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({ otherToken: "ghu_teammate" });
        const head = { headSha: PUBLISHED.headSha };

        const answers = [
          yield* ask(actionAs(other, agent.id, "merge", { method: "squash", ...head })),
          yield* ask(actionAs(other, agent.id, "enable-auto-merge", { method: "rebase", ...head })),
          yield* ask(actionAs(other, agent.id, "enable-auto-merge", head)),
          yield* ask(actionAs(other, agent.id, "disable-auto-merge")),
          yield* ask(actionAs(other, agent.id, "dequeue")),
        ];

        assert.deepEqual(
          answers.map((answer) => answer.body),
          answers.map(() => ({ outcome: "done" })),
        );
        assert.ok(calls.every((call) => call.authorization === "Bearer ghu_teammate"));
        const id = PULL_REQUEST_NODE_ID;
        assert.deepEqual(
          calls.flatMap((call) => {
            const mutation = mutationOf(call);
            return mutation === undefined ? [] : [[mutation, call.variables]];
          }),
          [
            ["mergePullRequest", { id, method: "SQUASH", head: PUBLISHED.headSha }],
            ["enablePullRequestAutoMerge", { id, head: PUBLISHED.headSha, method: "REBASE" }],
            ["enablePullRequestAutoMerge", { id, head: PUBLISHED.headSha }],
            ["disablePullRequestAutoMerge", { id }],
            ["dequeuePullRequest", { id }],
          ],
        );
      }),
  );

  it.effect(
    "closing, reopening, and retitling are each made on GitHub as the member, and a blank title is refused before GitHub",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({ otherToken: "ghu_teammate" });

        const answers = [
          yield* ask(actionAs(other, agent.id, "close")),
          yield* ask(actionAs(other, agent.id, "reopen")),
          yield* ask(
            actionAs(other, agent.id, "edit-title", { title: "  Expire invitations weekly " }),
          ),
        ];
        const blank = yield* ask(actionAs(other, agent.id, "edit-title", { title: "   " }));

        assert.deepEqual(
          answers.map((answer) => answer.body),
          answers.map(() => ({ outcome: "done" })),
        );
        assert.deepEqual(
          blank,
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.ok(calls.every((call) => call.authorization === "Bearer ghu_teammate"));
        const id = PULL_REQUEST_NODE_ID;
        assert.deepEqual(
          calls.flatMap((call) => {
            const mutation = mutationOf(call);
            return mutation === undefined ? [] : [[mutation, call.variables]];
          }),
          [
            ["closePullRequest", { id }],
            ["reopenPullRequest", { id }],
            ["updatePullRequest", { id, title: "Expire invitations weekly" }],
          ],
        );
      }),
  );

  it.effect(
    "a member's edit of the description is written on their own token where GitHub's still reads as the one they opened, line endings aside, and refused as changed with nothing written where it moved on GitHub",
    () =>
      Effect.gen(function* () {
        // GitHub holds the description as github.com saves it, with Windows line endings.
        const onGitHub = "Invitations expire.\r\n\r\n- weekly";
        const { other, agent, calls, ask } = yield* published({
          otherToken: "ghu_teammate",
          answer: (call) => {
            if (call.query.includes("mutation")) return Response.json({ data: {} });
            if (call.query.includes("... on PullRequest { body }")) {
              return Response.json({ data: { node: { body: onGitHub } } });
            }
            return Response.json({
              data: { repository: { pullRequest: { id: PULL_REQUEST_NODE_ID } } },
            });
          },
        });

        const edited = yield* ask(
          actionAs(other, agent.id, "edit-description", {
            body: "Invitations expire after a week.",
            expectedBody: "Invitations expire.\n\n- weekly",
          }),
        );
        const stale = yield* ask(
          actionAs(other, agent.id, "edit-description", {
            body: "Invitations never expire.",
            expectedBody: "Invitations expire.",
          }),
        );

        assert.deepEqual(edited, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        assert.deepEqual(stale, {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            outcome: "refused",
            words:
              "The description changed on GitHub since you opened it. Reload it to see the change before saving yours.",
            reason: "description-changed",
          },
        });
        assert.ok(calls.every((call) => call.authorization === "Bearer ghu_teammate"));
        assert.deepEqual(
          calls.flatMap((call) => {
            const mutation = mutationOf(call);
            return mutation === undefined ? [] : [[mutation, call.variables]];
          }),
          [
            [
              "updatePullRequest",
              { id: PULL_REQUEST_NODE_ID, body: "Invitations expire after a week." },
            ],
          ],
        );
      }),
  );

  it.effect(
    "GitHub's refusal of a description edit reaches the member in its words, and a token it will not take asks them to sign in again",
    () =>
      Effect.gen(function* () {
        const description = (call: GraphqlCall) =>
          call.query.includes("... on PullRequest { body }")
            ? Response.json({ data: { node: { body: "" } } })
            : Response.json({
                data: { repository: { pullRequest: { id: PULL_REQUEST_NODE_ID } } },
              });
        const refusing = yield* published({
          otherToken: "ghu_teammate",
          answer: (call) =>
            call.query.includes("mutation")
              ? Response.json({
                  data: null,
                  errors: [{ message: "ghu_teammate does not have permission to update" }],
                })
              : description(call),
        });
        const expired = yield* published({
          otherToken: "ghu_expired",
          answer: () => Response.json({ message: "Bad credentials" }, { status: 401 }),
        });
        const edit = { body: "Weekly.", expectedBody: "" };

        assert.deepEqual(
          yield* refusing.ask(
            actionAs(refusing.other, refusing.agent.id, "edit-description", edit),
          ),
          {
            status: HOSTED_HTTP_STATUS.OK,
            body: { outcome: "refused", words: "ghu_teammate does not have permission to update" },
          },
        );
        assert.deepEqual(
          yield* expired.ask(actionAs(expired.other, expired.agent.id, "edit-description", edit)),
          { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "sign-in-required" } },
        );
      }),
  );

  it.effect(
    "a Pull request tab naming another pull request of the agent's repository by its number reads and changes that one, and the agent's own where it names none",
    () =>
      Effect.gen(function* () {
        const earlier = {
          number: 11,
          branch: "luke/teammate-invitations-base",
          headSha: "beef0001",
        };
        const repository: RepositoryScript = (sent) => {
          const path = `/repos/${RELAY.owner}/${RELAY.name}`;
          switch (new URL(sent.url).pathname) {
            case `${path}/pulls/${earlier.number}`:
              return Response.json({
                number: earlier.number,
                title: "Lay the invitations' base",
                html_url: `https://github.com/${RELAY_FULL_NAME}/pull/${earlier.number}`,
                state: "open",
                draft: false,
                merged: false,
                merged_at: null,
                additions: 9,
                deletions: 2,
                changed_files: 3,
                body: "The base.",
                body_html: "<p>The base.</p>",
                base: { ref: "main" },
                head: { ref: earlier.branch, sha: earlier.headSha },
                created_at: "2026-10-14T09:00:00Z",
                mergeable_state: "clean",
                user: null,
                requested_reviewers: [],
              });
            case `${path}/commits/${earlier.headSha}/check-runs`:
            case `${path}/commits/refs%2Fpull%2F${earlier.number}%2Fhead/check-runs`:
              return Response.json({ check_runs: [] });
            case `${path}/commits/${earlier.headSha}/status`:
            case `${path}/commits/refs%2Fpull%2F${earlier.number}%2Fhead/status`:
              return Response.json({ statuses: [] });
            default:
              return publishedPullRequest(sent);
          }
        };
        const { owner, other, agent, calls, ask } = yield* published({ repository });
        const header = (number?: string) =>
          Effect.map(
            ask(
              request(AGENT_OVERVIEW_PULL_REQUEST, owner, {
                id: agent.id,
                ...(number === undefined ? undefined : { number }),
              }),
            ),
            (answered) =>
              readAnswer(agentOverviewPullRequestAnswerSchema, HOSTED_HTTP_STATUS.OK, answered)
                .pullRequest?.title,
          );

        assert.equal(yield* header(String(earlier.number)), "Lay the invitations' base");
        assert.equal(yield* header(), "Expire teammate invitations");
        const named = readAnswer(
          agentPullRequestAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(
            request(AGENT_PULL_REQUEST, owner, { id: agent.id, number: String(earlier.number) }),
          ),
        );
        assert.deepEqual(
          [named.branch, named.pullRequest?.number, named.pullRequest?.additions],
          [earlier.branch, earlier.number, 9],
        );
        const before = calls.length;
        const ready = yield* ask(
          request(AGENT_PULL_REQUEST_ACTION, other, {
            method: "POST",
            id: agent.id,
            number: String(earlier.number),
            body: { action: "ready-for-review" },
          }),
        );
        assert.deepEqual(ready, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        assert.deepEqual(
          calls
            .slice(before)
            .filter((call) => !call.query.includes("mutation"))
            .map((call) => call.variables.number),
          [earlier.number],
        );
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
        assert.deepEqual(
          yield* ask(request(AGENT_OVERVIEW_PULL_REQUEST, owner, { id: agent.id, number: "0" })),
          invalid,
        );
        assert.deepEqual(
          yield* ask(request(AGENT_OVERVIEW_PULL_REQUEST, owner, { id: agent.id, number: "x" })),
          invalid,
        );
      }),
  );

  it.effect(
    "a merge naming no head, or a head that is no commit, is refused before anything reaches GitHub",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({});
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);

        assert.deepEqual(
          yield* ask(actionAs(other, agent.id, "merge", { method: "squash" })),
          invalid,
        );
        assert.deepEqual(
          yield* ask(
            actionAs(other, agent.id, "merge", { method: "squash", headSha: "main; drop" }),
          ),
          invalid,
        );
        assert.deepEqual(calls, []);
      }),
  );

  it.effect(
    "the pull request's header read says how it may be merged, read on the App's token, and stands without it where GitHub would not say",
    () =>
      Effect.gen(function* () {
        let answering = true;
        const { owner, agent, calls, ask } = yield* published({
          answer: () =>
            answering
              ? Response.json(MERGING_ANSWER)
              : Response.json({ message: "Server Error" }, { status: 502 }),
        });
        const header = () =>
          Effect.map(
            ask(request(AGENT_OVERVIEW_PULL_REQUEST, owner, { id: agent.id })),
            (answered) =>
              readAnswer(agentOverviewPullRequestAnswerSchema, HOSTED_HTTP_STATUS.OK, answered)
                .pullRequest,
          );

        const read = yield* header();
        answering = false;
        const without = yield* header();

        assert.deepEqual(read?.merging, {
          methods: ["squash", "rebase"],
          autoMergeAllowed: true,
          queue: false,
          queued: null,
          autoMerge: { method: "squash" },
          headSha: PUBLISHED.headSha,
          review: "review-required",
          checks: "pending",
        });
        // Note that whether the member may edit the description is read on their own token, beside the App's reads.
        assert.ok(
          calls
            .filter((call) => !call.query.includes("ViewerCanUpdate"))
            .every((call) => call.authorization === `Bearer ${GITHUB_FIXTURE_INSTALLATION_TOKEN}`),
        );
        assert.equal(without?.title, read?.title);
        assert.equal(without?.merging, undefined);
      }),
  );

  it.effect(
    "a member with no GitHub sign-in is asked to sign in with GitHub, and nothing is sent to GitHub as anyone else",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({ otherToken: null });

        const answered = yield* ask(actionAs(other, agent.id, "ready-for-review"));

        assert.deepEqual(answered, {
          status: HOSTED_HTTP_STATUS.OK,
          body: { outcome: "sign-in-required" },
        });
        assert.deepEqual(calls, []);
      }),
  );

  it.effect(
    "a token GitHub refuses asks the member to sign in with GitHub again, and nothing is tried on the App's token",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({
          otherToken: "ghu_revoked",
          answer: () => Response.json({ message: "Bad credentials" }, { status: 401 }),
        });

        const answered = yield* ask(actionAs(other, agent.id, "convert-to-draft"));

        assert.deepEqual(answered, {
          status: HOSTED_HTTP_STATUS.OK,
          body: { outcome: "sign-in-required" },
        });
        assert.ok(calls.length > 0);
        assert.ok(calls.every((call) => call.authorization === "Bearer ghu_revoked"));
      }),
  );

  it.effect(
    "a change GitHub refuses is answered in GitHub's own words, whether as GraphQL errors or a refusal status",
    () =>
      Effect.gen(function* () {
        const { other, agent, ask } = yield* published({
          answer: (call) =>
            !call.query.includes("mutation")
              ? Response.json({
                  data: { repository: { pullRequest: { id: PULL_REQUEST_NODE_ID } } },
                })
              : call.query.includes("convertPullRequestToDraft")
                ? Response.json(
                    { message: "Resource not accessible by integration" },
                    { status: 403 },
                  )
                : Response.json({
                    data: null,
                    errors: [{ type: "FORBIDDEN", message: "Pull request is not a draft." }],
                  }),
        });

        assert.deepEqual(yield* ask(actionAs(other, agent.id, "ready-for-review")), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { outcome: "refused", words: "Pull request is not a draft." },
        });
        assert.deepEqual(yield* ask(actionAs(other, agent.id, "convert-to-draft")), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { outcome: "refused", words: "Resource not accessible by integration" },
        });
      }),
  );

  it.effect(
    "a teammate who read the pull request a moment before another member marked it ready reads it ready at once, not from what was kept",
    () =>
      Effect.gen(function* () {
        let draft = true;
        const { owner, other, agent, ask } = yield* published({
          repository: publishedPullRequestDrafted(() => draft),
          answer: (call) => {
            if (call.query.includes("markPullRequestReadyForReview")) draft = false;
            return Response.json({
              data: call.query.includes("mutation")
                ? {}
                : { repository: { pullRequest: { id: PULL_REQUEST_NODE_ID } } },
            });
          },
        });
        const stateAs = (bearer: string) =>
          Effect.map(
            ask(request(AGENT_PULL_REQUEST, bearer, { id: agent.id })),
            (answered) =>
              readAnswer(agentPullRequestAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).pullRequest
                ?.state,
          );
        assert.equal(yield* stateAs(owner), PULL_REQUEST_STATE.DRAFT);

        yield* ask(actionAs(other, agent.id, "ready-for-review"));

        assert.equal(yield* stateAs(owner), PULL_REQUEST_STATE.OPEN);
      }),
  );

  it.effect(
    "a change to a pull request lets go of what the agent's changes read had kept, so the next changes read asks GitHub afresh",
    () =>
      Effect.gen(function* () {
        // The agent's branch has no pull request until the change, which a member makes on the one the request numbers.
        let opened = false;
        const pulls = `/repos/${RELAY.owner}/${RELAY.name}/pulls`;
        const headed = publishedPullRequestDrafted(() => false, LINE_HEAD);
        const { other, agent, ask } = yield* published({
          repository: (sent) => {
            const { pathname } = new URL(sent.url);
            if (pathname === `${pulls}/${PUBLISHED.number}/files`) {
              return Response.json([
                {
                  filename: "src/seats.ts",
                  status: "modified",
                  additions: 1,
                  deletions: 1,
                  changes: 2,
                  patch: "@@ -1 +1 @@\n-a\n+b",
                  sha: "b".repeat(40),
                },
              ]);
            }
            return !opened && pathname === pulls ? Response.json([]) : headed(sent);
          },
          answer: (call) => {
            if (call.query.includes("mutation")) opened = true;
            return Response.json({
              data: call.query.includes("mutation")
                ? {}
                : { repository: { pullRequest: { id: PULL_REQUEST_NODE_ID } } },
            });
          },
        });
        const changedUrl = Effect.map(
          ask(request(AGENT_CHANGES, other, { id: agent.id })),
          (answered) =>
            readAnswer(agentChangesAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).pullRequest
              ?.url ?? null,
        );
        assert.equal(yield* changedUrl, null);

        const changed = yield* ask(
          request(AGENT_PULL_REQUEST_ACTION, other, {
            method: "POST",
            id: agent.id,
            number: String(PUBLISHED.number),
            body: { action: "ready-for-review" },
          }),
        );

        assert.deepEqual(changed, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        assert.equal(
          yield* changedUrl,
          `https://github.com/${RELAY_FULL_NAME}/pull/${PUBLISHED.number}`,
        );
      }),
  );

  it.effect(
    "a pull request GitHub answers as none, with no word of why, is refused in words saying so",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({
          answer: () => Response.json({ data: { repository: { pullRequest: null } } }),
        });

        assert.deepEqual(yield* ask(actionAs(other, agent.id, "ready-for-review")), {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            outcome: "refused",
            words: "Could not resolve to a pull request your GitHub account can see.",
          },
        });
        assert.ok(calls.every((call) => !call.query.includes("mutation")));
      }),
  );

  it.effect(
    "a review is made and submitted at once where the member holds no pending review, on their own token, and GitHub's refusal of it is answered in its words",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({
          otherToken: "ghu_teammate",
          answer: reviewsAnswering([], (call) =>
            call.variables.event === "APPROVE"
              ? Response.json({
                  data: null,
                  errors: [{ message: "Review Can not approve your own pull request" }],
                })
              : Response.json({ data: {} }),
          ),
        });

        const commented = yield* ask(
          reviewAs(other, agent.id, { event: "comment", body: "Looks close; one question." }),
        );
        const approved = yield* ask(reviewAs(other, agent.id, { event: "approve", body: "" }));

        assert.deepEqual(commented, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        assert.deepEqual(approved, {
          status: HOSTED_HTTP_STATUS.OK,
          body: { outcome: "refused", words: "Review Can not approve your own pull request" },
        });
        assert.deepEqual(reviewMutations(calls), [
          [
            "add",
            {
              id: PULL_REQUEST_NODE_ID,
              event: "COMMENT",
              body: "Looks close; one question.",
            },
          ],
          ["add", { id: PULL_REQUEST_NODE_ID, event: "APPROVE" }],
        ]);
        assert.ok(calls.every((call) => call.authorization === "Bearer ghu_teammate"));
      }),
  );

  it.effect(
    "the member's own pending review is the one submitted, keeping its words where the press sends none, and nobody else's is touched",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({
          answer: reviewsAnswering([
            { id: "PRR_someone_else", viewerDidAuthor: false },
            { id: "PRR_member_pending", viewerDidAuthor: true },
          ]),
        });

        const changes = yield* ask(
          reviewAs(other, agent.id, { event: "request-changes", body: "Please split this." }),
        );
        const kept = yield* ask(reviewAs(other, agent.id, { event: "comment", body: "  " }));

        assert.deepEqual(changes, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        assert.deepEqual(kept, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        assert.deepEqual(reviewMutations(calls), [
          [
            "submit",
            { id: "PRR_member_pending", event: "REQUEST_CHANGES", body: "Please split this." },
          ],
          ["submit", { id: "PRR_member_pending", event: "COMMENT" }],
        ]);
      }),
  );

  it.effect(
    "a review naming no event GitHub knows, or longer than GitHub takes, never reaches GitHub",
    () =>
      Effect.gen(function* () {
        const { owner, agent, calls, ask } = yield* published({ answer: reviewsAnswering([]) });

        const unnamed = yield* ask(
          request(AGENT_PULL_REQUEST_ACTION, owner, {
            method: "POST",
            id: agent.id,
            body: { action: "submit-review", event: "dismiss", body: "" },
          }),
        );
        const long = yield* ask(
          reviewAs(owner, agent.id, {
            event: "comment",
            body: "x".repeat(PULL_REQUEST_WRITE_BOUNDS.MAX_BODY_CHARS + 1),
          }),
        );

        for (const answered of [unnamed, long]) {
          assert.deepEqual(
            answered,
            refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
          );
        }
        assert.deepEqual(calls, []);
      }),
  );

  it.effect(
    "a member replies on a review thread of the pull request, resolves it, and opens it again, each on their own token",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({
          otherToken: "ghu_teammate",
          answer: threadsAnswering(PULL_REQUEST_NODE_ID),
        });

        const answers = [
          yield* ask(
            threadActionAs(other, agent.id, {
              action: "reply-to-thread",
              threadId: "PRRT_flag",
              body: "Renamed in the next push.",
            }),
          ),
          yield* ask(
            threadActionAs(other, agent.id, { action: "resolve-thread", threadId: "PRRT_flag" }),
          ),
          yield* ask(
            threadActionAs(other, agent.id, { action: "unresolve-thread", threadId: "PRRT_flag" }),
          ),
        ];

        for (const answered of answers) {
          assert.deepEqual(answered, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        }
        assert.deepEqual(
          calls
            .filter((call) => call.query.includes("mutation"))
            .map((call) => [mutationName(call.query), call.variables]),
          [
            [
              "addPullRequestReviewThreadReply",
              { id: "PRRT_flag", body: "Renamed in the next push." },
            ],
            ["resolveReviewThread", { id: "PRRT_flag" }],
            ["unresolveReviewThread", { id: "PRRT_flag" }],
          ],
        );
        assert.ok(calls.every((call) => call.authorization === "Bearer ghu_teammate"));
      }),
  );

  it.effect(
    "a thread of another pull request is refused in words saying so and never changed, and a blank reply never reaches GitHub",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({
          answer: threadsAnswering("PR_kwDOsomeOtherPull"),
        });

        const elsewhere = yield* ask(
          threadActionAs(other, agent.id, { action: "resolve-thread", threadId: "PRRT_elsewhere" }),
        );
        const blank = yield* ask(
          threadActionAs(other, agent.id, {
            action: "reply-to-thread",
            threadId: "PRRT_flag",
            body: " \n ",
          }),
        );

        assert.deepEqual(elsewhere, {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            outcome: "refused",
            words: "Could not resolve to a review thread on this pull request.",
          },
        });
        assert.deepEqual(
          blank,
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.ok(calls.every((call) => !call.query.includes("mutation")));
      }),
  );

  it.effect(
    "a member comments on the pull request itself on their own token, and a blank comment never reaches GitHub",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({ otherToken: "ghu_teammate" });

        const commented = yield* ask(
          threadActionAs(other, agent.id, { action: "comment", body: "Shipping after lunch." }),
        );
        const blank = yield* ask(
          threadActionAs(other, agent.id, { action: "comment", body: "\n" }),
        );

        assert.deepEqual(commented, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        assert.deepEqual(
          blank,
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.deepEqual(
          calls
            .filter((call) => call.query.includes("mutation"))
            .map((call) => [mutationName(call.query), call.variables]),
          [["addComment", { id: PULL_REQUEST_NODE_ID, body: "Shipping after lunch." }]],
        );
        assert.ok(calls.every((call) => call.authorization === "Bearer ghu_teammate"));
      }),
  );

  it.effect(
    "two members reading the same conversation are each told which reactions are their own, each read on their own GitHub token, and the answer is never kept for anyone else",
    () =>
      Effect.gen(function* () {
        const { owner, other, agent, ask, fetch } = yield* published({
          otherToken: "ghu_teammate",
          answer: (call) =>
            Response.json({
              data: {
                repository: {
                  pullRequest: call.query.includes("viewerHasReacted")
                    ? {
                        id: PULL_REQUEST_NODE_ID,
                        reactionGroups: [
                          {
                            content: "HEART",
                            viewerHasReacted: call.authorization === "Bearer ghu_standing",
                          },
                        ],
                      }
                    : {
                        id: PULL_REQUEST_NODE_ID,
                        reactionGroups: [
                          { content: "HEART", reactors: { totalCount: 1, nodes: [] } },
                        ],
                        reviewThreads: { totalCount: 0, nodes: [] },
                      },
                },
              },
            }),
        });
        const readAs = (bearer: string) =>
          Effect.map(
            ask(request(AGENT_OVERVIEW[2], bearer, { id: agent.id })),
            (answered) =>
              readAnswer(agentOverviewConversationAnswerSchema, HOSTED_HTTP_STATUS.OK, answered)
                .pullRequest?.descriptionReactions,
          );

        assert.deepEqual(yield* readAs(owner), [
          { content: REACTION.HEART, count: 1, by: [], mine: true },
        ]);
        assert.deepEqual(yield* readAs(other), [
          { content: REACTION.HEART, count: 1, by: [], mine: false },
        ]);
        const response = yield* fetch(request(AGENT_OVERVIEW[2], other, { id: agent.id }));
        assert.equal(response.headers.get("cache-control"), "private, no-store");
      }),
  );

  it.effect(
    "a teammate gives a reaction and takes it back on their own GitHub token, once what it names is held to the agent's pull request; one on anything else is refused and nothing is changed",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({
          otherToken: "ghu_teammate",
          answer: (call) =>
            Response.json({
              data: call.query.includes("mutation")
                ? {}
                : call.query.includes("repository(")
                  ? { repository: { pullRequest: { id: PULL_REQUEST_NODE_ID } } }
                  : {
                      node: {
                        issue: {
                          id: call.variables.id === "IC_1" ? PULL_REQUEST_NODE_ID : "PR_elsewhere",
                        },
                      },
                    },
            }),
        });
        const react = (action: string, subject: string) =>
          ask(
            request(AGENT_PULL_REQUEST_ACTION, other, {
              method: "POST",
              id: agent.id,
              body: { action, subject, content: REACTION.HEART },
            }),
          );

        const done = { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } };
        assert.deepEqual(yield* react("add-reaction", "IC_1"), done);
        assert.deepEqual(yield* react("remove-reaction", "IC_1"), done);
        assert.deepEqual(yield* react("add-reaction", "IC_ELSEWHERE"), {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            outcome: "refused",
            words: "Could not resolve to a comment on this pull request.",
          },
        });

        assert.ok(calls.every((call) => call.authorization === "Bearer ghu_teammate"));
        assert.deepEqual(
          calls
            .filter((call) => call.query.includes("mutation"))
            .map((call) => [
              call.query.includes("addReaction") ? "add" : "remove",
              call.variables.id,
              call.variables.content,
            ]),
          [
            ["add", "IC_1", "HEART"],
            ["remove", "IC_1", "HEART"],
          ],
        );
      }),
  );

  it.effect(
    "a single line comment is published at once as a review of its own, on the member's token, at the head their diff was read at",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({
          otherToken: "ghu_teammate",
          answer: linesAnswering([]),
        });

        const answered = yield* ask(
          lineCommentAs(other, agent.id, { mode: "single", startLine: 10, startSide: "right" }),
        );

        assert.deepEqual(answered, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        const mutations = calls.filter((call) => call.query.includes("mutation"));
        assert.deepEqual(
          mutations.map((call) => [mutationName(call.query), call.variables]),
          [
            [
              "addPullRequestReview",
              {
                id: PULL_REQUEST_NODE_ID,
                commit: LINE_HEAD,
                path: "src/invite.ts",
                body: "Rename this.",
                line: 12,
                side: "RIGHT",
                startLine: 10,
                startSide: "RIGHT",
              },
            ],
          ],
        );
        assert.match(mutations[0]?.query ?? "", /event: COMMENT, threads: \[/u);
        assert.ok(calls.every((call) => call.authorization === "Bearer ghu_teammate"));
      }),
  );

  it.effect(
    "a comment for a review starts the member's pending review on the head their diff was read at where they hold none, and joins the one they hold otherwise, nobody else's",
    () =>
      Effect.gen(function* () {
        const fresh = yield* published({ answer: linesAnswering([]) });
        const started = yield* fresh.ask(
          lineCommentAs(fresh.other, fresh.agent.id, { mode: "review", side: "left" }),
        );
        const holding = yield* published({
          answer: linesAnswering([
            { id: "PRR_someone_else", viewerDidAuthor: false },
            { id: "PRR_member_pending", viewerDidAuthor: true, commit: { oid: LINE_HEAD } },
          ]),
        });
        const joined = yield* holding.ask(
          lineCommentAs(holding.other, holding.agent.id, { mode: "review" }),
        );

        for (const answered of [started, joined]) {
          assert.deepEqual(answered, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        }
        const mutations = (calls: readonly GraphqlCall[]) =>
          calls
            .filter((call) => call.query.includes("mutation"))
            .map((call) => [mutationName(call.query), call.variables]);
        assert.deepEqual(mutations(fresh.calls), [
          [
            "addPullRequestReview",
            {
              id: PULL_REQUEST_NODE_ID,
              commit: LINE_HEAD,
              path: "src/invite.ts",
              body: "Rename this.",
              line: 12,
              side: "LEFT",
            },
          ],
        ]);
        assert.doesNotMatch(
          fresh.calls.find((call) => call.query.includes("mutation"))?.query ?? "",
          /event:/u,
          "the review is started pending, its first thread with it",
        );
        assert.deepEqual(mutations(holding.calls), [
          [
            "addPullRequestReviewThread",
            {
              review: "PRR_member_pending",
              path: "src/invite.ts",
              body: "Rename this.",
              line: 12,
              side: "RIGHT",
            },
          ],
        ]);
      }),
  );

  it.effect(
    "a comment for a review held pending on another commit is refused in words saying so, its lines never sent to that review",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({
          answer: linesAnswering([
            {
              id: "PRR_member_pending",
              viewerDidAuthor: true,
              commit: { oid: "0ld0ld0ld0ld0ld0ld0ld0ld0ld0ld0ld0ld0ld0" },
            },
          ]),
        });

        const answered = yield* ask(lineCommentAs(other, agent.id, { mode: "review" }));

        assert.deepEqual(answered, {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            outcome: "refused",
            words:
              "Your pending review was started on another commit. Submit or discard it, then refresh changes to comment on these lines.",
          },
        });
        assert.ok(calls.every((call) => !call.query.includes("mutation")));
      }),
  );

  it.effect(
    "Discard throws away the member's own pending review and nobody else's, and is refused in words where they hold none",
    () =>
      Effect.gen(function* () {
        const holding = yield* published({
          answer: linesAnswering([
            { id: "PRR_someone_else", viewerDidAuthor: false },
            { id: "PRR_member_pending", viewerDidAuthor: true },
          ]),
        });
        const empty = yield* published({
          answer: linesAnswering([{ id: "PRR_someone_else", viewerDidAuthor: false }]),
        });

        const discarded = yield* holding.ask(
          actionAs(holding.other, holding.agent.id, "discard-review"),
        );
        const refused = yield* empty.ask(actionAs(empty.other, empty.agent.id, "discard-review"));

        assert.deepEqual(discarded, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        assert.deepEqual(
          holding.calls
            .filter((call) => call.query.includes("mutation"))
            .map((call) => [mutationName(call.query), call.variables]),
          [["deletePullRequestReview", { id: "PRR_member_pending" }]],
        );
        assert.deepEqual(refused, {
          status: HOSTED_HTTP_STATUS.OK,
          body: { outcome: "refused", words: "You have no pending review on this pull request." },
        });
        assert.ok(empty.calls.every((call) => !call.query.includes("mutation")));
      }),
  );

  it.effect(
    "a line comment on no line, on a side GitHub does not name, or at a head that is no commit, never reaches GitHub",
    () =>
      Effect.gen(function* () {
        const { owner, agent, calls, ask } = yield* published({ answer: linesAnswering([]) });

        const answers = [
          yield* ask(lineCommentAs(owner, agent.id, { mode: "single", line: 0 })),
          yield* ask(lineCommentAs(owner, agent.id, { mode: "single", side: "middle" })),
          yield* ask(lineCommentAs(owner, agent.id, { mode: "review", headSha: "main" })),
          yield* ask(lineCommentAs(owner, agent.id, { mode: "later" })),
        ];

        for (const answered of answers) {
          assert.deepEqual(
            answered,
            refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
          );
        }
        assert.deepEqual(calls, []);
      }),
  );

  it.effect(
    "a member edits and deletes a comment of their own pending review on this pull request, and is refused in words for another's, a published one, or one on another pull request",
    () =>
      Effect.gen(function* () {
        // The comments GitHub answers for, by id, as the member's token reads them.
        const commentNode = (viewerDidAuthor: boolean, state: string, pullRequest: string) => ({
          viewerDidAuthor,
          state,
          pullRequest: { id: pullRequest },
        });
        const COMMENTS = new Map([
          ["PRRC_own", commentNode(true, "PENDING", PULL_REQUEST_NODE_ID)],
          ["PRRC_theirs", commentNode(false, "PENDING", PULL_REQUEST_NODE_ID)],
          ["PRRC_published", commentNode(true, "SUBMITTED", PULL_REQUEST_NODE_ID)],
          ["PRRC_elsewhere", commentNode(true, "PENDING", "PR_elsewhere")],
        ]);
        const { other, agent, calls, ask } = yield* published({
          otherToken: "ghu_teammate",
          answer: (call) => {
            if (call.query.includes("mutation")) return Response.json({ data: {} });
            if (call.query.includes("PullRequestReviewComment")) {
              return Response.json({
                data: { node: COMMENTS.get(String(call.variables.id)) ?? null },
              });
            }
            return Response.json({
              data: { repository: { pullRequest: { id: PULL_REQUEST_NODE_ID } } },
            });
          },
        });

        const edited = yield* ask(
          actionAs(other, agent.id, "edit-review-comment", {
            commentId: "PRRC_own",
            body: "Renamed.",
          }),
        );
        const deleted = yield* ask(
          actionAs(other, agent.id, "delete-review-comment", { commentId: "PRRC_own" }),
        );
        const refusals = [];
        for (const commentId of ["PRRC_theirs", "PRRC_published", "PRRC_elsewhere", "PRRC_gone"]) {
          refusals.push(
            yield* ask(actionAs(other, agent.id, "edit-review-comment", { commentId, body: "x" })),
            yield* ask(actionAs(other, agent.id, "delete-review-comment", { commentId })),
          );
        }

        assert.deepEqual(edited, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        assert.deepEqual(deleted, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        assert.deepEqual(
          calls
            .filter((call) => call.query.includes("mutation"))
            .map((call) => [mutationName(call.query), call.variables, call.authorization]),
          [
            [
              "updatePullRequestReviewComment",
              { id: "PRRC_own", body: "Renamed." },
              "Bearer ghu_teammate",
            ],
            ["deletePullRequestReviewComment", { id: "PRRC_own" }, "Bearer ghu_teammate"],
          ],
        );
        for (const refused of refusals) {
          assert.deepEqual(refused, {
            status: HOSTED_HTTP_STATUS.OK,
            body: {
              outcome: "refused",
              words: "That comment is not one of your pending review's on this pull request.",
            },
          });
        }
      }),
  );

  it.effect(
    "each member reads the review they hold pending beside the conversation, on their own token, and one with no sign-in or whom GitHub would not answer reads none",
    () =>
      Effect.gen(function* () {
        const pendingAnswer = (call: GraphqlCall) => {
          if (!call.query.includes("ViewerPendingReview")) return Response.json({ data: null });
          if (call.authorization === "Bearer ghu_broken") {
            return Response.json({ message: "Server Error" }, { status: 502 });
          }
          const teammate = call.authorization === "Bearer ghu_teammate";
          const nodes = teammate
            ? [
                { id: "PRR_other", viewerDidAuthor: false, comments: { totalCount: 1 } },
                { id: "PRR_own", viewerDidAuthor: true, comments: { totalCount: 2 } },
              ]
            : [];
          return Response.json({
            data: {
              repository: {
                pullRequest: {
                  reviews: { nodes },
                  reviewThreads: { nodes: teammate ? PENDING_THREADS : [] },
                },
              },
            },
          });
        };
        const pendingOf = (
          opened: { readonly ask: (request: Request) => Effect.Effect<Answer> },
          bearer: string,
          agentId: string,
        ) =>
          Effect.map(
            opened.ask(request(AGENT_OVERVIEW[2], bearer, { id: agentId })),
            (answered) =>
              readAnswer(agentOverviewConversationAnswerSchema, HOSTED_HTTP_STATUS.OK, answered)
                .pullRequest?.pendingReview,
          );
        const two = yield* published({ otherToken: "ghu_teammate", answer: pendingAnswer });
        const unsigned = yield* published({ otherToken: null, answer: pendingAnswer });
        const broken = yield* published({ otherToken: "ghu_broken", answer: pendingAnswer });

        assert.deepEqual(yield* pendingOf(two, two.other, two.agent.id), {
          comments: 2,
          drafts: [
            {
              id: "PRRC_reply",
              threadId: "PRRT_published",
              path: "src/invite.ts",
              line: 12,
              startLine: null,
              side: "right",
              startSide: null,
              html: "<p>Still?</p>",
              body: "Still?",
              at: Date.parse("2026-10-01T10:00:00Z"),
              by: { login: "teammate", bot: false },
            },
            {
              id: "PRRC_long",
              threadId: "PRRT_long",
              path: "src/invite.ts",
              line: 20,
              startLine: null,
              side: "right",
              startSide: null,
              html: null,
              body: "And here?",
              at: Date.parse("2026-10-01T10:30:00Z"),
              by: { login: "teammate", bot: false },
            },
            {
              id: "PRRC_start",
              path: "src/invite.ts",
              line: 40,
              startLine: 38,
              side: "left",
              startSide: "left",
              html: null,
              body: "Why drop these?",
              at: Date.parse("2026-10-01T11:00:00Z"),
              by: { login: "teammate", bot: false },
            },
          ],
        });
        assert.equal(yield* pendingOf(two, two.owner, two.agent.id), null);
        assert.equal(yield* pendingOf(unsigned, unsigned.other, unsigned.agent.id), null);
        assert.equal(yield* pendingOf(broken, broken.other, broken.agent.id), null);
        assert.deepEqual(
          two.calls
            .filter((call) => call.query.includes("ViewerPendingReview"))
            .map((call) => call.authorization),
          ["Bearer ghu_teammate", "Bearer ghu_standing"],
        );
        assert.ok(unsigned.calls.every((call) => !call.query.includes("ViewerPendingReview")));
      }),
  );

  it.effect(
    "the pull request's header says whether the member reading may edit its description, as GitHub answers on their own token, and not where they hold no sign-in or GitHub would not answer",
    () =>
      Effect.gen(function* () {
        const canUpdate = (call: GraphqlCall) => {
          if (!call.query.includes("ViewerCanUpdate")) return Response.json({ data: null });
          if (call.authorization === "Bearer ghu_broken") {
            return Response.json({ message: "Server Error" }, { status: 502 });
          }
          const viewerCanUpdate = call.authorization === "Bearer ghu_teammate";
          return Response.json({ data: { repository: { pullRequest: { viewerCanUpdate } } } });
        };
        const header = (
          opened: { readonly ask: (request: Request) => Effect.Effect<Answer> },
          bearer: string,
          agentId: string,
        ) =>
          Effect.map(
            opened.ask(request(AGENT_OVERVIEW_PULL_REQUEST, bearer, { id: agentId })),
            (answered) =>
              readAnswer(agentOverviewPullRequestAnswerSchema, HOSTED_HTTP_STATUS.OK, answered)
                .pullRequest,
          );
        const two = yield* published({ otherToken: "ghu_teammate", answer: canUpdate });
        const unsigned = yield* published({ otherToken: null, answer: canUpdate });
        const broken = yield* published({ otherToken: "ghu_broken", answer: canUpdate });

        const teammate = yield* header(two, two.other, two.agent.id);
        assert.deepEqual(
          [teammate?.canEditDescription, teammate?.body],
          [true, "Invitations expire."],
        );
        assert.equal((yield* header(two, two.owner, two.agent.id))?.canEditDescription, false);
        assert.equal(
          (yield* header(unsigned, unsigned.other, unsigned.agent.id))?.canEditDescription,
          false,
        );
        assert.equal(
          (yield* header(broken, broken.other, broken.agent.id))?.canEditDescription,
          false,
        );
        assert.deepEqual(
          two.calls
            .filter((call) => call.query.includes("ViewerCanUpdate"))
            .map((call) => call.authorization),
          ["Bearer ghu_teammate", "Bearer ghu_standing"],
        );
        assert.ok(unsigned.calls.every((call) => !call.query.includes("ViewerCanUpdate")));
      }),
  );

  it.effect(
    "the changes name the head their files were read at, which a line comment is anchored to",
    () =>
      Effect.gen(function* () {
        const headed = publishedPullRequestDrafted(() => false, LINE_HEAD);
        const { owner, agent, ask } = yield* published({ repository: headed });

        const changes = readAnswer(
          agentChangesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_CHANGES, owner, { id: agent.id })),
        );

        assert.equal(changes.pullRequest?.headSha, LINE_HEAD);
      }),
  );

  it.effect(
    "each changed file names the git object its contents after are, which a read of it whole is checked against; a removed file names none",
    () =>
      Effect.gen(function* () {
        const headed = publishedPullRequestDrafted(() => false, LINE_HEAD);
        const blob = "b".repeat(40);
        const listed: RepositoryScript = (sent) =>
          new URL(sent.url).pathname.endsWith(`/pulls/${PUBLISHED.number}/files`)
            ? Response.json([
                {
                  filename: "src/seats.ts",
                  status: "modified",
                  additions: 1,
                  deletions: 1,
                  changes: 2,
                  patch: "@@ -1 +1 @@\n-a\n+b",
                  sha: blob,
                },
                {
                  filename: "src/gone.ts",
                  status: "removed",
                  additions: 0,
                  deletions: 1,
                  changes: 1,
                  patch: "@@ -1 +0,0 @@\n-a",
                  sha: "0".repeat(40),
                },
              ])
            : headed(sent);
        const { owner, agent, ask } = yield* published({ repository: listed });

        const changes = readAnswer(
          agentChangesAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(AGENT_CHANGES, owner, { id: agent.id })),
        );

        assert.deepEqual(
          changes.pullRequest?.files.map((file) => [file.path, file.blobSha]),
          [
            ["src/seats.ts", blob],
            ["src/gone.ts", undefined],
          ],
        );
      }),
  );

  it.effect(
    "a teammate reads which files they viewed on GitHub, every page of them, and marks and unmarks one, each on their own GitHub token",
    () =>
      Effect.gen(function* () {
        const { other, agent, calls, ask } = yield* published({
          otherToken: "ghu_teammate",
          answer: viewedAnswering,
        });

        const viewed = yield* ask(request(AGENT_PULL_REQUEST_VIEWED, other, { id: agent.id }));
        const marked = yield* ask(
          threadActionAs(other, agent.id, { action: "mark-file-viewed", path: "README.md" }),
        );
        const unmarked = yield* ask(
          threadActionAs(other, agent.id, { action: "unmark-file-viewed", path: "src/seats.ts" }),
        );

        assert.deepEqual(viewed, {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            outcome: "done",
            files: [
              { path: "src/seats.ts", state: "viewed" },
              { path: "src/plan.ts", state: "dismissed" },
              { path: "README.md", state: "unviewed" },
            ],
          },
        });
        assert.deepEqual(marked, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        assert.deepEqual(unmarked, { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "done" } });
        assert.deepEqual(
          calls
            .filter((call) => call.query.includes("viewerViewedState"))
            .map((call) => call.variables.after),
          [null, "cursor-2"],
        );
        assert.deepEqual(
          calls
            .filter((call) => call.query.includes("mutation"))
            .map((call) => [
              call.query.includes("unmarkFileAsViewed") ? "unmark" : "mark",
              call.variables,
            ]),
          [
            ["mark", { id: PULL_REQUEST_NODE_ID, path: "README.md" }],
            ["unmark", { id: PULL_REQUEST_NODE_ID, path: "src/seats.ts" }],
          ],
        );
        assert.ok(calls.every((call) => call.authorization === "Bearer ghu_teammate"));
      }),
  );

  it.effect(
    "a member with no GitHub sign-in, or one GitHub refuses, is asked to sign in before any viewed mark is read, never on the App's token",
    () =>
      Effect.gen(function* () {
        const unsigned = yield* published({ otherToken: null });
        assert.deepEqual(
          yield* unsigned.ask(
            request(AGENT_PULL_REQUEST_VIEWED, unsigned.other, { id: unsigned.agent.id }),
          ),
          { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "sign-in-required" } },
        );
        assert.deepEqual(unsigned.calls, []);

        const revoked = yield* published({
          otherToken: "ghu_revoked",
          answer: () => Response.json({ message: "Bad credentials" }, { status: 401 }),
        });
        assert.deepEqual(
          yield* revoked.ask(
            request(AGENT_PULL_REQUEST_VIEWED, revoked.other, { id: revoked.agent.id }),
          ),
          { status: HOSTED_HTTP_STATUS.OK, body: { outcome: "sign-in-required" } },
        );
        assert.ok(revoked.calls.every((call) => call.authorization === "Bearer ghu_revoked"));
      }),
  );

  it.effect(
    "an account outside the agent's workspace is answered as if the agent were none, and a change the wire does not name is refused, neither reaching GitHub",
    () =>
      Effect.gen(function* () {
        const { owner, other, agent, calls, ask } = yield* published({ otherJoins: false });

        assert.deepEqual(
          yield* ask(actionAs(other, agent.id, "ready-for-review")),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(actionAs(owner, agent.id, "merge-it-all")),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.deepEqual(calls, []);
      }),
  );
});

/** One REST write as GitHub saw it: the bearer, the method, the path, and the body. */
interface RestWrite {
  readonly authorization: string | null;
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/** The published pull request's repository, writing down every write to its requested reviewers or labels and answering it as `answer` says. */
function peopleAndLabelsAnswering(
  writes: RestWrite[],
  answer: (write: RestWrite) => Response = () => Response.json({}, { status: 201 }),
): RepositoryScript {
  return (sent) => {
    const path = decodeURIComponent(new URL(sent.url).pathname);
    const reviewersOrLabels = /\/(requested_reviewers|labels)(\/|$)/u.test(path);
    if (!reviewersOrLabels || sent.method === "GET") return publishedPullRequest(sent);
    const write = {
      authorization: sent.headers.get("authorization"),
      method: sent.method,
      path,
      body: sent.body === "" ? undefined : JSON.parse(sent.body),
    };
    writes.push(write);
    return answer(write);
  };
}

/** A change naming a reviewer or a label, as the bearer given. */
function changeAs(bearer: string, agentId: string, body: WireBoundaryInput): Request {
  return request(AGENT_PULL_REQUEST_ACTION, bearer, { method: "POST", id: agentId, body });
}

it.layer(getTestDB())("asking reviews and labelling an agent's pull request", (it) => {
  const published = (repository: RepositoryScript, otherToken = "ghu_teammate") =>
    Effect.gen(function* () {
      const opened = yield* openTask({ github: repository, otherToken });
      yield* joinWorkspace(opened.task.workspaceId, opened.other);
      const { agent } = yield* startedAgent(opened.owner, opened.task.id, opened.ask);
      yield* updateAgentBranch(opened.owner, agent.id, PUBLISHED.branch);
      return { ...opened, agent };
    });

  it.effect(
    "a teammate asks a review of a team, asks one of a user no longer, puts a label on and takes one off, each a REST write on the teammate's own token",
    () =>
      Effect.gen(function* () {
        const writes: RestWrite[] = [];
        const { other, agent, ask } = yield* published(peopleAndLabelsAnswering(writes));
        const pull = `/repos/${RELAY.owner}/${RELAY.name}/pulls/${PUBLISHED.number}`;
        const issue = `/repos/${RELAY.owner}/${RELAY.name}/issues/${PUBLISHED.number}`;

        const answers = [
          yield* ask(
            changeAs(other, agent.id, {
              action: "request-review",
              reviewer: { kind: "team", name: "reviewers" },
            }),
          ),
          yield* ask(
            changeAs(other, agent.id, {
              action: "remove-review-request",
              reviewer: { kind: "user", name: "priyan" },
            }),
          ),
          yield* ask(changeAs(other, agent.id, { action: "add-label", label: "bug" })),
          yield* ask(changeAs(other, agent.id, { action: "remove-label", label: "needs review" })),
        ];

        assert.ok(
          answers.every((answered) => answered.status === HOSTED_HTTP_STATUS.OK),
          "every change is answered",
        );
        assert.deepEqual(
          answers.map((answered) => answered.body),
          answers.map(() => ({ outcome: "done" })),
        );
        assert.deepEqual(
          writes.map(({ method, path, body }) => ({ method, path, body })),
          [
            {
              method: "POST",
              path: `${pull}/requested_reviewers`,
              body: { team_reviewers: ["reviewers"] },
            },
            {
              method: "DELETE",
              path: `${pull}/requested_reviewers`,
              body: { reviewers: ["priyan"] },
            },
            { method: "POST", path: `${issue}/labels`, body: { labels: ["bug"] } },
            { method: "DELETE", path: `${issue}/labels/needs review`, body: undefined },
          ],
        );
        assert.ok(writes.every((write) => write.authorization === "Bearer ghu_teammate"));
      }),
  );

  it.effect(
    "a review GitHub will not ask is answered in its words, and a reviewer the wire does not name is refused before GitHub",
    () =>
      Effect.gen(function* () {
        const writes: RestWrite[] = [];
        const { other, agent, ask } = yield* published(
          peopleAndLabelsAnswering(writes, () =>
            Response.json(
              { message: "Reviews may only be requested from collaborators." },
              { status: 422 },
            ),
          ),
        );

        assert.deepEqual(
          yield* ask(
            changeAs(other, agent.id, {
              action: "request-review",
              reviewer: { kind: "user", name: "stranger" },
            }),
          ),
          {
            status: HOSTED_HTTP_STATUS.OK,
            body: {
              outcome: "refused",
              words: "Reviews may only be requested from collaborators.",
            },
          },
        );
        assert.deepEqual(
          yield* ask(
            changeAs(other, agent.id, {
              action: "request-review",
              reviewer: { kind: "everyone", name: "all" },
            }),
          ),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.equal(writes.length, 1);
      }),
  );
});

const AGENT_REVIEW_OPTIONS = "/api/agents/review-options";

it.layer(getTestDB())("what the reviewer and label pickers offer", (it) => {
  it.effect(
    "the repository's labels, assignable users named against the workspace, and teams, read on the App's token; teams it may not read list none",
    () =>
      Effect.gen(function* () {
        const repository = `/repos/${RELAY.owner}/${RELAY.name}`;
        const asked: SentToGitHub[] = [];
        const { owner, task, ask } = yield* openTask({
          github: (sent) => {
            const path = new URL(sent.url).pathname;
            if (path.startsWith(repository)) asked.push(sent);
            switch (path) {
              case `${repository}/labels`:
                return Response.json([{ name: "bug", color: "d73a4a" }]);
              // Note that GitHub lists an installation token no collaborator whose access comes through the organization, so it answers none.
              case `${repository}/collaborators`:
                return Response.json([]);
              case `${repository}/assignees`:
                return Response.json([
                  {
                    login: "priyan",
                    id: 1002,
                    type: "User",
                    avatar_url: "https://avatars.githubusercontent.com/u/1002?v=4",
                  },
                ]);
              case `${repository}/teams`:
                return Response.json(
                  { message: "Resource not accessible by integration" },
                  { status: 403 },
                );
              default:
                return publishedPullRequest(sent);
            }
          },
        });
        const { agent } = yield* startedAgent(owner, task.id, ask);

        const answered = yield* ask(request(AGENT_REVIEW_OPTIONS, owner, { id: agent.id }));

        assert.deepEqual(answered, {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            labels: [{ name: "bug", color: "d73a4a" }],
            users: [
              {
                login: "priyan",
                bot: false,
                avatarUrl: "https://avatars.githubusercontent.com/u/1002?v=4",
              },
            ],
            teams: [],
          },
        });
        assert.ok(
          asked.every((sent) => !sent.headers.get("authorization")?.includes("ghu_")),
          "the repository is read on an installation token, never a member's",
        );
      }),
  );

  it.effect(
    "a listing GitHub did not answer fails the read rather than offering an empty list, so the picker reads it again",
    () =>
      Effect.gen(function* () {
        const repository = `/repos/${RELAY.owner}/${RELAY.name}`;
        const { owner, task, ask } = yield* openTask({
          github: (sent) =>
            new URL(sent.url).pathname === `${repository}/labels`
              ? Response.json({ message: "Service unavailable" }, { status: 503 })
              : new URL(sent.url).pathname.startsWith(`${repository}/`) &&
                  !new URL(sent.url).pathname.startsWith(`${repository}/pulls`)
                ? Response.json([])
                : publishedPullRequest(sent),
        });
        const { agent } = yield* startedAgent(owner, task.id, ask);

        const answered = yield* ask(request(AGENT_REVIEW_OPTIONS, owner, { id: agent.id }));

        assert.notEqual(answered.status, HOSTED_HTTP_STATUS.OK);
      }),
  );
});

it.layer(getTestDB())("an agent's kept pull request", (it) => {
  /** Where the published pull request stands on GitHub as a test moves it: when it merged, none while open, and whether GitHub refuses every read for its rate limit. */
  interface Standing {
    mergedAt: string | null;
    limited?: boolean;
    closed?: boolean;
  }

  const MERGED_AT = "2026-10-17T09:00:00Z";

  /** The repository answering the published pull request as `standing` holds it. */
  const standingPullRequest =
    (standing: Standing): RepositoryScript =>
    async (sent) => {
      const pull = `/repos/${RELAY.owner}/${RELAY.name}/pulls/${PUBLISHED.number}`;
      if (standing.limited === true) {
        return Response.json({ message: "API rate limit exceeded" }, { status: 429 });
      }
      const answered = await publishedPullRequest(sent);
      if (answered === undefined || new URL(sent.url).pathname !== pull) return answered;
      const merged = standing.mergedAt !== null;
      return Response.json({
        ...(await answered.json()),
        ...(merged || standing.closed === true ? { state: "closed" } : undefined),
        merged,
        merged_at: standing.mergedAt,
        additions: 4,
        head: { ref: PUBLISHED.branch, sha: PUBLISHED.headSha },
      });
    };

  /** The owner's agent on the published branch, its pull request answered as `standing` holds it, and a read of it the time given after the last, by default once its row no longer answers for being fresh. */
  const publishedAs = (standing: Standing) =>
    Effect.gen(function* () {
      const { owner, task, ask } = yield* openTask({ github: standingPullRequest(standing) });
      const { agent } = yield* startedAgent(owner, task.id, ask);
      yield* updateAgentBranch(owner, agent.id, PUBLISHED.branch);
      const readAfter = (wait: Duration.Duration) =>
        Effect.gen(function* () {
          yield* TestClock.adjust(wait);
          const answered = yield* ask(request(AGENT_PULL_REQUEST, owner, { id: agent.id }));
          assert.equal(answered.status, HOSTED_HTTP_STATUS.OK, JSON.stringify(answered.body));
          return answered.body;
        });
      const read = readAfter(CODER.PUBLISHED_ROW_FRESH);
      const kept = readAgentPublished(owner, agent.id);
      return { owner, agentId: agent.id, task, read, readAfter, kept };
    });

  it.effect(
    "a merged pull request is kept with the instant GitHub says it merged, while the tab's answer carries what it always did",
    () =>
      Effect.gen(function* () {
        const { read, kept } = yield* publishedAs({ mergedAt: MERGED_AT });

        const answered = yield* read;

        const stored = yield* kept;
        assert.equal(stored?.state, PULL_REQUEST_STATE.MERGED);
        assert.equal(stored?.mergedAt, Date.parse(MERGED_AT));
        assert.deepEqual(answered, {
          repository: RELAY_FULL_NAME,
          branch: PUBLISHED.branch,
          pullRequest: {
            number: PUBLISHED.number,
            title: "Expire teammate invitations",
            url: `https://github.com/${RELAY_FULL_NAME}/pull/${PUBLISHED.number}`,
            state: PULL_REQUEST_STATE.MERGED,
            checks: CHECK_SUMMARY.NONE,
            additions: 4,
            deletions: 1,
            changedFiles: 1,
          },
        });
      }),
  );

  it.effect(
    "an open pull request is kept with no merge instant, and with GitHub's once a later read finds it merged",
    () =>
      Effect.gen(function* () {
        const standing: Standing = { mergedAt: null };
        const { read, readAfter, kept } = yield* publishedAs(standing);

        const open = yield* read;
        assert.equal((yield* kept)?.mergedAt, undefined);

        standing.mergedAt = MERGED_AT;
        // A read within a minute of the last answers from the row, the instance's kept answer gone or not.
        assert.deepEqual(yield* readAfter(CODER.PUBLISHED_TTL), open);
        assert.equal((yield* kept)?.mergedAt, undefined);
        yield* read;
        assert.equal((yield* kept)?.mergedAt, Date.parse(MERGED_AT));
      }),
  );

  it.effect(
    "an archived agent's read answers the pull request its row keeps, without asking GitHub, which has since moved on",
    () =>
      Effect.gen(function* () {
        const standing: Standing = { mergedAt: null };
        const { owner, agentId, read } = yield* publishedAs(standing);
        const open = yield* read;

        yield* archiveAgent(owner, agentId, true);
        standing.mergedAt = MERGED_AT;

        assert.deepEqual(yield* read, open);
      }),
  );

  it.effect(
    "an ended agent's closed pull request reopened on GitHub reads open once the row's closed read is old, as no sweep reads a closed one again",
    () =>
      Effect.gen(function* () {
        const standing: Standing = { mergedAt: null, closed: true };
        const { readAfter } = yield* publishedAs(standing);
        // Long enough after its Start that the agent, which never ran a turn, has ended.
        const stateAfter = (wait: Duration.Duration) =>
          Effect.map(
            readAfter(wait),
            (body) =>
              readAnswer(agentPullRequestAnswerSchema, HOSTED_HTTP_STATUS.OK, {
                status: HOSTED_HTTP_STATUS.OK,
                body,
              }).pullRequest?.state,
          );
        assert.equal(yield* stateAfter(Duration.hours(1)), PULL_REQUEST_STATE.CLOSED);

        standing.closed = false;

        assert.equal(yield* stateAfter(Duration.hours(1)), PULL_REQUEST_STATE.OPEN);
      }),
  );

  it.effect(
    "a read GitHub refuses for its rate limit answers the pull request the row keeps rather than failing",
    () =>
      Effect.gen(function* () {
        const standing: Standing = { mergedAt: null };
        const { read } = yield* publishedAs(standing);
        const open = yield* read;

        standing.limited = true;

        assert.deepEqual(yield* read, open);
      }),
  );

  it.effect(
    "a read that first finds the pull request merged notes it for the owner's operator, and counts it, once however often it is read",
    () =>
      Effect.gen(function* () {
        const standing: Standing = { mergedAt: null };
        const { owner, task, read } = yield* publishedAs(standing);
        const operator = Option.getOrThrow(
          yield* createAgent(owner, {
            taskId: null,
            organizationId: task.workspaceId,
            planSnapshot: null,
            prompt: null,
            kind: AGENT_KIND.OPERATOR,
            idempotencyKey: randomUUID(),
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            repository: null,
          }),
        ).agent;
        const kinds = Effect.map(unreadOperatorNotices(operator.id, 10), (notices) =>
          notices.map(({ kind }) => kind),
        );

        yield* read;
        assert.deepEqual(yield* kinds, [], "an open pull request is no notice");
        standing.mergedAt = MERGED_AT;
        yield* read;
        yield* read;
        assert.deepEqual(yield* kinds, [OPERATOR_NOTICE_KIND.PR_MERGED]);
        assert.equal(countedFor(owner, SERVER_EVENT.PULL_REQUEST_MERGE), 1);
      }),
  );
});
