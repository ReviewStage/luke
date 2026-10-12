import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { BOARD_ELEMENT_TYPE } from "@sidecar/hosted/board-vocabulary";
import { boardAnswerSchema } from "@sidecar/hosted/board-wire";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentPullRequest,
  PULL_REQUEST_STATE,
} from "@sidecar/hosted/coding-agent-wire";
import { PLAN_EDIT_REFUSAL, planEditAnswerSchema } from "@sidecar/hosted/plan-edit";
import {
  PLAN_ACTOR,
  PLAN_FIELD,
  PLAN_FIELD_BOUNDS,
  PLAN_FILE_REFUSAL,
  PLAN_TREE_BOUNDS,
  PLAN_TREE_ENTRY,
  planAnswerSchema,
  planFileAnswerSchema,
  planListAnswerSchema,
  planRevisionAnswerSchema,
  planRevisionsAnswerSchema,
  planTreeAnswerSchema,
} from "@sidecar/hosted/plan-wire";
import { planWorkAnswerSchema } from "@sidecar/hosted/planning-view";
import {
  planTranscriptAnswerSchema,
  TRANSCRIPT_BOUNDS,
  TRANSCRIPT_PART_TYPE,
  type TranscriptMessage,
} from "@sidecar/hosted/transcript-wire";
import { TRANSCRIPT_SPEAKER } from "@sidecar/live";
import { TURN_ORIGIN, TURN_STATUS, unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { eq } from "drizzle-orm";
import { Clock, Duration, Effect, Layer, Option, Result, type Schema } from "effect";
import { TestClock } from "effect/testing";
import { HttpRouter } from "effect/unstable/http";
import { SqlClient } from "effect/unstable/sql";
import { user } from "../server/db/auth-schema";
import { planBoard } from "../server/db/plan-schema";
import { db } from "../server/db/query";
import { turns } from "../server/db/storage-schema";
import { voiceSessions, voiceTranscriptSegments } from "../server/db/voice-schema";
import {
  VOICE_DELEGATION_MODE,
  VOICE_SEGMENT_ROLE,
  type VoiceSegmentRole,
} from "../server/db/voice-vocabulary";
import {
  DRAW_ON_BOARD_REFUSAL,
  DRAW_ON_BOARD_STATUS,
  runDrawOnBoard,
} from "../server/hosted/board-tool";
import {
  type CodingAgent,
  createCodingAgent,
  recordCodingAgentPublished,
} from "../server/hosted/coding-agent-store";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../server/hosted/http";
import { PLAN_SAVE_STATUS, saveNotes } from "../server/hosted/plan-notes";
import { PLAN_REVISION } from "../server/hosted/plan-revisions";
import { personalWorkspaceOf } from "../server/hosted/workspace-store";
import { plansApp } from "../server/plans-app";
import {
  type FakeGitHub,
  fakeGitHub,
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  githubReaching,
  NO_GITHUB,
  openGithubUser,
  type SentToGitHub,
} from "./support/github-app-fake";
import { added, INVITATIONS_DRAFT, notesFor } from "./support/plan-contents";
import { dispatched } from "./support/platform-landing";
import { testSqlClient } from "./support/sql-client";
import { fakeWorkspaceSeams, joinWorkspace, openWorkspace, startPlan } from "./support/workspaces";

/**
 * The Plans tab's plan routes, answered by the group the way a
 * function answers them, over a real dialect: the bearer names the account
 * and nothing else does, a plan another account owns answers exactly as one
 * that does not exist, and what the notetaker's notes saved is what the window opens.
 * The path is the one the rewrite hands the group, the plan id moved from
 * the path into the `id` query. A plan's repository is kept only once the
 * Luke GitHub App, over a GitHub the test scripts, confirms the account
 * reaches it.
 *
 * Synthetic accounts, bearers, tokens, and repositories throughout.
 */

const ORIGIN = "https://luke.test";
const PLANS = "/api/plans";
const ONE_PLAN = "/api/plans/plan";
const BOARD = "/api/plans/board";
const TRANSCRIPT = "/api/plans/transcript";
const WORK = "/api/plans/work";
const FILE = "/api/plans/file";
const TREE = "/api/plans/tree";
const REVISIONS = "/api/plans/revisions";
const REVISION = "/api/plans/revision";
const RESTORE = "/api/plans/restore";
const EDIT = "/api/plans/edit";

const RELAY = {
  name: "Teammate invitations",
} as const;

const LEDGER = {
  name: "Billing export",
} as const;

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** A GitHub on which nobody reaches anything; the routes that read no repository never ask it. */
const UNREACHED_GITHUB: FakeGitHub = { layer: NO_GITHUB, sent: [] };

/**
 * Two accounts, each behind its own bearer. The owner signed in with GitHub
 * through the App; the other signed in with Google alone, and reaches
 * nothing on GitHub.
 */
const openAccounts = (github: FakeGitHub = UNREACHED_GITHUB) =>
  Effect.gen(function* () {
    const owner = yield* openGithubUser();
    const other = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: other, name: "Test User", email: `${other}@luke.test` });
    const bearers = new Map([
      [`Bearer ${owner}`, owner],
      [`Bearer ${other}`, other],
    ]);
    const ask = (request: Request, landedAs?: string) => answer(bearers, github, request, landedAs);
    return { owner, other, ask };
  });

/**
 * The group over the test's own database and the GitHub given, answering
 * one request: at the route's own path, or, where a route key is named, as
 * a client sends it, landed by the platform on a function holding the group
 * under that key.
 */
const answer = (
  bearers: ReadonlyMap<string, string>,
  github: FakeGitHub,
  request: Request,
  landedAs?: string,
) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    // The handler runs on the router's own fiber, so it is handed the test's clock: the account rows hang off it.
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      github.layer,
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      plansApp({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
          ),
        workspaces: yield* fakeWorkspaceSeams,
      }).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const response = yield* Effect.promise(() =>
      landedAs === undefined
        ? handler(request)
        : dispatched(request, new Map([[landedAs, { fetch: (each) => handler(each) }]])),
    );
    // SAFETY: the group answers JSON; the test compares it as the wire value it is.
    const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
    yield* Effect.promise(() => dispose());
    return { status: response.status, body } satisfies Answer;
  });

function request(
  path: string,
  userId: string | undefined,
  init: {
    method?: string;
    body?: WireBoundaryInput;
    id?: string;
    command?: string;
    query?: Readonly<Record<string, string>>;
  } = {},
): Request {
  const url = new URL(path, ORIGIN);
  if (init.id !== undefined) url.searchParams.set("id", init.id);
  for (const [name, value] of Object.entries(init.query ?? {})) url.searchParams.set(name, value);
  if (init.command !== undefined) url.searchParams.set("command", init.command);
  return new Request(url, {
    method: init.method ?? "GET",
    headers: userId === undefined ? {} : { authorization: `Bearer ${userId}` },
    ...(init.body === undefined ? undefined : { body: JSON.stringify(init.body) }),
  });
}

/** An answer read as the wire declares it, failing the test where it is not one. */
function readAnswer<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  status: number,
  answered: Answer,
): S["Type"] {
  assert.equal(answered.status, status);
  const read = readEither(schema)(unparsedWire(answered.body));
  if (Result.isFailure(read))
    return assert.fail(`the answer is not the wire's: ${read.failure.refusal}`);
  return read.success;
}

/** The started plan's id, failing the test where the answer is not a started plan. */
function startedId(started: Answer): string {
  return readAnswer(planAnswerSchema, HOSTED_HTTP_STATUS.CREATED, started).plan.id;
}

const refusal = (status: number, error: string): Answer => ({ status, body: { error } });

/** What the contents API holds of the fixture repository, by path: a file's text, a directory, a link, or a file past the bound. */
const CONTENTS = new Map([
  ["src/invite.ts", () => fileContents("one\ntwo\n" + "x".repeat(500) + "\nfour")],
  ["assets/logo.png", () => fileContents("\u0089PNG\u0000\u0000")],
  [
    "big.json",
    () => Response.json({ type: "file", size: 2 * 1024 * 1024, encoding: "none", content: "" }),
  ],
  ["src", () => Response.json([{ type: "file", name: "invite.ts" }])],
  ["linked.ts", () => Response.json({ type: "symlink", target: "../outside.ts" })],
]);

/** The contents API's answer for a regular file of the text given. */
function fileContents(text: string): Response {
  const bytes = Buffer.from(text);
  return Response.json({
    type: "file",
    size: bytes.length,
    encoding: "base64",
    content: bytes.toString("base64"),
  });
}

const CONTENTS_PATH = /^\/repos\/Acme\/Relay\/contents\/(.+)$/u;

/** The fixture repository's contents, as GitHub answers them on the repository's own paths. */
function contentsOf(sent: SentToGitHub): Response | undefined {
  const named = CONTENTS_PATH.exec(new URL(sent.url).pathname);
  if (named === null) return undefined;
  const contents = CONTENTS.get(decodeURIComponent(named[1] ?? ""));
  return contents === undefined
    ? Response.json({ message: "Not Found" }, { status: 404 })
    : contents();
}

/** One entry of a tree as the git trees API answers it. */
const gitEntry = (path: string, type: string, mode: string) => ({
  path,
  mode,
  type,
  sha: "0".repeat(40),
});

/** What the git trees API holds of the fixture repository, by tree-ish: the root, a folder, a folder past the bound, one GitHub cut short, and a folder GitHub fails on. */
const TREES = new Map<string, () => Response>([
  [
    "main:",
    () =>
      Response.json({
        tree: [
          gitEntry(".env", "blob", "100644"),
          gitEntry(".env.d", "tree", "040000"),
          gitEntry("README.md", "blob", "100644"),
          gitEntry("linked.ts", "blob", "120000"),
          gitEntry("src", "tree", "040000"),
          gitEntry("vendor", "commit", "160000"),
        ],
        truncated: false,
      }),
  ],
  [
    "main:src",
    () => Response.json({ tree: [gitEntry("invite.ts", "blob", "100644")], truncated: false }),
  ],
  [
    "main:generated",
    () =>
      Response.json({
        tree: Array.from({ length: PLAN_TREE_BOUNDS.MAX_ENTRIES + 1 }, (_, at) =>
          gitEntry(`file-${at}.ts`, "blob", "100644"),
        ),
        truncated: false,
      }),
  ],
  [
    "main:huge",
    () => Response.json({ tree: [gitEntry("a.ts", "blob", "100644")], truncated: true }),
  ],
  [
    "main:README.md",
    () => Response.json({ message: "Invalid object requested." }, { status: 422 }),
  ],
  ["main:flaky", () => Response.json({ message: "Server Error" }, { status: 502 })],
]);

const TREES_PATH = /^\/repos\/Acme\/Relay\/git\/trees\/(.+)$/u;

/** The fixture repository's files and folders, as GitHub answers them on the repository's own paths. */
function repositoryOf(sent: SentToGitHub): Response | undefined {
  const named = TREES_PATH.exec(new URL(sent.url).pathname);
  if (named === null) return contentsOf(sent);
  const tree = TREES.get(decodeURIComponent(named[1] ?? ""));
  return tree === undefined ? Response.json({ message: "Not Found" }, { status: 404 }) : tree();
}

const RELAY_REACHED = [{ id: 1, login: "Acme", repositories: [{ owner: "Acme", name: "Relay" }] }];

/** A note the developer drew, as the canvas would send it. */
const NOTE = {
  id: "dev-note",
  type: BOARD_ELEMENT_TYPE.TEXT,
  x: 0,
  y: 200,
  width: 120,
  height: 25,
  text: "Rate limit invites",
  fontFamily: 5,
} as const;

/** One fragment said on a call: who, the words as the delta carried them, and the span on the call's clock. */
type Said = readonly [role: VoiceSegmentRole, text: string, startMs: number];

/** A call about the plan, started at the instant given, with the fragments said on it in the order they were written. */
const callAbout = (
  input: { userId: string; planId: string; startedAt: number },
  said: readonly Said[],
) =>
  Effect.gen(function* () {
    const [row] = yield* db
      .insert(voiceSessions)
      .values({
        userId: input.userId,
        planId: input.planId,
        liveSessionId: `live_t_${randomUUID()}`,
        delegationMode: VOICE_DELEGATION_MODE.CLIENT,
        startedAt: new Date(input.startedAt),
      })
      .returning({ id: voiceSessions.id });
    assert.ok(row);
    if (said.length > 0) {
      yield* db.insert(voiceTranscriptSegments).values(
        said.map(([role, text, startMs], seq) => ({
          voiceSessionId: row.id,
          seq,
          role,
          text,
          startMs,
          endMs: startMs + 500,
        })),
      );
    }
    return row.id;
  });

/** One line as the transcript answers it: its place on the call, the speaker as the role, the words as one text part. */
function spoken(index: number, role: TranscriptMessage["role"], text: string): TranscriptMessage {
  return { id: String(index), role, parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text }] };
}

/** Luke's drawing of one labelled box. */
const DRAW_API = {
  elements: [{ type: BOARD_ELEMENT_TYPE.RECTANGLE, id: "api", x: 0, y: 0, label: "API" }],
};

/** An agent started on the account's plan now, on the test's clock, failing the test where the Start made none. */
const startAgent = (userId: string, planId: string) =>
  Effect.map(
    createCodingAgent(userId, {
      planId,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: "Acme/Relay",
      planSnapshot: "# Teammate invitations\n",
      task: null,
    }),
    (started) => Option.getOrElse(started, () => assert.fail("the start made no agent")).agent,
  );

/** One turn of the agent's, queued and started at `startedAt` and, where given, ended at `settledAt`. */
const agentTurn = (
  userId: string,
  agent: CodingAgent,
  turn: { readonly startedAt: number; readonly settledAt?: number },
) =>
  db.insert(turns).values({
    userId,
    conversationId: agent.conversationId,
    origin: TURN_ORIGIN.TYPED,
    status: turn.settledAt === undefined ? TURN_STATUS.RUNNING : TURN_STATUS.SETTLED,
    queuedAt: new Date(turn.startedAt),
    startedAt: new Date(turn.startedAt),
    settledAt: turn.settledAt === undefined ? null : new Date(turn.settledAt),
  });

/** A pull request as GitHub answered a read of it. */
const PULL_REQUEST: CodingAgentPullRequest = {
  number: 128,
  title: "Invite teammates by email",
  url: "https://github.com/Acme/Relay/pull/128",
  state: PULL_REQUEST_STATE.OPEN,
  checks: CHECK_SUMMARY.FAILING,
  additions: 214,
  deletions: 9,
  changedFiles: 6,
};

it.layer(testSqlClient)("the plan routes", (it) => {
  it.effect(
    "a listed plan names its open pull request among the few it carries, ahead of newer merged and closed ones",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const plan = yield* startPlan(owner, { name: RELAY.name });
        const states = [
          PULL_REQUEST_STATE.OPEN,
          PULL_REQUEST_STATE.CLOSED,
          PULL_REQUEST_STATE.MERGED,
          PULL_REQUEST_STATE.CLOSED,
        ];
        for (const [index, state] of states.entries()) {
          const agent = yield* startAgent(owner, plan.id);
          yield* recordCodingAgentPublished(owner, agent.id, {
            ...PULL_REQUEST,
            number: index + 1,
            state,
          });
          yield* TestClock.adjust("1 minute");
        }

        const { plans } = readAnswer(
          planListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(PLANS, owner)),
        );

        const agents = plans.find((listed) => listed.id === plan.id)?.agents;
        assert.equal(agents?.pullRequestTotal, 4);
        assert.deepEqual(
          agents?.pullRequests.map((pullRequest) => [pullRequest.number, pullRequest.state]),
          [
            [1, PULL_REQUEST_STATE.OPEN],
            [3, PULL_REQUEST_STATE.MERGED],
            [4, PULL_REQUEST_STATE.CLOSED],
          ],
        );
      }),
  );

  it.effect(
    "a listed plan says what its coding agents are doing and what they published, and a plan with none says nothing",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const quiet = yield* startPlan(owner, { name: LEDGER.name });
        const busy = yield* startPlan(owner, { name: RELAY.name });
        const failed = yield* startAgent(owner, busy.id);
        yield* TestClock.adjust("1 minute");
        const first = yield* startAgent(owner, busy.id);
        yield* agentTurn(owner, first, { startedAt: 61_000, settledAt: 90_000 });
        yield* recordCodingAgentPublished(owner, first.id, PULL_REQUEST);
        yield* TestClock.adjust("1 minute");
        // A second agent on the same branch answers the same pull request, which is counted once.
        const second = yield* startAgent(owner, busy.id);
        yield* agentTurn(owner, second, { startedAt: 121_000, settledAt: 150_000 });
        yield* recordCodingAgentPublished(owner, second.id, PULL_REQUEST);
        yield* TestClock.adjust("1 minute");
        const working = yield* startAgent(owner, busy.id);
        yield* agentTurn(owner, working, { startedAt: 185_000 });
        // Past the first agent's grace with no turn: it reads as failed.
        yield* TestClock.adjust("5 minutes");

        const { plans } = readAnswer(
          planListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(PLANS, owner)),
        );

        const listed = new Map(plans.map((plan) => [plan.id, plan]));
        assert.equal(listed.get(quiet.id)?.agents, undefined);
        const agents = listed.get(busy.id)?.agents;
        assert.ok(agents);
        assert.equal(agents.total, 4);
        assert.equal(agents.working, 1);
        assert.deepEqual(
          agents.agents.map((agent) => [agent.id, agent.status, agent.at]),
          [
            [working.id, CODING_AGENT_STATUS.RUNNING, 185_000],
            [second.id, CODING_AGENT_STATUS.COMPLETED, 150_000],
            [first.id, CODING_AGENT_STATUS.COMPLETED, 90_000],
          ],
        );
        assert.ok(!agents.agents.some((agent) => agent.id === failed.id));
        assert.equal(agents.pullRequestTotal, 1);
        assert.deepEqual(agents.pullRequests, [
          {
            number: 128,
            title: "Invite teammates by email",
            state: PULL_REQUEST_STATE.OPEN,
            checks: CHECK_SUMMARY.FAILING,
            additions: 214,
            deletions: 9,
          },
        ]);
      }),
  );

  it.effect("a started plan lists, and opens with what its notes saved", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));
      const saved = yield* saveNotes({ userId: owner, planId }, notesFor(INVITATIONS_DRAFT));
      assert.equal(saved.status, PLAN_SAVE_STATUS.SAVED);

      const listed = yield* ask(request(PLANS, owner));
      const opened = yield* ask(request(ONE_PLAN, owner, { id: planId }));

      assert.deepEqual(
        readAnswer(planListAnswerSchema, HOSTED_HTTP_STATUS.OK, listed).plans.map((plan) => [
          plan.id,
          plan.name,
        ]),
        [[planId, RELAY.name]],
      );
      assert.deepEqual(
        readAnswer(planAnswerSchema, HOSTED_HTTP_STATUS.OK, opened).plan.document,
        saved.status === PLAN_SAVE_STATUS.SAVED ? saved.document : undefined,
      );
    }),
  );

  it.effect("opening a plan leaves the list newest started first", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      const relayId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));
      yield* TestClock.adjust("1 minute");
      const ledgerId = startedId(
        yield* ask(request(PLANS, owner, { method: "POST", body: LEDGER })),
      );
      yield* TestClock.adjust("1 minute");

      const opened = yield* ask(request(ONE_PLAN, owner, { id: relayId }));
      const listed = yield* ask(request(PLANS, owner));

      assert.equal(opened.status, HOSTED_HTTP_STATUS.OK);
      assert.deepEqual(
        readAnswer(planListAnswerSchema, HOSTED_HTTP_STATUS.OK, listed).plans.map(
          (plan) => plan.id,
        ),
        [ledgerId, relayId],
      );
    }),
  );

  it.effect("a listed plan still carries the openedAt a desktop through v0.7.1 requires", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      yield* ask(request(PLANS, owner, { method: "POST", body: RELAY }));

      const listed = yield* ask(request(PLANS, owner));

      const [plan] = readAnswer(planListAnswerSchema, HOSTED_HTTP_STATUS.OK, listed).plans;
      assert.ok(plan);
      assert.equal(plan.openedAt, plan.createdAt);
    }),
  );

  it.effect("a start that names no workspace lands in the account's personal one", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();

      const started = yield* ask(request(PLANS, owner, { method: "POST", body: RELAY }));
      yield* ask(request(PLANS, owner, { method: "POST", body: LEDGER }));

      const personal = yield* personalWorkspaceOf(owner);
      assert.ok(Option.isSome(personal));
      assert.equal(
        readAnswer(planAnswerSchema, HOSTED_HTTP_STATUS.CREATED, started).plan.workspaceId,
        personal.value,
      );
      const listed = yield* ask(request(PLANS, owner));
      assert.deepEqual(
        readAnswer(planListAnswerSchema, HOSTED_HTTP_STATUS.OK, listed).plans.map(
          (plan) => plan.workspaceId,
        ),
        [personal.value, personal.value],
      );
    }),
  );

  it.effect("a member starts a plan in a workspace a teammate made", () =>
    Effect.gen(function* () {
      const { owner, other, ask } = yield* openAccounts();
      const shared = yield* openWorkspace(other);
      yield* joinWorkspace(shared, owner);

      const started = yield* ask(
        request(PLANS, owner, { method: "POST", body: { ...RELAY, workspaceId: shared } }),
      );

      assert.equal(
        readAnswer(planAnswerSchema, HOSTED_HTTP_STATUS.CREATED, started).plan.workspaceId,
        shared,
      );
      const listed = yield* ask(request(PLANS, owner));
      assert.deepEqual(
        readAnswer(planListAnswerSchema, HOSTED_HTTP_STATUS.OK, listed).plans.map((plan) => [
          plan.name,
          plan.workspaceId,
        ]),
        [[RELAY.name, shared]],
      );
    }),
  );

  it.effect(
    "a start in a workspace the account is not in answers as none, and starts nothing",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const theirs = yield* openWorkspace(other);

        const refused = yield* ask(
          request(PLANS, owner, { method: "POST", body: { ...RELAY, workspaceId: theirs } }),
        );
        const unknown = yield* ask(
          request(PLANS, owner, { method: "POST", body: { ...RELAY, workspaceId: "nowhere" } }),
        );

        const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);
        assert.deepEqual(refused, notFound);
        assert.deepEqual(unknown, notFound);
        const listed = yield* ask(request(PLANS, owner));
        assert.deepEqual(readAnswer(planListAnswerSchema, HOSTED_HTTP_STATUS.OK, listed).plans, []);
      }),
  );

  it.effect(
    "a pin and an archive answer the plan stamped, and the plain list a build from before archiving reads leaves the archived plan out",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const relayId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        yield* TestClock.adjust("1 minute");
        const ledgerId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: LEDGER })),
        );
        const change = (planId: string, body: WireBoundaryInput) =>
          ask(request(ONE_PLAN, owner, { id: planId, method: "PATCH", body }));
        const listIds = (query?: Readonly<Record<string, string>>) =>
          Effect.map(ask(request(PLANS, owner, query === undefined ? {} : { query })), (listed) =>
            readAnswer(planListAnswerSchema, HOSTED_HTTP_STATUS.OK, listed).plans.map(
              ({ id, pinnedAt, archivedAt }) => [
                id,
                pinnedAt !== undefined,
                archivedAt !== undefined,
              ],
            ),
          );

        const pinned = readAnswer(
          planAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* change(ledgerId, { pinned: true }),
        ).plan;
        const archived = readAnswer(
          planAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* change(relayId, { archived: true }),
        ).plan;

        assert.notEqual(pinned.pinnedAt, undefined);
        assert.notEqual(archived.archivedAt, undefined);
        assert.deepEqual(yield* listIds(), [[ledgerId, true, false]]);
        assert.deepEqual(yield* listIds({ archived: "include" }), [
          [ledgerId, true, false],
          [relayId, false, true],
        ]);
        assert.deepEqual(yield* listIds({ archived: "everything" }), [[ledgerId, true, false]]);

        yield* change(relayId, { archived: false });
        yield* change(ledgerId, { pinned: false });
        assert.deepEqual(yield* listIds(), [
          [ledgerId, false, false],
          [relayId, false, false],
        ]);
      }),
  );

  it.effect(
    "a pin or an archive that is not a yes or a no is refused, and another account's plan is none",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        const change = (userId: string, body: WireBoundaryInput) =>
          ask(request(ONE_PLAN, userId, { id: planId, method: "PATCH", body }));
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
        const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);

        assert.deepEqual(
          [
            yield* change(owner, { pinned: "yes" }),
            yield* change(owner, { archived: null }),
            yield* change(owner, {}),
          ],
          [invalid, invalid, invalid],
        );
        assert.deepEqual(
          [yield* change(other, { pinned: true }), yield* change(other, { archived: true })],
          [notFound, notFound],
        );
        const listed = readAnswer(
          planListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(PLANS, owner)),
        );
        assert.deepEqual(
          listed.plans.map(({ id, pinnedAt, archivedAt }) => [id, pinnedAt, archivedAt]),
          [[planId, undefined, undefined]],
        );
      }),
  );

  it.effect(
    "an archived plan takes no edit, restore, scene, rename, or repository of the developer's until it is brought back, while notes under way still land",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        yield* saveNotes({ userId: owner, planId }, notesFor(INVITATIONS_DRAFT));
        const change = (body: WireBoundaryInput) =>
          ask(request(ONE_PLAN, owner, { id: planId, method: "PATCH", body }));
        const edit = () =>
          ask(
            request(EDIT, owner, {
              id: planId,
              method: "POST",
              body: { field: PLAN_FIELD.DECISIONS, base: null, value: "Invites expire." },
            }),
          );
        const archived = refusal(HOSTED_HTTP_STATUS.CONFLICT, HOSTED_API_ERROR.PLAN_ARCHIVED);
        yield* change({ archived: true });

        assert.deepEqual(
          [
            yield* edit(),
            yield* ask(
              request(RESTORE, owner, { id: planId, method: "POST", query: { seq: "1" } }),
            ),
            yield* ask(
              request(BOARD, owner, {
                method: "PUT",
                id: planId,
                body: { elements: [NOTE], appliedDrawing: 0 },
              }),
            ),
            yield* change({ name: "Team invites" }),
            yield* change({ repository: null }),
          ],
          [archived, archived, archived, archived, archived],
        );
        // The archive takes no new work and loses none under way: a call's notes still land.
        const noted = yield* saveNotes({ userId: owner, planId }, [
          added(PLAN_FIELD.DECISIONS, "Invites expire after a week."),
        ]);
        assert.equal(noted.status, PLAN_SAVE_STATUS.SAVED);
        const held = readAnswer(
          planAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(ONE_PLAN, owner, { id: planId })),
        ).plan;
        assert.equal(held.name, RELAY.name);
        assert.equal(held.fields?.decisions, "Invites expire after a week.");
        assert.deepEqual(yield* ask(request(BOARD, owner, { id: planId })), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { board: { elements: [], appliedDrawing: 0 } },
        });

        // Brought back in the same change as a rename, it takes both, and the developer's edits again.
        const back = readAnswer(
          planAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* change({ archived: false, name: "Team invites" }),
        ).plan;
        assert.equal(back.archivedAt, undefined);
        assert.equal(back.name, "Team invites");
        const saved = readAnswer(planEditAnswerSchema, HOSTED_HTTP_STATUS.OK, yield* edit());
        assert.ok("plan" in saved, "the developer's edit is taken again");
      }),
  );

  it.effect("another account's plan answers as none on every route", () =>
    Effect.gen(function* () {
      const { owner, other, ask } = yield* openAccounts();
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));
      const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);

      assert.deepEqual(yield* ask(request(ONE_PLAN, other, { id: planId })), notFound);
      assert.deepEqual(
        yield* ask(request(ONE_PLAN, other, { id: planId, method: "DELETE" })),
        notFound,
      );
      assert.deepEqual(yield* ask(request(PLANS, other)), {
        status: HOSTED_HTTP_STATUS.OK,
        body: { plans: [] },
      });
      assert.equal(
        (yield* ask(request(ONE_PLAN, owner, { id: planId }))).status,
        HOSTED_HTTP_STATUS.OK,
      );
    }),
  );

  it.effect(
    "the developer's edit of a field answers the plan as saved, written by them, and it opens that way",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );

        const edited = yield* ask(
          request(EDIT, owner, {
            id: planId,
            method: "POST",
            body: {
              field: PLAN_FIELD.DECISIONS,
              base: null,
              value: " Invites expire after 7 days. ",
            },
          }),
        );

        const answered = readAnswer(planEditAnswerSchema, HOSTED_HTTP_STATUS.OK, edited);
        assert.ok("plan" in answered);
        assert.equal(answered.plan.fields?.decisions, "Invites expire after 7 days.");
        assert.equal(answered.plan.lastEdit?.actor, PLAN_ACTOR.DEVELOPER);
        const { plan } = readAnswer(
          planAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(ONE_PLAN, owner, { id: planId })),
        );
        assert.deepEqual(plan.document, answered.plan.document);
      }),
  );

  it.effect(
    "an edit whose base the field no longer holds answers it as it stands; one past the plan's bound is refused",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        yield* saveNotes({ userId: owner, planId }, notesFor(INVITATIONS_DRAFT));
        const edit = (body: WireBoundaryInput) =>
          ask(request(EDIT, owner, { id: planId, method: "POST", body }));

        const conflicted = yield* edit({ field: PLAN_FIELD.PROBLEM, base: null, value: null });
        const oversized = yield* edit({
          field: PLAN_FIELD.DECISIONS,
          base: null,
          value: "x".repeat(PLAN_FIELD_BOUNDS.MAX_ANSWER_CHARS),
        });

        assert.deepEqual(conflicted, {
          status: HOSTED_HTTP_STATUS.OK,
          body: { conflict: { current: INVITATIONS_DRAFT.fields.goal.problem } },
        });
        assert.deepEqual(oversized, {
          status: HOSTED_HTTP_STATUS.OK,
          body: { refused: PLAN_EDIT_REFUSAL.TOO_LONG },
        });
      }),
  );

  it.effect(
    "an edit of another account's plan answers as none, and one that does not read is refused",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        const body = { field: PLAN_FIELD.DECISIONS, base: null, value: "Invites expire." };

        assert.deepEqual(
          yield* ask(request(EDIT, other, { id: planId, method: "POST", body })),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(
            request(EDIT, owner, {
              id: planId,
              method: "POST",
              body: { field: PLAN_FIELD.RULES, base: null, value: "Not a text field." },
            }),
          ),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.deepEqual(
          yield* ask(request(EDIT, owner, { id: planId, method: "GET" })),
          refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
        );
      }),
  );

  it.effect("a deleted plan no longer opens or lists", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));

      const deleted = yield* ask(request(ONE_PLAN, owner, { id: planId, method: "DELETE" }));

      assert.deepEqual(deleted, { status: HOSTED_HTTP_STATUS.OK, body: { deleted: true } });
      assert.deepEqual(
        yield* ask(request(ONE_PLAN, owner, { id: planId })),
        refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
      );
      assert.deepEqual(yield* ask(request(PLANS, owner)), {
        status: HOSTED_HTTP_STATUS.OK,
        body: { plans: [] },
      });
    }),
  );

  it.effect("a rename answers the plan under its new name, trimmed, and it lists that way", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));

      const renamed = yield* ask(
        request(ONE_PLAN, owner, {
          id: planId,
          method: "PATCH",
          body: { name: "  Team invites " },
        }),
      );

      const { plan } = readAnswer(planAnswerSchema, HOSTED_HTTP_STATUS.OK, renamed);
      assert.equal(plan.name, "Team invites");
      assert.ok(plan.document.body.startsWith("# Team invites\n"));
      const listed = readAnswer(
        planListAnswerSchema,
        HOSTED_HTTP_STATUS.OK,
        yield* ask(request(PLANS, owner)),
      );
      assert.deepEqual(
        listed.plans.map(({ name }) => name),
        ["Team invites"],
      );
    }),
  );

  it.effect(
    "a blank, overlong, or widened rename is refused, and another account's plan is none",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        const rename = (userId: string, body: WireBoundaryInput) =>
          ask(request(ONE_PLAN, userId, { id: planId, method: "PATCH", body }));
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);

        assert.deepEqual(
          [
            yield* rename(owner, { name: "" }),
            yield* rename(owner, { name: "   " }),
            yield* rename(owner, { name: "x".repeat(201) }),
            yield* rename(owner, { name: "Team invites", userId: other }),
          ],
          [invalid, invalid, invalid, invalid],
        );
        assert.deepEqual(
          yield* rename(other, { name: "Mine now" }),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        const opened = readAnswer(
          planAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(ONE_PLAN, owner, { id: planId })),
        );
        assert.equal(opened.plan.name, RELAY.name);
      }),
  );

  it.effect(
    "a start that names an account, or a repository in no shape GitHub spells, is refused",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
        const start = (body: WireBoundaryInput) =>
          ask(request(PLANS, owner, { method: "POST", body }));

        const naming = yield* start({ ...RELAY, userId: other });
        const shaped = yield* start({
          name: RELAY.name,
          repository: { owner: "acme", name: "relay" },
        });
        const pathed = yield* start({ name: RELAY.name, repository: "acme/../relay" });
        const bare = yield* start({ name: RELAY.name, repository: "relay" });

        assert.deepEqual([naming, shaped, pathed, bare], [invalid, invalid, invalid, invalid]);
        assert.deepEqual(yield* ask(request(PLANS, owner)), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { plans: [] },
        });
      }),
  );

  it.effect("a plan starts with no repository, which lists and opens as null", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));

      const listed = readAnswer(
        planListAnswerSchema,
        HOSTED_HTTP_STATUS.OK,
        yield* ask(request(PLANS, owner)),
      );
      const opened = readAnswer(
        planAnswerSchema,
        HOSTED_HTTP_STATUS.OK,
        yield* ask(request(ONE_PLAN, owner, { id: planId })),
      );

      assert.equal(listed.plans[0]?.repository, null);
      assert.equal(opened.plan.repository, null);
    }),
  );

  it.effect(
    "a start naming a repository the App reaches keeps it as GitHub spells it, and a change may clear it",
    () =>
      Effect.gen(function* () {
        const github = githubReaching([
          { id: 1, login: "Acme", repositories: [{ owner: "Acme", name: "Relay" }] },
        ]);
        const { owner, ask } = yield* openAccounts(github);

        const started = yield* ask(
          request(PLANS, owner, { method: "POST", body: { ...RELAY, repository: "acme/relay" } }),
        );
        const planId = startedId(started);
        const cleared = yield* ask(
          request(ONE_PLAN, owner, { id: planId, method: "PATCH", body: { repository: null } }),
        );

        assert.equal(
          readAnswer(planAnswerSchema, HOSTED_HTTP_STATUS.CREATED, started).plan.repository,
          "Acme/Relay",
        );
        assert.equal(
          readAnswer(planAnswerSchema, HOSTED_HTTP_STATUS.OK, cleared).plan.repository,
          null,
        );
        const listed = readAnswer(
          planListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(PLANS, owner)),
        );
        assert.deepEqual(
          listed.plans.map((plan) => plan.repository),
          [null],
        );
      }),
  );

  it.effect("a change sets the repository, or the name and the repository at once", () =>
    Effect.gen(function* () {
      const github = githubReaching([
        {
          id: 1,
          login: "acme",
          repositories: [
            { owner: "acme", name: "relay" },
            { owner: "acme", name: "ledger" },
          ],
        },
      ]);
      const { owner, ask } = yield* openAccounts(github);
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));
      const change = (body: WireBoundaryInput) =>
        ask(request(ONE_PLAN, owner, { id: planId, method: "PATCH", body }));

      const relay = yield* change({ repository: "acme/relay" });
      const both = yield* change({ name: "Billing export", repository: "acme/ledger" });

      assert.equal(
        readAnswer(planAnswerSchema, HOSTED_HTTP_STATUS.OK, relay).plan.repository,
        "acme/relay",
      );
      const changed = readAnswer(planAnswerSchema, HOSTED_HTTP_STATUS.OK, both).plan;
      assert.deepEqual([changed.name, changed.repository], ["Billing export", "acme/ledger"]);
      assert.ok(changed.document.body.startsWith("# Billing export\n"));
    }),
  );

  it.effect(
    "a repository the App reaches no installation of for the account is refused, and nothing is written",
    () =>
      Effect.gen(function* () {
        const github = githubReaching([
          { id: 1, login: "acme", repositories: [{ owner: "acme", name: "relay" }] },
        ]);
        const { owner, ask } = yield* openAccounts(github);
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        const notReachable = refusal(
          HOSTED_HTTP_STATUS.FORBIDDEN,
          HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
        );

        const unchosen = yield* ask(
          request(PLANS, owner, { method: "POST", body: { ...RELAY, repository: "acme/ledger" } }),
        );
        const elsewhere = yield* ask(
          request(ONE_PLAN, owner, {
            id: planId,
            method: "PATCH",
            body: { name: "Team invites", repository: "octocat/relay" },
          }),
        );

        assert.deepEqual([unchosen, elsewhere], [notReachable, notReachable]);
        const opened = readAnswer(
          planAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(ONE_PLAN, owner, { id: planId })),
        );
        assert.deepEqual([opened.plan.name, opened.plan.repository], [RELAY.name, null]);
        assert.equal(
          readAnswer(planListAnswerSchema, HOSTED_HTTP_STATUS.OK, yield* ask(request(PLANS, owner)))
            .plans.length,
          1,
        );
      }),
  );

  it.effect(
    "an account GitHub no longer reads for, or that never signed in with GitHub, must sign in again before naming a repository",
    () =>
      Effect.gen(function* () {
        const revoked = fakeGitHub(() =>
          Response.json({ message: "Bad credentials" }, { status: 401 }),
        );
        const { owner, other, ask } = yield* openAccounts(revoked);
        const signIn = refusal(
          HOSTED_HTTP_STATUS.FORBIDDEN,
          HOSTED_API_ERROR.GITHUB_SIGN_IN_REQUIRED,
        );
        const start = (userId: string) =>
          ask(
            request(PLANS, userId, {
              method: "POST",
              body: { ...RELAY, repository: "acme/relay" },
            }),
          );

        assert.deepEqual([yield* start(owner), yield* start(other)], [signIn, signIn]);
        assert.deepEqual(yield* ask(request(PLANS, owner)), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { plans: [] },
        });
      }),
  );

  it.effect(
    "a GitHub that could not be read leaves the plan unchanged and answers unavailable",
    () =>
      Effect.gen(function* () {
        const down = fakeGitHub(() => new Response(null, { status: 503 }));
        const { owner, ask } = yield* openAccounts(down);
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );

        const changed = yield* ask(
          request(ONE_PLAN, owner, {
            id: planId,
            method: "PATCH",
            body: { repository: "acme/relay" },
          }),
        );

        assert.deepEqual(
          changed,
          refusal(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE),
        );
        assert.equal(
          readAnswer(
            planAnswerSchema,
            HOSTED_HTTP_STATUS.OK,
            yield* ask(request(ONE_PLAN, owner, { id: planId })),
          ).plan.repository,
          null,
        );
      }),
  );

  it.effect("a change naming nothing to change is refused", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));

      assert.deepEqual(
        yield* ask(request(ONE_PLAN, owner, { id: planId, method: "PATCH", body: {} })),
        refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
      );
    }),
  );

  it.effect(
    "a board reads empty, holds Luke's latest drawing for the Mac, and keeps the scene the Mac writes",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        const read = () =>
          Effect.map(
            ask(request(BOARD, owner, { id: planId })),
            (answered) => readAnswer(boardAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).board,
          );

        assert.deepEqual(yield* read(), { elements: [], appliedDrawing: 0 });
        const drawn = yield* runDrawOnBoard({ userId: owner, planId }, unparsedWire(DRAW_API));
        assert.deepEqual(drawn, { status: DRAW_ON_BOARD_STATUS.DRAWN, drawing: 1 });
        assert.deepEqual(yield* read(), {
          elements: [],
          appliedDrawing: 0,
          drawing: { number: 1, elements: DRAW_API.elements },
        });

        const written = yield* ask(
          request(BOARD, owner, {
            method: "PUT",
            id: planId,
            body: { elements: [NOTE], appliedDrawing: 1 },
          }),
        );
        assert.equal(written.status, HOSTED_HTTP_STATUS.OK);

        // Luke draws again: the new drawing replaces his last and leaves the scene to the Mac.
        yield* runDrawOnBoard({ userId: owner, planId }, unparsedWire(DRAW_API));
        const board = yield* read();
        assert.deepEqual(board.elements, [NOTE]);
        assert.equal(board.appliedDrawing, 1);
        assert.equal(board.drawing?.number, 2);

        // A drawing laid over the developer's note is drawn, and the answer says what it covers.
        const over = yield* runDrawOnBoard(
          { userId: owner, planId },
          unparsedWire({ elements: [{ ...DRAW_API.elements[0], y: 180 }] }),
        );
        assert.equal(over.status, DRAW_ON_BOARD_STATUS.DRAWN);
        assert.ok(
          "layout" in over && over.layout?.some((finding) => finding.includes(NOTE.id)),
          "the answer names the developer's note",
        );
      }),
  );

  it.effect(
    "another account's board answers as none, and a scene the board does not admit is refused",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
        const save = (userId: string, body: WireBoundaryInput) =>
          ask(request(BOARD, userId, { method: "PUT", id: planId, body }));

        assert.deepEqual(yield* ask(request(BOARD, other, { id: planId })), notFound);
        assert.deepEqual(yield* save(other, { elements: [NOTE], appliedDrawing: 0 }), notFound);
        assert.equal(
          (yield* runDrawOnBoard({ userId: other, planId }, unparsedWire(DRAW_API))).status,
          DRAW_ON_BOARD_STATUS.NOT_DRAWN,
        );
        assert.deepEqual(
          yield* save(owner, { elements: [{ ...NOTE, type: "image" }], appliedDrawing: 0 }),
          invalid,
        );
        assert.deepEqual(
          yield* save(owner, { elements: [NOTE], appliedDrawing: 0, planId }),
          invalid,
        );
        assert.deepEqual(yield* ask(request(BOARD, owner, { id: planId })), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { board: { elements: [], appliedDrawing: 0 } },
        });
      }),
  );

  it.effect("a drawing whose arrow names an id it does not hold draws nothing, and says why", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));
      const binding = { userId: owner, planId };
      const arrowToNothing = {
        type: BOARD_ELEMENT_TYPE.ARROW,
        id: "calls",
        from: "api",
        to: "cache",
      };

      const dangling = yield* runDrawOnBoard(
        binding,
        unparsedWire({ elements: [...DRAW_API.elements, arrowToNothing] }),
      );
      const twice = yield* runDrawOnBoard(
        binding,
        unparsedWire({ elements: [...DRAW_API.elements, ...DRAW_API.elements] }),
      );
      const unreadable = yield* runDrawOnBoard(binding, unparsedWire({ elements: "a box" }));

      assert.deepEqual(dangling, {
        status: DRAW_ON_BOARD_STATUS.NOT_DRAWN,
        reason: DRAW_ON_BOARD_REFUSAL.NO_END,
      });
      assert.equal(twice.status, DRAW_ON_BOARD_STATUS.NOT_DRAWN);
      assert.equal(unreadable.status, DRAW_ON_BOARD_STATUS.NOT_DRAWN);
      assert.deepEqual(yield* ask(request(BOARD, owner, { id: planId })), {
        status: HOSTED_HTTP_STATUS.OK,
        body: { board: { elements: [], appliedDrawing: 0 } },
      });
    }),
  );

  it.effect("a deleted plan takes its board with it", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));
      yield* runDrawOnBoard({ userId: owner, planId }, unparsedWire(DRAW_API));

      yield* ask(request(ONE_PLAN, owner, { id: planId, method: "DELETE" }));

      const rows = yield* db
        .select({ planId: planBoard.planId })
        .from(planBoard)
        .where(eq(planBoard.planId, planId));
      assert.deepEqual(rows, []);
      assert.equal(
        (yield* ask(request(BOARD, owner, { id: planId }))).status,
        HOSTED_HTTP_STATUS.NOT_FOUND,
      );
    }),
  );

  it.effect(
    "a transcript reads each call oldest first in the lines its captions drew, and nothing of another plan",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        const read = () =>
          Effect.map(
            ask(request(TRANSCRIPT, owner, { id: planId })),
            (answered) =>
              readAnswer(planTranscriptAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).transcript,
          );
        const { USER, ASSISTANT } = VOICE_SEGMENT_ROLE;

        assert.deepEqual(yield* read(), { calls: [], earlierOmitted: false });
        // Made newest first, so the order read back is the calls' starts and not the rows'.
        const second = yield* callAbout({ userId: owner, planId, startedAt: 2_000_000 }, [
          [USER, "Seven days.", 0],
        ]);
        // Luke's acknowledgment lands inside the developer's sentence, which a
        // fragment written after it still finishes, as the captions draw it.
        const first = yield* callAbout({ userId: owner, planId, startedAt: 1_000_000 }, [
          [USER, "Invites ", 0],
          [ASSISTANT, "Mm.", 600],
          [USER, "should expire.", 700],
          [ASSISTANT, "After how many days?", 9_000],
        ]);
        yield* callAbout({ userId: owner, planId, startedAt: 3_000_000 }, []);
        const otherPlan = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        yield* callAbout({ userId: owner, planId: otherPlan, startedAt: 3_000_000 }, [
          [USER, "Another plan's words.", 0],
        ]);

        assert.deepEqual(yield* read(), {
          calls: [
            {
              id: first,
              startedAt: 1_000_000,
              messages: [
                spoken(0, TRANSCRIPT_SPEAKER.USER, "Invites should expire."),
                spoken(1, TRANSCRIPT_SPEAKER.ASSISTANT, "Mm."),
                spoken(2, TRANSCRIPT_SPEAKER.ASSISTANT, "After how many days?"),
              ],
            },
            {
              id: second,
              startedAt: 2_000_000,
              messages: [spoken(0, TRANSCRIPT_SPEAKER.USER, "Seven days.")],
            },
          ],
          earlierOmitted: false,
        });
        assert.deepEqual(
          yield* ask(request(TRANSCRIPT, other, { id: planId })),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(request(TRANSCRIPT, owner, { method: "PUT", id: planId })),
          refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
        );
      }),
  );

  it.effect("a teammate's call about a shared plan reads in every member's transcript", () =>
    Effect.gen(function* () {
      const { owner, other, ask } = yield* openAccounts();
      const started = readAnswer(
        planAnswerSchema,
        HOSTED_HTTP_STATUS.CREATED,
        yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
      ).plan;
      yield* joinWorkspace(started.workspaceId, other);
      const read = (userId: string) =>
        Effect.map(
          ask(request(TRANSCRIPT, userId, { id: started.id })),
          (answered) =>
            readAnswer(planTranscriptAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).transcript,
        );
      const { USER } = VOICE_SEGMENT_ROLE;

      const ownersCall = yield* callAbout(
        { userId: owner, planId: started.id, startedAt: 1_000_000 },
        [[USER, "Invites should expire.", 0]],
      );
      const teammatesCall = yield* callAbout(
        { userId: other, planId: started.id, startedAt: 2_000_000 },
        [[USER, "After seven days.", 0]],
      );

      const expected = {
        calls: [
          {
            id: ownersCall,
            startedAt: 1_000_000,
            messages: [spoken(0, TRANSCRIPT_SPEAKER.USER, "Invites should expire.")],
          },
          {
            id: teammatesCall,
            startedAt: 2_000_000,
            messages: [spoken(0, TRANSCRIPT_SPEAKER.USER, "After seven days.")],
          },
        ],
        earlierOmitted: false,
      };
      assert.deepEqual(yield* read(owner), expected);
      assert.deepEqual(yield* read(other), expected);
    }),
  );

  it.effect("the board one member saves is read by the rest of the workspace", () =>
    Effect.gen(function* () {
      const { owner, other, ask } = yield* openAccounts();
      const started = readAnswer(
        planAnswerSchema,
        HOSTED_HTTP_STATUS.CREATED,
        yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
      ).plan;
      yield* joinWorkspace(started.workspaceId, other);

      const saved = yield* ask(
        request(BOARD, other, {
          method: "PUT",
          id: started.id,
          body: { elements: [NOTE], appliedDrawing: 0 },
        }),
      );

      assert.equal(saved.status, HOSTED_HTTP_STATUS.OK);
      assert.deepEqual(
        readAnswer(
          boardAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(BOARD, owner, { id: started.id })),
        ).board.elements,
        [NOTE],
      );
    }),
  );

  it.effect(
    "a plan's work is read by the account that owns it alone, before a turn the query names by its id, and only read",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );

        assert.deepEqual(
          readAnswer(
            planWorkAnswerSchema,
            HOSTED_HTTP_STATUS.OK,
            yield* ask(request(WORK, owner, { id: planId })),
          ),
          { turns: [], code: [] },
        );
        const older = new URL(WORK, ORIGIN);
        older.searchParams.set("id", planId);
        older.searchParams.set("before", "turn-1");
        assert.deepEqual(
          yield* ask(new Request(older, { headers: { authorization: `Bearer ${owner}` } })),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.deepEqual(
          yield* ask(request(WORK, other, { id: planId })),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(request(WORK, owner, { method: "PUT", id: planId })),
          refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
        );
      }),
  );

  it.effect("a transcript past its bound keeps the newest words and says older ones stand", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));
      const said = Array.from(
        { length: TRANSCRIPT_BOUNDS.MAX_SEGMENTS + 1 },
        (_, index): Said => [VOICE_SEGMENT_ROLE.USER, `${index} `, index * 100],
      );
      yield* callAbout({ userId: owner, planId, startedAt: 1_000_000 }, said);

      const transcript = readAnswer(
        planTranscriptAnswerSchema,
        HOSTED_HTTP_STATUS.OK,
        yield* ask(request(TRANSCRIPT, owner, { id: planId })),
      ).transcript;
      assert.equal(transcript.earlierOmitted, true);
      const text = transcript.calls
        .flatMap((call) => call.messages.flatMap((message) => message.parts))
        .map((part) => part.text)
        .join("");
      assert.equal(text.startsWith("1 2 "), true);
      assert.equal(text.endsWith(`${TRANSCRIPT_BOUNDS.MAX_SEGMENTS} `), true);
    }),
  );

  it.effect(
    "a file of the plan's repository reads a window as GitHub holds it on the default branch, naming that branch, on the App's token, each line cut as show_code cuts it; another account's plan reads as none",
    () =>
      Effect.gen(function* () {
        const github = githubReaching(RELAY_REACHED, undefined, {}, contentsOf);
        const { owner, other, ask } = yield* openAccounts(github);
        const planId = startedId(
          yield* ask(
            request(PLANS, owner, { method: "POST", body: { ...RELAY, repository: "acme/relay" } }),
          ),
        );
        const window = (userId: string, path: string, first: string, last: string) =>
          ask(request(FILE, userId, { id: planId, query: { path, first, last } }));

        const read = readAnswer(
          planFileAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* window(owner, "src/invite.ts", "2", "3"),
        );
        assert.deepEqual(read, {
          file: {
            path: "src/invite.ts",
            repository: "Acme/Relay",
            branch: "main",
            firstLine: 2,
            lineCount: 4,
            lines: ["two", "x".repeat(400)],
          },
        });
        const asked = github.sent.find((sent) => CONTENTS_PATH.test(new URL(sent.url).pathname));
        assert.equal(new URL(asked?.url ?? ORIGIN).searchParams.get("ref"), "main");
        assert.equal(
          asked?.headers.get("authorization"),
          `Bearer ${GITHUB_FIXTURE_INSTALLATION_TOKEN}`,
        );
        assert.equal(JSON.stringify(read).includes(GITHUB_FIXTURE_INSTALLATION_TOKEN), false);
        assert.deepEqual(
          readAnswer(
            planFileAnswerSchema,
            HOSTED_HTTP_STATUS.OK,
            yield* window(owner, "src/invite.ts", "9", "12"),
          ),
          {
            file: {
              path: "src/invite.ts",
              repository: "Acme/Relay",
              branch: "main",
              firstLine: 9,
              lineCount: 4,
              lines: [],
            },
          },
          "a window past the end carries no lines",
        );
        assert.deepEqual(
          yield* window(other, "src/invite.ts", "1", "2"),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
      }),
  );

  it.effect(
    "a File tab's read as a desktop sends it, its file named in a `path` query, is answered by the file route itself once the platform lands it on its function",
    () =>
      Effect.gen(function* () {
        const github = githubReaching(RELAY_REACHED, undefined, {}, contentsOf);
        const { owner, ask } = yield* openAccounts(github);
        const planId = startedId(
          yield* ask(
            request(PLANS, owner, { method: "POST", body: { ...RELAY, repository: "acme/relay" } }),
          ),
        );
        const sent = request(
          `/api/plans/${planId}/file?path=src%2Finvite.ts&first=1&last=2`,
          owner,
        );

        assert.deepEqual(
          readAnswer(planFileAnswerSchema, HOSTED_HTTP_STATUS.OK, yield* ask(sent, "plans/file")),
          {
            file: {
              path: "src/invite.ts",
              repository: "Acme/Relay",
              branch: "main",
              firstLine: 1,
              lineCount: 4,
              lines: ["one", "two"],
            },
          },
        );
      }),
  );

  it.effect(
    "a file is refused by the rule show_code keeps: a secret file and a path leaving the tree before GitHub is asked, and a missing file, a directory, a link, and a file too large or not text by name, one GitHub found nothing at naming the branch it was looked for on",
    () =>
      Effect.gen(function* () {
        const github = githubReaching(RELAY_REACHED, undefined, {}, contentsOf);
        const { owner, ask } = yield* openAccounts(github);
        const planId = startedId(
          yield* ask(
            request(PLANS, owner, { method: "POST", body: { ...RELAY, repository: "acme/relay" } }),
          ),
        );
        const refusalOf = (path: string) =>
          Effect.map(
            ask(request(FILE, owner, { id: planId, query: { path, first: "1", last: "10" } })),
            (answered) => readAnswer(planFileAnswerSchema, HOSTED_HTTP_STATUS.OK, answered),
          );
        const asked = () =>
          github.sent.filter((sent) => CONTENTS_PATH.test(new URL(sent.url).pathname)).length;

        assert.deepEqual(yield* refusalOf("config/.env.local"), {
          refusal: PLAN_FILE_REFUSAL.SECRET,
        });
        const missing = { refusal: PLAN_FILE_REFUSAL.MISSING };
        assert.deepEqual(yield* refusalOf("src/../../other/secret.ts"), missing);
        assert.equal(asked(), 0, "neither is asked of GitHub");
        assert.deepEqual(
          yield* refusalOf("gone.ts"),
          { ...missing, branch: "main" },
          "nothing at the path names the branch it was looked for on",
        );
        assert.deepEqual(yield* refusalOf("src"), missing, "a directory is on the branch");
        assert.deepEqual(yield* refusalOf("linked.ts"), missing, "a link is on the branch");
        assert.deepEqual(yield* refusalOf("big.json"), { refusal: PLAN_FILE_REFUSAL.NOT_TEXT });
        assert.deepEqual(yield* refusalOf("assets/logo.png"), {
          refusal: PLAN_FILE_REFUSAL.NOT_TEXT,
        });
      }),
  );

  it.effect(
    "a folder of the plan's repository lists as GitHub holds it on the default branch, naming that branch, on the App's token: a folder as a folder, a file, a link, and a submodule as files, and a secret file by its name; another account's plan reads as none",
    () =>
      Effect.gen(function* () {
        const github = githubReaching(RELAY_REACHED, undefined, {}, repositoryOf);
        const { owner, other, ask } = yield* openAccounts(github);
        const planId = startedId(
          yield* ask(
            request(PLANS, owner, { method: "POST", body: { ...RELAY, repository: "acme/relay" } }),
          ),
        );
        const folder = (userId: string, query: Readonly<Record<string, string>>) =>
          ask(request(TREE, userId, { id: planId, query }));
        const { FILE: AS_FILE, FOLDER } = PLAN_TREE_ENTRY;

        const root = readAnswer(
          planTreeAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* folder(owner, {}),
        );
        assert.deepEqual(root, {
          folder: {
            path: "",
            repository: "Acme/Relay",
            branch: "main",
            entries: [
              { name: ".env", kind: AS_FILE },
              { name: ".env.d", kind: FOLDER },
              { name: "README.md", kind: AS_FILE },
              { name: "linked.ts", kind: AS_FILE },
              { name: "src", kind: FOLDER },
              { name: "vendor", kind: AS_FILE },
            ],
            truncated: false,
          },
        });
        assert.deepEqual(
          readAnswer(
            planTreeAnswerSchema,
            HOSTED_HTTP_STATUS.OK,
            yield* folder(owner, { path: "src" }),
          ),
          {
            folder: {
              path: "src",
              repository: "Acme/Relay",
              branch: "main",
              entries: [{ name: "invite.ts", kind: AS_FILE }],
              truncated: false,
            },
          },
        );
        const asked = github.sent.find((sent) => TREES_PATH.test(new URL(sent.url).pathname));
        assert.equal(
          asked?.headers.get("authorization"),
          `Bearer ${GITHUB_FIXTURE_INSTALLATION_TOKEN}`,
        );
        assert.equal(JSON.stringify(root).includes(GITHUB_FIXTURE_INSTALLATION_TOKEN), false);
        assert.deepEqual(
          yield* folder(other, {}),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
      }),
  );

  it.effect(
    "the tree's read as a desktop sends it, its folder named in a `path` query, is answered by the tree route itself once the platform lands it on its function",
    () =>
      Effect.gen(function* () {
        const github = githubReaching(RELAY_REACHED, undefined, {}, repositoryOf);
        const { owner, ask } = yield* openAccounts(github);
        const planId = startedId(
          yield* ask(
            request(PLANS, owner, { method: "POST", body: { ...RELAY, repository: "acme/relay" } }),
          ),
        );
        const sent = request(`/api/plans/${planId}/tree?path=src`, owner);

        assert.deepEqual(
          readAnswer(planTreeAnswerSchema, HOSTED_HTTP_STATUS.OK, yield* ask(sent, "plans/tree")),
          {
            folder: {
              path: "src",
              repository: "Acme/Relay",
              branch: "main",
              entries: [{ name: "invite.ts", kind: PLAN_TREE_ENTRY.FILE }],
              truncated: false,
            },
          },
        );
      }),
  );

  it.effect(
    "a folder past the bound is listed to it and says it was cut, as is one GitHub cut short",
    () =>
      Effect.gen(function* () {
        const github = githubReaching(RELAY_REACHED, undefined, {}, repositoryOf);
        const { owner, ask } = yield* openAccounts(github);
        const planId = startedId(
          yield* ask(
            request(PLANS, owner, { method: "POST", body: { ...RELAY, repository: "acme/relay" } }),
          ),
        );
        const listed = (path: string) =>
          Effect.map(ask(request(TREE, owner, { id: planId, query: { path } })), (answered) =>
            readAnswer(planTreeAnswerSchema, HOSTED_HTTP_STATUS.OK, answered),
          );

        const generated = yield* listed("generated");
        assert.ok("folder" in generated);
        assert.equal(generated.folder.entries.length, PLAN_TREE_BOUNDS.MAX_ENTRIES);
        assert.equal(generated.folder.truncated, true);
        const huge = yield* listed("huge");
        assert.ok("folder" in huge);
        assert.equal(huge.folder.truncated, true);
      }),
  );

  it.effect(
    "a folder is refused as a file is: one named as a secret file, one inside it, and a path leaving the tree before GitHub is asked; nothing at the path, or a file there, missing on the branch; GitHub failing as unavailable; a plan with no repository as having none; and a path named twice as invalid",
    () =>
      Effect.gen(function* () {
        const github = githubReaching(RELAY_REACHED, undefined, {}, repositoryOf);
        const { owner, ask } = yield* openAccounts(github);
        const planId = startedId(
          yield* ask(
            request(PLANS, owner, { method: "POST", body: { ...RELAY, repository: "acme/relay" } }),
          ),
        );
        const bare = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: LEDGER })));
        const refusalOf = (path: string, plan = planId) =>
          Effect.map(ask(request(TREE, owner, { id: plan, query: { path } })), (answered) =>
            readAnswer(planTreeAnswerSchema, HOSTED_HTTP_STATUS.OK, answered),
          );
        const asked = () =>
          github.sent.filter((sent) => TREES_PATH.test(new URL(sent.url).pathname)).length;

        const secret = { refusal: PLAN_FILE_REFUSAL.SECRET };
        assert.deepEqual(yield* refusalOf(".env.d"), secret);
        assert.deepEqual(yield* refusalOf(".env.d/keys"), secret);
        assert.deepEqual(yield* refusalOf("src/../.."), {
          refusal: PLAN_FILE_REFUSAL.MISSING,
          branch: "main",
        });
        assert.equal(asked(), 0, "none is asked of GitHub");
        assert.deepEqual(yield* refusalOf("gone"), {
          refusal: PLAN_FILE_REFUSAL.MISSING,
          branch: "main",
        });
        assert.deepEqual(yield* refusalOf("README.md"), {
          refusal: PLAN_FILE_REFUSAL.MISSING,
          branch: "main",
        });
        assert.deepEqual(yield* refusalOf("flaky"), { refusal: PLAN_FILE_REFUSAL.UNAVAILABLE });
        assert.deepEqual(yield* refusalOf("src", bare), {
          refusal: PLAN_FILE_REFUSAL.NO_REPOSITORY,
        });
        const twice = new URL(TREE, ORIGIN);
        twice.searchParams.set("id", planId);
        twice.searchParams.append("path", "src");
        twice.searchParams.append("path", "docs");
        assert.deepEqual(
          yield* ask(new Request(twice, { headers: { authorization: `Bearer ${owner}` } })),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
      }),
  );

  it.effect(
    "a plan with no repository says so, and a window out of order or past its bound is refused",
    () =>
      Effect.gen(function* () {
        const reached = githubReaching(RELAY_REACHED, undefined, {}, contentsOf);
        const { owner, ask } = yield* openAccounts(reached);
        const bare = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: LEDGER })));
        const withRepository = startedId(
          yield* ask(
            request(PLANS, owner, { method: "POST", body: { ...RELAY, repository: "acme/relay" } }),
          ),
        );
        const window = (planId: string, first: string, last: string) =>
          request(FILE, owner, { id: planId, query: { path: "src/invite.ts", first, last } });

        assert.deepEqual(
          readAnswer(
            planFileAnswerSchema,
            HOSTED_HTTP_STATUS.OK,
            yield* ask(window(bare, "1", "2")),
          ),
          { refusal: PLAN_FILE_REFUSAL.NO_REPOSITORY },
        );
        assert.deepEqual(
          yield* ask(window(withRepository, "5", "2")),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.deepEqual(
          yield* ask(window(withRepository, "1", "501")),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
      }),
  );

  it.effect("no bearer, a wrong method, and an id that is no UUID are refused", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();

      assert.deepEqual(
        yield* ask(request(PLANS, undefined)),
        refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
      );
      assert.deepEqual(
        yield* ask(request(PLANS, owner, { method: "DELETE" })),
        refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
      );
      assert.deepEqual(
        yield* ask(request(ONE_PLAN, owner, { id: "not-a-plan" })),
        refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
      );
    }),
  );
  /**
   * The owner's plan written twice, far enough apart to be two revisions:
   * the problem first, then the outcome.
   */
  const twoRevisions = (userId: string, planId: string) =>
    Effect.gen(function* () {
      yield* saveNotes({ userId, planId }, [added(PLAN_FIELD.PROBLEM, "Only admins can invite.")]);
      yield* TestClock.adjust(Duration.millis(PLAN_REVISION.JOIN_WITHIN_MS + 1));
      yield* saveNotes({ userId, planId }, [added(PLAN_FIELD.OUTCOME, "Members invite by email.")]);
    });

  it.effect(
    "a plan's history lists newest first, and reads a revision beside the one before it",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        yield* twoRevisions(owner, planId);

        const page = readAnswer(
          planRevisionsAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(REVISIONS, owner, { id: planId })),
        );
        const { revision } = readAnswer(
          planRevisionAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(REVISION, owner, { id: planId, query: { seq: "2" } })),
        );
        const first = readAnswer(
          planRevisionAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(REVISION, owner, { id: planId, query: { seq: "1" } })),
        ).revision;
        const opened = readAnswer(
          planAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(ONE_PLAN, owner, { id: planId })),
        ).plan;

        assert.deepEqual(
          page.revisions.map(({ seq, lastEdit }) => [seq, lastEdit.actor]),
          [
            [2, PLAN_ACTOR.NOTETAKER],
            [1, PLAN_ACTOR.NOTETAKER],
          ],
        );
        assert.equal(page.earlier, undefined);
        assert.deepEqual(revision.document, opened.document);
        assert.deepEqual(revision.previous, first.document);
        assert.equal(first.previous, null);
        assert.ok(first.document.body.includes("Only admins can invite."));
        assert.ok(!first.document.body.includes("Members invite by email."));
      }),
  );

  it.effect(
    "a restore puts a revision back as a new revision of the developer's, and answers the plan",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        yield* twoRevisions(owner, planId);
        const first = readAnswer(
          planRevisionAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(REVISION, owner, { id: planId, query: { seq: "1" } })),
        ).revision;

        const restored = readAnswer(
          planAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(RESTORE, owner, { id: planId, method: "POST", query: { seq: "1" } })),
        ).plan;
        const page = readAnswer(
          planRevisionsAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(REVISIONS, owner, { id: planId })),
        );

        assert.deepEqual(restored.document, first.document);
        assert.equal(restored.lastEdit?.actor, PLAN_ACTOR.DEVELOPER);
        assert.deepEqual(
          page.revisions.map(({ seq, lastEdit, restoredFrom }) => [
            seq,
            lastEdit.actor,
            restoredFrom?.seq,
          ]),
          [
            [3, PLAN_ACTOR.DEVELOPER, 1],
            [2, PLAN_ACTOR.NOTETAKER, undefined],
            [1, PLAN_ACTOR.NOTETAKER, undefined],
          ],
        );
        assert.equal(page.revisions[0]?.restoredFrom?.at, page.revisions[2]?.lastEdit.at);
      }),
  );

  it.effect(
    "another account reads no history of the plan, no revision of it, and restores none",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        yield* twoRevisions(owner, planId);
        const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);

        assert.deepEqual(yield* ask(request(REVISIONS, other, { id: planId })), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { revisions: [] },
        });
        assert.deepEqual(
          yield* ask(request(REVISION, other, { id: planId, query: { seq: "1" } })),
          notFound,
        );
        assert.deepEqual(
          yield* ask(request(RESTORE, other, { id: planId, method: "POST", query: { seq: "1" } })),
          notFound,
        );
        const page = readAnswer(
          planRevisionsAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(REVISIONS, owner, { id: planId })),
        );
        assert.deepEqual(
          page.revisions.map(({ seq }) => seq),
          [2, 1],
        );
      }),
  );

  it.effect(
    "a revision the plan never had answers as none, and a number that names none is refused",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        yield* twoRevisions(owner, planId);
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);

        assert.deepEqual(
          yield* ask(request(REVISION, owner, { id: planId, query: { seq: "9" } })),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(request(RESTORE, owner, { id: planId, method: "POST", query: { seq: "9" } })),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(request(REVISION, owner, { id: planId, query: { seq: "0" } })),
          invalid,
        );
        assert.deepEqual(
          yield* ask(request(REVISIONS, owner, { id: planId, query: { before: "two" } })),
          invalid,
        );
        assert.deepEqual(yield* ask(request(REVISION, owner, { id: planId })), invalid);
        assert.deepEqual(
          yield* ask(request(RESTORE, owner, { id: planId, query: { seq: "1" } })),
          refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
        );
      }),
  );
});
