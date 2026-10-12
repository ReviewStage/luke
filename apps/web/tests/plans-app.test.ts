import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { db } from "@sidecar/database/core/query";
import {
  type CodingAgent,
  createCodingAgent,
  recordCodingAgentPublished,
} from "@sidecar/database/models/coding-agent-store";
import { writePage } from "@sidecar/database/models/plan-pages";
import { PLAN_REVISION } from "@sidecar/database/models/plan-revisions";
import { openPlanConversation } from "@sidecar/database/models/plan-store";
import { purgeDeletedPlanCalls } from "@sidecar/database/models/soft-delete";
import { personalWorkspaceOf } from "@sidecar/database/models/workspace-store";
import { storeWriter } from "@sidecar/database/models/writer";
import { user } from "@sidecar/database/schemas/auth";
import { planBoard } from "@sidecar/database/schemas/plan";
import { turns } from "@sidecar/database/schemas/storage";
import { voiceSessions, voiceTranscriptSegments } from "@sidecar/database/schemas/voice";
import { getTestDB } from "@sidecar/database/testing";
import {
  VOICE_CLOSE_REASON,
  VOICE_DELEGATION_MODE,
  VOICE_SEGMENT_ROLE,
  type VoiceSegmentRole,
} from "@sidecar/database/voice-vocabulary";
import { BOARD_ELEMENT_TYPE } from "@sidecar/hosted/board-vocabulary";
import { boardAnswerSchema } from "@sidecar/hosted/board-wire";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentPullRequest,
  PULL_REQUEST_STATE,
} from "@sidecar/hosted/coding-agent-wire";
import { planPagesAnswerSchema, planPageVersionAnswerSchema } from "@sidecar/hosted/page-wire";
import { DEFAULT_PLAN_TEMPLATE } from "@sidecar/hosted/plan-document-template";
import { PLAN_EDIT_REFUSAL, planEditAnswerSchema } from "@sidecar/hosted/plan-edit";
import { PLAN_HEADING } from "@sidecar/hosted/plan-template";
import {
  PLAN_ACTOR,
  PLAN_BOUNDS,
  PLAN_FIELD,
  PLAN_FILE_REFUSAL,
  PLAN_TREE_BOUNDS,
  PLAN_TREE_ENTRY,
  planAnswerSchema,
  planFileAnswerSchema,
  planListAnswerSchema,
  planRevisionAnswerSchema,
  planRevisionsAnswerSchema,
  planSkillsAnswerSchema,
  planTreeAnswerSchema,
} from "@sidecar/hosted/plan-wire";
import { planWorkAnswerSchema } from "@sidecar/hosted/planning-view";
import {
  planTranscriptAnswerSchema,
  TRANSCRIPT_BOUNDS,
  TRANSCRIPT_PART_TYPE,
  type TranscriptMessage,
} from "@sidecar/hosted/transcript-wire";
import { LIVE_CLOSE_REASON, LIVE_DEFAULTS, TRANSCRIPT_SPEAKER } from "@sidecar/live";
import { TURN_ORIGIN, TURN_STATUS, unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { eq, inArray } from "drizzle-orm";
import { Clock, Duration, Effect, Layer, Option, Result, type Schema } from "effect";
import { TestClock } from "effect/testing";
import { HttpRouter } from "effect/unstable/http";
import { SqlClient } from "effect/unstable/sql";
import { MESSAGE_AUTHOR, MESSAGE_CHANNEL, MESSAGE_ROLE } from "../server/core";
import {
  DRAW_ON_BOARD_REFUSAL,
  DRAW_ON_BOARD_STATUS,
  runDrawOnBoard,
} from "../server/hosted/board-tool";
import { HOSTED_TOOL_SET } from "../server/hosted/brain-tool-set";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../server/hosted/http";
import { PLAN_SAVE_STATUS, saveNotes } from "../server/hosted/plan-notes";
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
import { added } from "./support/plan-contents";
import {
  INVITATIONS_TEXT,
  makeDocumentPlan,
  makeSavedDocumentPlan,
  recordDocumentRevision,
} from "./support/plan-documents";
import { dispatched } from "./support/platform-landing";
import { SKILL_ENTRY, skillsRepository } from "./support/skills-repository";
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
const SKILLS = "/api/plans/skills";
const REVISIONS = "/api/plans/revisions";
const REVISION = "/api/plans/revision";
const RESTORE = "/api/plans/restore";
const EDIT = "/api/plans/edit";
const PAGE = "/api/plans/page";

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
        // A plan here has no coding agent, so its delete has nothing to stop; `coding-agents-app.test.ts` deletes one that has.
        eveOrigin: () => undefined,
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
  ["src/marked.ts", () => fileContents("\uFEFFa\r\nb")],
  [
    "src/latin1.txt",
    () =>
      Response.json({
        type: "file",
        size: 3,
        encoding: "base64",
        content: Buffer.from([0x61, 0xe9, 0x62]).toString("base64"),
      }),
  ],
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

/** What the git trees API holds of the fixture repository asked recursively, by tree-ish: the root whole, and one GitHub cut short. */
const RECURSIVE_TREES = new Map<string, () => Response>([
  [
    "main:",
    () =>
      Response.json({
        tree: [
          gitEntry(".env", "blob", "100644"),
          gitEntry(".env.d", "tree", "040000"),
          gitEntry(".env.d/keys.pem", "blob", "100644"),
          gitEntry("README.md", "blob", "100644"),
          gitEntry("src", "tree", "040000"),
          gitEntry("src/app", "tree", "040000"),
          gitEntry("src/app/main.ts", "blob", "100644"),
          gitEntry("src/invite.ts", "blob", "100644"),
        ],
        truncated: false,
      }),
  ],
  [
    "main:huge",
    () => Response.json({ tree: [gitEntry("a.ts", "blob", "100644")], truncated: true }),
  ],
  [
    "main:deep",
    () =>
      Response.json({
        tree: [
          gitEntry("a.ts", "blob", "100644"),
          gitEntry(`${"nested/".repeat(150)}b.ts`, "blob", "100644"),
        ],
        truncated: false,
      }),
  ],
]);

const TREES_PATH = /^\/repos\/Acme\/Relay\/git\/trees\/(.+)$/u;

/** The fixture repository's files and folders, as GitHub answers them on the repository's own paths. */
function repositoryOf(sent: SentToGitHub): Response | undefined {
  const url = new URL(sent.url);
  const named = TREES_PATH.exec(url.pathname);
  if (named === null) return contentsOf(sent);
  const trees = url.searchParams.get("recursive") === "1" ? RECURSIVE_TREES : TREES;
  const tree = trees.get(decodeURIComponent(named[1] ?? ""));
  return tree === undefined ? Response.json({ message: "Not Found" }, { status: 404 }) : tree();
}

/** The fixture repository's skills: one a developer may choose, one the model alone loads, and one in the Claude Code root. */
const relaySkills = skillsRepository({
  fullName: "Acme/Relay",
  branch: "main",
  roots: {
    ".agents/skills": { release: SKILL_ENTRY.FOLDER, drizzle: SKILL_ENTRY.FOLDER },
    ".claude/skills": { review: SKILL_ENTRY.FOLDER },
  },
  files: {
    ".agents/skills/release/SKILL.md":
      "---\nname: release\ndescription: Use to cut a release of the relay.\n---\nTag it, then publish.",
    ".agents/skills/drizzle/SKILL.md":
      "---\ndescription: Use for Drizzle schemas.\nuser-invocable: false\n---\nWrite the schema first.",
    ".claude/skills/review/SKILL.md":
      "---\ndescription: Use to review a pull request.\n---\nRead the diff whole.",
  },
});

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

/** What a call's row recorded of its end, as the record writes it; an earlier build's row holds none of it. */
type Recorded = Pick<
  typeof voiceSessions.$inferInsert,
  "closedAt" | "closeReason" | "usage" | "model"
>;

/** A call about the plan, started at the instant given, with the fragments said on it in the order they were written. */
const callAbout = (
  input: { userId: string; planId: string; startedAt: number; recorded?: Recorded },
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
        ...input.recorded,
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

it.layer(getTestDB())("the plan routes", (it) => {
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
            url: `https://github.com/Acme/Relay/pull/${index + 1}`,
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
    "a listed plan names two pull requests of one number in two repositories apart, each with its own page",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const plan = yield* startPlan(owner, { name: RELAY.name });
        const pages = [PULL_REQUEST.url, "https://github.com/Acme/Ledger/pull/128"];
        for (const url of pages) {
          const agent = yield* startAgent(owner, plan.id);
          yield* recordCodingAgentPublished(owner, agent.id, { ...PULL_REQUEST, url });
          yield* TestClock.adjust("1 minute");
        }

        const { plans } = readAnswer(
          planListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(PLANS, owner)),
        );

        const agents = plans.find((listed) => listed.id === plan.id)?.agents;
        assert.equal(agents?.pullRequestTotal, 2);
        assert.deepEqual(
          agents?.pullRequests.map((pullRequest) => pullRequest.url).sort(),
          [...pages].sort(),
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
            url: "https://github.com/Acme/Relay/pull/128",
          },
        ]);
      }),
  );

  it.effect("a started plan lists, and opens with what its notes saved", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));
      const saved = yield* saveNotes({ userId: owner, planId }, [
        added(PLAN_HEADING.CONTEXT, "Only admins can invite."),
        added(PLAN_HEADING.OPEN_QUESTIONS, "- Who can withdraw an invite?"),
      ]);
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
        yield* makeDocumentPlan(planId, INVITATIONS_TEXT);
        const drafted = yield* saveNotes({ userId: owner, planId }, [
          added(PLAN_HEADING.OPEN_QUESTIONS, "- Who can withdraw an invite?"),
        ]);
        const base =
          drafted.status === PLAN_SAVE_STATUS.SAVED
            ? drafted.document.body
            : assert.fail("the draft did not save");
        const change = (body: WireBoundaryInput) =>
          ask(request(ONE_PLAN, owner, { id: planId, method: "PATCH", body }));
        const edit = () =>
          ask(
            request(EDIT, owner, {
              id: planId,
              method: "POST",
              body: { document: { base, value: base.replace("Only an admin", "Only an owner") } },
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
          added(PLAN_HEADING.APPROACH, "Invites expire after a week."),
        ]);
        assert.equal(noted.status, PLAN_SAVE_STATUS.SAVED);
        const held = readAnswer(
          planAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(ONE_PLAN, owner, { id: planId })),
        ).plan;
        assert.equal(held.name, RELAY.name);
        assert.ok(held.document.body.includes("Invites expire after a week."));
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
    "an edit of another account's plan answers as none, and one that does not read is refused",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        const body = {
          document: { base: DEFAULT_PLAN_TEMPLATE, value: `${DEFAULT_PLAN_TEMPLATE}Mine now.\n` },
        };

        assert.deepEqual(
          yield* ask(request(EDIT, other, { id: planId, method: "POST", body })),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(
            request(EDIT, owner, {
              id: planId,
              method: "POST",
              body: { field: PLAN_FIELD.OPEN_QUESTIONS, base: [], value: "Not a list." },
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
      assert.equal(plan.document.body, DEFAULT_PLAN_TEMPLATE);
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
    "a deleted plan takes its ended calls and their words with it, and the sweep each call left open once it ends",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        const keptId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        const othersId = startedId(
          yield* ask(request(PLANS, other, { method: "POST", body: RELAY })),
        );
        const hour = Duration.toMillis(Duration.hours(1));
        const ended = (at: number): Recorded => ({
          closedAt: new Date(at),
          closeReason: VOICE_CLOSE_REASON.CONNECTION_LOST,
          usage: { seconds: 60, confirmed: false },
          model: LIVE_DEFAULTS.MODEL,
        });
        const said: readonly Said[] = [[VOICE_SEGMENT_ROLE.USER, "Ship the invite flow.", 0]];
        yield* callAbout(
          { userId: owner, planId, startedAt: 10 * hour, recorded: ended(10 * hour + 60_000) },
          said,
        );
        const openCall = yield* callAbout({ userId: owner, planId, startedAt: 12 * hour }, said);
        const staleCall = yield* callAbout({ userId: owner, planId, startedAt: 9 * hour }, said);
        const keptCall = yield* callAbout(
          { userId: owner, planId: keptId, startedAt: 10 * hour, recorded: ended(11 * hour) },
          said,
        );
        const othersCall = yield* callAbout(
          { userId: other, planId: othersId, startedAt: 10 * hour, recorded: ended(11 * hour) },
          said,
        );
        const standing = () =>
          Effect.map(
            db
              .select({ id: voiceSessions.id })
              .from(voiceSessions)
              .where(inArray(voiceSessions.userId, [owner, other]))
              .orderBy(voiceSessions.id),
            (rows) => rows.map(({ id }) => id),
          );
        const spokenOn = () =>
          Effect.map(
            db
              .selectDistinct({ id: voiceTranscriptSegments.voiceSessionId })
              .from(voiceTranscriptSegments)
              .innerJoin(
                voiceSessions,
                eq(voiceSessions.id, voiceTranscriptSegments.voiceSessionId),
              )
              .where(inArray(voiceSessions.userId, [owner, other]))
              .orderBy(voiceTranscriptSegments.voiceSessionId),
            (rows) => rows.map(({ id }) => id),
          );
        const ids = (...each: string[]) => [...each].sort();

        yield* ask(request(ONE_PLAN, owner, { id: planId, method: "DELETE" }));

        const afterDelete = ids(openCall, staleCall, keptCall, othersCall);
        assert.deepEqual(yield* standing(), afterDelete);
        assert.deepEqual(yield* spokenOn(), afterDelete);

        // An hour past the open call's start no Live session of the stale call can still run.
        const liveEdge = new Date(12 * hour - hour);
        yield* purgeDeletedPlanCalls(liveEdge);
        assert.deepEqual(yield* standing(), ids(openCall, keptCall, othersCall));

        yield* db
          .update(voiceSessions)
          .set({ closedAt: new Date(12 * hour + 60_000) })
          .where(eq(voiceSessions.id, openCall));
        yield* purgeDeletedPlanCalls(liveEdge);
        const afterSweep = ids(keptCall, othersCall);
        assert.deepEqual(yield* standing(), afterSweep);
        assert.deepEqual(yield* spokenOn(), afterSweep);
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

  it.effect(
    "a transcript's line names the rows the voice wrote for it, the ids a planning turn names its ask by, both where a call that reattached split it across two, and a line with no row on record names none",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        const call = yield* callAbout({ userId: owner, planId, startedAt: 1_000_000 }, [
          [VOICE_SEGMENT_ROLE.USER, "Invites ", 0],
          [VOICE_SEGMENT_ROLE.ASSISTANT, "Mm.", 600],
          [VOICE_SEGMENT_ROLE.USER, "should expire.", 700],
          [VOICE_SEGMENT_ROLE.ASSISTANT, "After how many days?", 9_000],
        ]);
        const conversationId = Option.getOrThrow(yield* openPlanConversation(owner, planId));
        const writer = yield* storeWriter({ tools: HOSTED_TOOL_SET });
        const target = { userId: owner, conversationId };
        const span = { channel: MESSAGE_CHANNEL.VOICE, voice_session_id: call } as const;
        // The developer's line is on record as two rows, the call having reattached between its
        // fragments, and Luke's question as one; Luke's "Mm." never was.
        yield* writer.upsertSpokenRow(target, {
          role: MESSAGE_ROLE.USER,
          clientId: "row-should",
          text: "should expire.",
          metadata: { author: MESSAGE_AUTHOR.DEVELOPER, ...span, from_ms: 700, to_ms: 1_200 },
        });
        yield* writer.upsertSpokenRow(target, {
          role: MESSAGE_ROLE.USER,
          clientId: "row-invites",
          text: "Invites",
          metadata: { author: MESSAGE_AUTHOR.DEVELOPER, ...span, from_ms: 0, to_ms: 500 },
        });
        yield* writer.upsertSpokenRow(target, {
          role: MESSAGE_ROLE.ASSISTANT,
          clientId: "row-how-many",
          text: "After how many days?",
          metadata: { author: MESSAGE_AUTHOR.VOICE_MODEL, ...span, from_ms: 9_000, to_ms: 9_500 },
        });

        const { calls } = readAnswer(
          planTranscriptAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(TRANSCRIPT, owner, { id: planId })),
        ).transcript;
        assert.deepEqual(
          calls[0]?.messages.map((line) => [line.parts[0]?.text, line.metadata?.rowIds]),
          [
            ["Invites should expire.", ["row-invites", "row-should"]],
            ["Mm.", undefined],
            ["After how many days?", ["row-how-many"]],
          ],
        );
      }),
  );

  it.effect(
    "a transcript's call says when and why it ended, what it metered, and its model where its row records them, and an earlier build's call says only its words",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        const earlier = yield* callAbout({ userId: owner, planId, startedAt: 1_000_000 }, [
          [VOICE_SEGMENT_ROLE.USER, "Invites should expire.", 0],
        ]);
        const ended = yield* callAbout(
          {
            userId: owner,
            planId,
            startedAt: 2_000_000,
            recorded: {
              closedAt: new Date(2_754_000),
              closeReason: VOICE_CLOSE_REASON.CONNECTION_LOST,
              usage: { seconds: 750, confirmed: false },
              model: LIVE_DEFAULTS.MODEL,
            },
          },
          [[VOICE_SEGMENT_ROLE.USER, "Seven days.", 0]],
        );

        const { calls } = readAnswer(
          planTranscriptAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(TRANSCRIPT, owner, { id: planId })),
        ).transcript;
        assert.deepEqual(calls, [
          {
            id: earlier,
            startedAt: 1_000_000,
            messages: [spoken(0, TRANSCRIPT_SPEAKER.USER, "Invites should expire.")],
          },
          {
            id: ended,
            startedAt: 2_000_000,
            messages: [spoken(0, TRANSCRIPT_SPEAKER.USER, "Seven days.")],
            endedAt: 2_754_000,
            ending: LIVE_CLOSE_REASON.CONNECTION_LOST,
            usage: { seconds: 750, confirmed: false },
            model: LIVE_DEFAULTS.MODEL,
          },
        ]);
      }),
  );

  it.effect(
    "a teammate's call about a shared plan reads in every member's transcript, with what its record holds",
    () =>
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
          {
            userId: other,
            planId: started.id,
            startedAt: 2_000_000,
            recorded: {
              closedAt: new Date(2_060_000),
              closeReason: VOICE_CLOSE_REASON.CONNECTION_LOST,
              usage: { seconds: 60, confirmed: false },
              model: LIVE_DEFAULTS.MODEL,
            },
          },
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
              endedAt: 2_060_000,
              ending: VOICE_CLOSE_REASON.CONNECTION_LOST,
              usage: { seconds: 60, confirmed: false },
              model: LIVE_DEFAULTS.MODEL,
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
    "a file read pinned to a commit asks GitHub for that commit and names it where it would name the branch, a file missing there naming it too; a ref that is no whole lowercase commit, or named twice, is refused before GitHub is asked",
    () =>
      Effect.gen(function* () {
        const github = githubReaching(RELAY_REACHED, undefined, {}, contentsOf);
        const { owner, ask } = yield* openAccounts(github);
        const planId = startedId(
          yield* ask(
            request(PLANS, owner, { method: "POST", body: { ...RELAY, repository: "acme/relay" } }),
          ),
        );
        const commit = "0123456789abcdef0123456789abcdef01234567";
        const pinned = (path: string, ref: string) =>
          ask(request(FILE, owner, { id: planId, query: { path, first: "1", last: "2", ref } }));
        const refs = () =>
          github.sent
            .filter((sent) => CONTENTS_PATH.test(new URL(sent.url).pathname))
            .map((sent) => new URL(sent.url).searchParams.get("ref"));

        assert.deepEqual(
          readAnswer(
            planFileAnswerSchema,
            HOSTED_HTTP_STATUS.OK,
            yield* pinned("src/invite.ts", commit),
          ),
          {
            file: {
              path: "src/invite.ts",
              repository: "Acme/Relay",
              branch: commit,
              firstLine: 1,
              lineCount: 4,
              lines: ["one", "two"],
            },
          },
        );
        assert.deepEqual(refs(), [commit]);
        assert.deepEqual(
          readAnswer(planFileAnswerSchema, HOSTED_HTTP_STATUS.OK, yield* pinned("gone.ts", commit)),
          { refusal: PLAN_FILE_REFUSAL.MISSING, branch: commit },
        );

        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
        assert.deepEqual(yield* pinned("src/invite.ts", "main"), invalid, "a branch is no commit");
        assert.deepEqual(yield* pinned("src/invite.ts", commit.slice(0, 7)), invalid);
        assert.deepEqual(yield* pinned("src/invite.ts", commit.toUpperCase()), invalid);
        assert.deepEqual(
          yield* pinned("src/invite.ts", `${commit.slice(0, 36)}/../`),
          invalid,
          "no path rides in a ref",
        );
        const twice = request(`${FILE}?ref=${commit}&ref=${commit}`, owner, {
          id: planId,
          query: { path: "src/invite.ts", first: "1", last: "2" },
        });
        assert.deepEqual(yield* ask(twice), invalid);
        assert.equal(refs().length, 2, "none of these is asked of GitHub");
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
    "asked recursively, a folder is listed whole in one read, each entry by its path, nothing inside a folder named as a secret file though the folder is named; one GitHub cut short, or holding a path longer than the wire carries, says so; and a recursive query other than 1 is invalid",
    () =>
      Effect.gen(function* () {
        const github = githubReaching(RELAY_REACHED, undefined, {}, repositoryOf);
        const { owner, ask } = yield* openAccounts(github);
        const planId = startedId(
          yield* ask(
            request(PLANS, owner, { method: "POST", body: { ...RELAY, repository: "acme/relay" } }),
          ),
        );
        const whole = (query: Record<string, string>) =>
          ask(request(TREE, owner, { id: planId, query }));

        const root = readAnswer(
          planTreeAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* whole({ recursive: "1" }),
        );
        const AS_FILE = PLAN_TREE_ENTRY.FILE;
        const AS_FOLDER = PLAN_TREE_ENTRY.FOLDER;
        assert.deepEqual(root, {
          folder: {
            path: "",
            repository: "Acme/Relay",
            branch: "main",
            entries: [
              { name: ".env", kind: AS_FILE },
              { name: ".env.d", kind: AS_FOLDER },
              { name: "README.md", kind: AS_FILE },
              { name: "src", kind: AS_FOLDER },
              { name: "src/app", kind: AS_FOLDER },
              { name: "src/app/main.ts", kind: AS_FILE },
              { name: "src/invite.ts", kind: AS_FILE },
            ],
            truncated: false,
          },
        });
        const huge = readAnswer(
          planTreeAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* whole({ path: "huge", recursive: "1" }),
        );
        assert.ok("folder" in huge);
        assert.equal(huge.folder.truncated, true);
        const deep = readAnswer(
          planTreeAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* whole({ path: "deep", recursive: "1" }),
        );
        assert.ok("folder" in deep);
        assert.deepEqual(deep.folder.entries, [{ name: "a.ts", kind: AS_FILE }]);
        assert.equal(
          deep.folder.truncated,
          true,
          "a path longer than the wire carries is left out, and said",
        );
        assert.deepEqual(
          yield* whole({ recursive: "yes" }),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
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
    "a plan's repository's skills read as GitHub holds them on the default branch, naming that branch, on the App's token, as a desktop sends the read: the ones the model alone loads left out and no body carried; another account's plan reads as none, and a plan with no repository as having none",
    () =>
      Effect.gen(function* () {
        const github = githubReaching(RELAY_REACHED, undefined, {}, relaySkills);
        const { owner, other, ask } = yield* openAccounts(github);
        const planId = startedId(
          yield* ask(
            request(PLANS, owner, { method: "POST", body: { ...RELAY, repository: "acme/relay" } }),
          ),
        );
        const bare = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: LEDGER })));
        const skillsOf = (userId: string, plan: string) =>
          ask(request(`/api/plans/${plan}/skills`, userId), "plans/skills");

        const answered = yield* skillsOf(owner, planId);
        assert.deepEqual(readAnswer(planSkillsAnswerSchema, HOSTED_HTTP_STATUS.OK, answered), {
          skills: {
            repository: "Acme/Relay",
            branch: "main",
            skills: [
              { name: "release", description: "Use to cut a release of the relay." },
              { name: "review", description: "Use to review a pull request." },
            ],
          },
        });
        assert.equal(JSON.stringify(answered.body).includes("Tag it"), false, "no body is carried");
        const asked = github.sent.find((sent) => TREES_PATH.test(new URL(sent.url).pathname));
        assert.equal(
          asked?.headers.get("authorization"),
          `Bearer ${GITHUB_FIXTURE_INSTALLATION_TOKEN}`,
        );
        assert.deepEqual(
          readAnswer(planSkillsAnswerSchema, HOSTED_HTTP_STATUS.OK, yield* skillsOf(owner, bare)),
          { refusal: PLAN_FILE_REFUSAL.NO_REPOSITORY },
        );
        assert.deepEqual(
          yield* skillsOf(other, planId),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
      }),
  );

  it.effect(
    "a repository's skills read while GitHub fails answer as unavailable, and a read by any method but GET is refused",
    () =>
      Effect.gen(function* () {
        const github = githubReaching(RELAY_REACHED, undefined, {}, (sent) =>
          TREES_PATH.test(new URL(sent.url).pathname)
            ? Response.json({ message: "Server Error" }, { status: 502 })
            : undefined,
        );
        const { owner, ask } = yield* openAccounts(github);
        const planId = startedId(
          yield* ask(
            request(PLANS, owner, { method: "POST", body: { ...RELAY, repository: "acme/relay" } }),
          ),
        );

        assert.deepEqual(
          readAnswer(
            planSkillsAnswerSchema,
            HOSTED_HTTP_STATUS.OK,
            yield* ask(request(SKILLS, owner, { id: planId })),
          ),
          { refusal: PLAN_FILE_REFUSAL.UNAVAILABLE },
        );
        assert.deepEqual(
          yield* ask(request(SKILLS, owner, { id: planId, method: "POST", body: {} })),
          refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
        );
      }),
  );

  it.effect(
    "a raw read carries the file's whole text as it holds it, its long lines uncut and its byte-order mark and line endings kept, refuses bytes that are not UTF-8, is held to the same rule, and a raw query other than 1 is invalid",
    () =>
      Effect.gen(function* () {
        const reached = githubReaching(RELAY_REACHED, undefined, {}, contentsOf);
        const { owner, ask } = yield* openAccounts(reached);
        const planId = startedId(
          yield* ask(
            request(PLANS, owner, { method: "POST", body: { ...RELAY, repository: "acme/relay" } }),
          ),
        );
        const read = (path: string, raw: string) =>
          ask(request(FILE, owner, { id: planId, query: { path, first: "1", last: "1", raw } }));

        assert.deepEqual(
          readAnswer(
            planFileAnswerSchema,
            HOSTED_HTTP_STATUS.OK,
            yield* read("src/invite.ts", "1"),
          ),
          {
            text: {
              path: "src/invite.ts",
              repository: "Acme/Relay",
              branch: "main",
              text: `one\ntwo\n${"x".repeat(500)}\nfour`,
            },
          },
        );
        const marked = readAnswer(
          planFileAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* read("src/marked.ts", "1"),
        );
        assert.ok("text" in marked);
        assert.deepEqual(
          [...Buffer.from(marked.text.text)],
          [0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a, 0x62],
          "the bytes GitHub holds, its byte-order mark and line endings kept",
        );
        assert.deepEqual(
          readAnswer(
            planFileAnswerSchema,
            HOSTED_HTTP_STATUS.OK,
            yield* read("src/latin1.txt", "1"),
          ),
          { refusal: PLAN_FILE_REFUSAL.NOT_TEXT },
          "bytes that are not UTF-8 are refused rather than carried changed",
        );
        assert.deepEqual(
          readAnswer(planFileAnswerSchema, HOSTED_HTTP_STATUS.OK, yield* read(".env", "1")),
          { refusal: PLAN_FILE_REFUSAL.SECRET },
        );
        assert.deepEqual(
          yield* read("src/invite.ts", "yes"),
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
   * the context first, then the goal.
   */
  const twoRevisions = (userId: string, planId: string) =>
    Effect.gen(function* () {
      yield* saveNotes({ userId, planId }, [
        added(PLAN_HEADING.CONTEXT, "Only admins can invite."),
      ]);
      yield* TestClock.adjust(Duration.millis(PLAN_REVISION.JOIN_WITHIN_MS + 1));
      yield* saveNotes({ userId, planId }, [added(PLAN_HEADING.GOAL, "Members invite by email.")]);
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

  it.effect(
    "a plan's pages as a desktop reads them, once the platform lands each read: the list, and one version's HTML inside JSON",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        const first = Option.getOrThrow(
          yield* writePage(owner, planId, { title: "Invite funnel", html: "<p>v1</p>" }),
        );
        const second = Option.getOrThrow(
          yield* writePage(owner, planId, { pageId: first.id, title: "Funnel", html: "<p>v2</p>" }),
        );

        assert.deepEqual(
          readAnswer(
            planPagesAnswerSchema,
            HOSTED_HTTP_STATUS.OK,
            yield* ask(request(`/api/plans/${planId}/pages`, owner), "plans/pages"),
          ),
          { pages: [second] },
        );
        assert.deepEqual(
          readAnswer(
            planPageVersionAnswerSchema,
            HOSTED_HTTP_STATUS.OK,
            yield* ask(
              request(`/api/plans/${planId}/pages/${first.id}/versions/1`, owner),
              "plans/page",
            ),
          ),
          { page: { ...first, html: "<p>v1</p>" } },
        );
      }),
  );

  it.effect(
    "another account reads no page of the plan, and a version that names none answers as none or is refused",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        const page = Option.getOrThrow(
          yield* writePage(owner, planId, { title: "Invite funnel", html: "<p>v1</p>" }),
        );
        const version = (asker: string, pageId: string, number: string, method?: string) =>
          ask(
            request(PAGE, asker, {
              id: planId,
              query: { page: pageId, version: number },
              ...(method === undefined ? undefined : { method }),
            }),
          );
        const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);

        assert.deepEqual(yield* ask(request(`/api/plans/${planId}/pages`, other), "plans/pages"), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { pages: [] },
        });
        assert.deepEqual(yield* version(other, page.id, "1"), notFound);
        assert.deepEqual(yield* version(owner, page.id, "2"), notFound);
        assert.deepEqual(yield* version(owner, "not-a-page", "1"), notFound);
        assert.deepEqual(
          yield* version(owner, page.id, "0"),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.deepEqual(
          yield* version(owner, page.id, "1", "POST"),
          refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
        );
      }),
  );

  it.effect(
    "a plan answers its text and who changed each section by heading, and a rename leaves the text as it stood",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        yield* makeSavedDocumentPlan(planId, INVITATIONS_TEXT);
        const notedAt = yield* Clock.currentTimeMillis;
        const noted = yield* saveNotes(
          { userId: owner, planId },
          [added(PLAN_HEADING.GOAL, "- Admins can withdraw an invite.")],
          { actor: PLAN_ACTOR.NOTETAKER, liveSessionId: "live-session-1" },
        );
        assert.ok(noted.status === PLAN_SAVE_STATUS.SAVED);
        yield* TestClock.adjust(Duration.minutes(3));
        const base = noted.document.body;
        const value = base.replace("Only an admin", "Only an owner");
        yield* ask(
          request(EDIT, owner, {
            id: planId,
            method: "POST",
            body: { document: { base, value } },
          }),
        );

        const { plan } = readAnswer(
          planAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(ONE_PLAN, owner, { id: planId })),
        );
        const renamed = readAnswer(
          planAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(
            request(ONE_PLAN, owner, {
              id: planId,
              method: "PATCH",
              body: { name: "Invitations by email" },
            }),
          ),
        ).plan;
        const listed = readAnswer(
          planListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(PLANS, owner)),
        ).plans;

        assert.deepEqual(plan.document, { body: value, assumptions: [] });
        assert.deepEqual(plan.sectionEdits, [
          { section: "Goal", actor: PLAN_ACTOR.NOTETAKER, at: notedAt, duringCall: true },
          {
            section: "Context",
            actor: PLAN_ACTOR.DEVELOPER,
            at: notedAt + Duration.toMillis(Duration.minutes(3)),
            duringCall: false,
          },
        ]);
        assert.equal(renamed.name, "Invitations by email");
        assert.deepEqual(renamed.document, plan.document);
        assert.deepEqual(
          listed.map(({ id, name }) => [id, name]),
          [[planId, "Invitations by email"]],
        );
      }),
  );

  it.effect(
    "a plan takes no field edit, and Luke's notes land in its sections as a revision naming him on each section they moved",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        yield* makeSavedDocumentPlan(planId, INVITATIONS_TEXT);

        const edited = yield* ask(
          request(EDIT, owner, {
            id: planId,
            method: "POST",
            body: { field: PLAN_FIELD.APPROACH, base: null, value: "Invites expire." },
          }),
        );
        const noted = yield* saveNotes({ userId: owner, planId }, [
          added(PLAN_HEADING.GOAL, "- Admins can withdraw an invite."),
          added(PLAN_HEADING.TESTING, "- When an invite expires, then its link says so."),
        ]);
        const { plan } = readAnswer(
          planAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(ONE_PLAN, owner, { id: planId })),
        );

        assert.deepEqual(
          edited,
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.equal(noted.status, PLAN_SAVE_STATUS.SAVED);
        assert.ok(
          plan.document.body.includes(
            "- Any member can invite a teammate by email.\n- Admins can withdraw an invite.\n",
          ),
        );
        assert.ok(
          plan.document.body.endsWith(
            "\n\n## Testing\n\n- When an invite expires, then its link says so.\n",
          ),
        );
        assert.equal(plan.lastEdit?.actor, PLAN_ACTOR.NOTETAKER);
        assert.deepEqual(
          plan.sectionEdits?.map(({ section, actor }) => [section, actor]),
          [
            ["Goal", PLAN_ACTOR.NOTETAKER],
            ["Testing", PLAN_ACTOR.NOTETAKER],
          ],
        );
      }),
  );

  it.effect(
    "the developer's edit of a plan saves their text as a revision of theirs, naming them on the sections it moved alone",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        yield* makeSavedDocumentPlan(planId, INVITATIONS_TEXT);
        const value = INVITATIONS_TEXT.replace("Only an admin", "Only an owner");

        const answered = readAnswer(
          planEditAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(
            request(EDIT, owner, {
              id: planId,
              method: "POST",
              body: { document: { base: INVITATIONS_TEXT, value } },
            }),
          ),
        );
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

        assert.ok("plan" in answered);
        const { plan } = answered;
        const at = plan.lastEdit?.at ?? assert.fail("the edit names no last edit");
        assert.deepEqual(plan.document, { body: value, assumptions: [] });
        assert.equal(plan.lastEdit?.actor, PLAN_ACTOR.DEVELOPER);
        assert.deepEqual(plan.sectionEdits, [
          { section: "Context", actor: PLAN_ACTOR.DEVELOPER, at, duringCall: false },
        ]);
        assert.deepEqual(
          page.revisions.map(({ seq, lastEdit, changes }) => [seq, lastEdit.actor, changes]),
          [
            [2, PLAN_ACTOR.DEVELOPER, 1],
            [1, PLAN_ACTOR.EARLIER, 0],
          ],
        );
        assert.deepEqual(revision.document, { body: value, assumptions: [] });
        assert.deepEqual(revision.previous, { body: INVITATIONS_TEXT, assumptions: [] });
      }),
  );

  it.effect(
    "a document edit keeps what Luke wrote meanwhile, answers a line he changed as the text stands, and refuses a text past the bound",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        const lukes = `${INVITATIONS_TEXT}- An accepted invite is never reused.\n`;
        yield* makeDocumentPlan(planId, lukes);
        const edit = (id: string, value: string) =>
          ask(
            request(EDIT, owner, {
              id,
              method: "POST",
              body: { document: { base: INVITATIONS_TEXT, value } },
            }),
          );

        // At the bound alone, but past it once laid over the line Luke added.
        const padding = "x".repeat(PLAN_BOUNDS.MAX_BODY_CHARS - INVITATIONS_TEXT.length);
        const oversized = yield* edit(
          planId,
          INVITATIONS_TEXT.replace("Only an admin", `Only an admin${padding}`),
        );
        const merged = readAnswer(
          planEditAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* edit(planId, INVITATIONS_TEXT.replace("Only an admin", "Only an owner")),
        );
        const conflicted = yield* edit(
          planId,
          INVITATIONS_TEXT.replace("Only an admin", "Only a workspace admin"),
        );

        assert.ok("plan" in merged);
        const mergedText = lukes.replace("Only an admin", "Only an owner");
        assert.equal(merged.plan.document.body, mergedText);
        assert.deepEqual(conflicted, {
          status: HOSTED_HTTP_STATUS.OK,
          body: { conflict: { current: mergedText } },
        });
        assert.deepEqual(oversized, {
          status: HOSTED_HTTP_STATUS.OK,
          body: { refused: PLAN_EDIT_REFUSAL.TOO_LONG },
        });
      }),
  );

  it.effect(
    "a plan takes back each revision of its text in turn, each restore a revision of the developer's naming the one it took back",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        const noted = yield* saveNotes({ userId: owner, planId }, [
          added(PLAN_HEADING.CONTEXT, "Only admins."),
        ]);
        const notedText =
          noted.status === PLAN_SAVE_STATUS.SAVED
            ? noted.document.body
            : assert.fail("the notes did not save");
        yield* makeDocumentPlan(planId, INVITATIONS_TEXT);
        yield* recordDocumentRevision(
          planId,
          2,
          INVITATIONS_TEXT,
          new Date(yield* Clock.currentTimeMillis),
        );

        const fromNotes = readAnswer(
          planAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(RESTORE, owner, { id: planId, method: "POST", query: { seq: "1" } })),
        ).plan;
        const fromText = readAnswer(
          planAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(RESTORE, owner, { id: planId, method: "POST", query: { seq: "2" } })),
        ).plan;
        const page = readAnswer(
          planRevisionsAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(REVISIONS, owner, { id: planId })),
        );

        assert.deepEqual(fromNotes.document, { body: notedText, assumptions: [] });
        assert.ok(notedText.includes("Only admins."));
        assert.deepEqual(fromText.document, { body: INVITATIONS_TEXT, assumptions: [] });
        assert.deepEqual(
          page.revisions.map(({ seq, restoredFrom }) => [seq, restoredFrom?.seq]),
          [
            [4, 2],
            [3, 1],
            [2, undefined],
            [1, undefined],
          ],
        );
      }),
  );
});
