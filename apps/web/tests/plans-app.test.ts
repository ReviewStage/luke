import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { writePage } from "@luke/database/models/plan-pages";
import { PLAN_REVISION } from "@luke/database/models/plan-revisions";
import { createTask } from "@luke/database/models/task-store";
import { personalWorkspaceOf } from "@luke/database/models/workspace-store";
import { user } from "@luke/database/schemas/auth";
import { voiceSessions, voiceTranscriptSegments } from "@luke/database/schemas/voice";
import {
  fakeWorkspaceSeams,
  getTestDB,
  joinWorkspace,
  openWorkspace,
} from "@luke/database/testing";
import {
  VOICE_CLOSE_REASON,
  VOICE_DELEGATION_MODE,
  VOICE_SEGMENT_ROLE,
  type VoiceSegmentRole,
} from "@luke/database/voice-vocabulary";
import { BOARD_ELEMENT_TYPE } from "@luke/features/board-vocabulary";
import { boardAnswerSchema } from "@luke/features/board-wire";
import {
  CODING_AGENT_STATUS,
  codingAgentMessagesAnswerSchema,
} from "@luke/features/coding-agent-wire";
import { DEFAULT_PLAN_TEMPLATE } from "@luke/features/plan-document-template";
import { PLAN_EDIT_REFUSAL, planEditAnswerSchema } from "@luke/features/plan-edit";
import { PLAN_HEADING } from "@luke/features/plan-template";
import {
  REPOSITORY_UNREACHED,
  type RepositoryUnreached,
} from "@luke/features/repository-reach-wire";
import {
  PLAN_ACTOR,
  PLAN_FIELD,
  planRevisionAnswerSchema,
  planRevisionsAnswerSchema,
  TASK_BOUNDS,
  TASK_FILE_REFUSAL,
  taskAnswerSchema,
  taskFileAnswerSchema,
  taskListAnswerSchema,
  UNTITLED_TASK_NAME,
} from "@luke/features/task-wire";
import { taskWorkAnswerSchema } from "@luke/features/tasks-view";
import {
  TRANSCRIPT_PART_TYPE,
  type TranscriptMessage,
  taskTranscriptAnswerSchema,
} from "@luke/features/transcript-wire";
import { TRANSCRIPT_SPEAKER } from "@luke/live";
import { LINK_OUTCOME } from "@luke/service/github/github-installations";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "@luke/service/http/http";
import { modelCatalogOf } from "@luke/service/providers/model-catalog";
import { DRAW_ON_BOARD_STATUS, runDrawOnBoard } from "@luke/service/tasks/board-tool";
import { PLAN_SAVE_STATUS, saveNotes } from "@luke/service/tasks/plan-notes";
import { tasksApp } from "@luke/service/tasks/tasks-app";
import {
  connectWorkspaceGitHub,
  type FakeGitHub,
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  githubReaching,
  type InstallationFixture,
  NO_GITHUB,
  openGithubUser,
  type SentToGitHub,
} from "@luke/service/testing/github-app-fake";
import { integrationConnectOver } from "@luke/service/testing/integration-connect";
import {
  INVITATIONS_TEXT,
  makeDocumentTask,
  makeSavedDocumentTask,
} from "@luke/service/testing/plan-documents";
import { added } from "@luke/service/testing/task-contents";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { eq } from "drizzle-orm";
import { Clock, Duration, Effect, Layer, Option, Result, type Schema } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { dispatched } from "./support/platform-landing";

/**
 * The Plans tab's plan routes, answered by the group the way a
 * function answers them, over a real dialect: the bearer names the account
 * and nothing else does, a plan another account owns answers exactly as one
 * that does not exist, and what the notetaker's notes saved is what the window opens.
 * The path is the one the rewrite hands the group, the plan id moved from
 * the path into the `id` query. A plan's repository is kept only once the
 * Luke GitHub App, over a GitHub the test scripts, confirms the
 * installation connected to the plan's workspace reaches it.
 *
 * Synthetic accounts, bearers, tokens, and repositories throughout.
 */

const ORIGIN = "https://luke.test";
const PLANS = "/api/plans";
const ONE_PLAN = "/api/plans/plan";
const BOARD = "/api/plans/board";
const TRANSCRIPT = "/api/plans/transcript";
const WORK = "/api/plans/work";
const MESSAGES = "/api/plans/messages";
const SUBAGENT_MESSAGES = "/api/plans/subagent-messages";
const CODE = "/api/plans/code";
const FILE = "/api/plans/file";
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
    const db = yield* Database;
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
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      github.layer,
      modelCatalogOf([]),
      integrationConnectOver({ LINEAR_CONNECTOR_UID: "oauth/linear" }),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      tasksApp({
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
  return readAnswer(taskAnswerSchema, HOSTED_HTTP_STATUS.CREATED, started).plan.id;
}

const refusal = (status: number, error: string): Answer => ({ status, body: { error } });

/** The repository out of reach, with why, as the routes refuse it. */
const unreachable = (unreached: RepositoryUnreached): Answer => ({
  status: HOSTED_HTTP_STATUS.FORBIDDEN,
  body: { error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE, unreached },
});

/** What the contents API holds of the fixture repository, by path: a file's text, a directory, a link, or a file past the bound. */
const CONTENTS = new Map([
  ["src/invite.ts", () => fileContents(`one\ntwo\n${"x".repeat(500)}\nfour`)],
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

/** The installation reaching the fixture repository, under the id given: every test sharing the database connects its own, since one installation stands for one workspace. */
const relayInstallation = (id: number): InstallationFixture => ({
  id,
  login: "Acme",
  repositories: [{ owner: "Acme", name: "Relay" }],
});

/** A workspace the account owns with the installation connected to it, as a finished connect leaves it; its id. */
const openConnectedWorkspace = (ownerId: string, installation: InstallationFixture) =>
  Effect.gen(function* () {
    const workspaceId = yield* openWorkspace(ownerId);
    assert.equal(yield* connectWorkspaceGitHub(workspaceId, installation), LINK_OUTCOME.LINKED);
    return workspaceId;
  });

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
    const db = yield* Database;
    const [row] = yield* db
      .insert(voiceSessions)
      .values({
        userId: input.userId,
        taskId: input.planId,
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

/** One line as the transcript answers it: its place on the call, the speaker as the role, the words as one text part, and where on the call it began and ended. */
function spoken(
  index: number,
  role: TranscriptMessage["role"],
  text: string,
  span: readonly [startMs: number, endMs: number],
): TranscriptMessage {
  const [startMs, endMs] = span;
  return {
    id: String(index),
    role,
    parts: [{ type: TRANSCRIPT_PART_TYPE.TEXT, text }],
    metadata: { span: { startMs, endMs } },
  };
}

/** Luke's drawing of one labelled box. */
const DRAW_API = {
  elements: [{ type: BOARD_ELEMENT_TYPE.RECTANGLE, id: "api", x: 0, y: 0, label: "API" }],
};

it.layer(getTestDB())("the plan routes", (it) => {
  it.effect("a started plan lists, and opens with what its notes saved", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      const planId = startedId(yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })));
      const saved = yield* saveNotes({ userId: owner, taskId: planId }, [
        added(PLAN_HEADING.CONTEXT, "Only admins can invite."),
        added(PLAN_HEADING.OPEN_QUESTIONS, "- Who can withdraw an invite?"),
      ]);
      assert.equal(saved.status, PLAN_SAVE_STATUS.SAVED);

      const listed = yield* ask(request(PLANS, owner));
      const opened = yield* ask(request(ONE_PLAN, owner, { id: planId }));

      assert.deepEqual(
        readAnswer(taskListAnswerSchema, HOSTED_HTTP_STATUS.OK, listed).plans.map((plan) => [
          plan.id,
          plan.name,
        ]),
        [[planId, RELAY.name]],
      );
      assert.deepEqual(
        readAnswer(taskAnswerSchema, HOSTED_HTTP_STATUS.OK, opened).plan.document,
        saved.status === PLAN_SAVE_STATUS.SAVED ? saved.document : undefined,
      );
    }),
  );

  it.effect(
    "a start with no name, or a blank one, opens as Untitled; a name past its bound is refused",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const start = (body: WireBoundaryInput) =>
          ask(request(PLANS, owner, { method: "POST", body }));
        const nameOf = (answer: Answer) =>
          readAnswer(taskAnswerSchema, HOSTED_HTTP_STATUS.CREATED, answer).plan.name;

        const unnamed = yield* start({});
        const blank = yield* start({ name: "   " });
        const overlong = yield* start({ name: "x".repeat(TASK_BOUNDS.MAX_NAME_CHARS + 1) });

        assert.equal(nameOf(unnamed), UNTITLED_TASK_NAME);
        assert.equal(nameOf(blank), UNTITLED_TASK_NAME);
        assert.deepEqual(
          overlong,
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
      }),
  );

  it.effect("a start opens as the template, and one without planning opens empty", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      const documentOf = (answer: Answer) =>
        readAnswer(taskAnswerSchema, HOSTED_HTTP_STATUS.CREATED, answer).plan.document;

      const planned = yield* ask(request(PLANS, owner, { method: "POST", body: RELAY }));
      const unplanned = yield* ask(
        request(PLANS, owner, { method: "POST", body: { ...LEDGER, planning: false } }),
      );

      assert.equal(documentOf(planned).body, DEFAULT_PLAN_TEMPLATE);
      assert.deepEqual(documentOf(unplanned), { body: "", assumptions: [] });
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
        readAnswer(taskAnswerSchema, HOSTED_HTTP_STATUS.CREATED, started).plan.workspaceId,
        personal.value,
      );
      const listed = yield* ask(request(PLANS, owner));
      assert.deepEqual(
        readAnswer(taskListAnswerSchema, HOSTED_HTTP_STATUS.OK, listed).plans.map(
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
        readAnswer(taskAnswerSchema, HOSTED_HTTP_STATUS.CREATED, started).plan.workspaceId,
        shared,
      );
      const listed = yield* ask(request(PLANS, owner));
      assert.deepEqual(
        readAnswer(taskListAnswerSchema, HOSTED_HTTP_STATUS.OK, listed).plans.map((plan) => [
          plan.name,
          plan.workspaceId,
        ]),
        [[RELAY.name, shared]],
      );
    }),
  );

  it.effect(
    "a shared plan names the account that started it, by the name it holds now, to every member alike",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const shared = yield* openWorkspace(other);
        yield* joinWorkspace(shared, owner);
        const planId = startedId(
          yield* ask(
            request(PLANS, owner, { method: "POST", body: { ...RELAY, workspaceId: shared } }),
          ),
        );
        const db = yield* Database;
        yield* db.update(user).set({ name: "Charles Pan" }).where(eq(user.id, owner));

        const ownersOf = (bearer: string) =>
          Effect.map(ask(request(PLANS, bearer)), (listed) =>
            readAnswer(taskListAnswerSchema, HOSTED_HTTP_STATUS.OK, listed).plans.map((plan) => [
              plan.ownerId,
              plan.createdBy,
            ]),
          );
        const opened = readAnswer(
          taskAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(ONE_PLAN, other, { id: planId })),
        ).plan;
        const creator = { userId: owner, name: "Charles Pan" };

        assert.deepEqual(yield* ownersOf(owner), [[owner, creator]]);
        assert.deepEqual(
          yield* ownersOf(other),
          [[owner, creator]],
          "the teammate reads who started it",
        );
        assert.deepEqual([opened.ownerId, opened.createdBy], [owner, creator]);
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
        assert.deepEqual(readAnswer(taskListAnswerSchema, HOSTED_HTTP_STATUS.OK, listed).plans, []);
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
        body: { plans: [], planlessAgents: [] },
      });
      assert.equal(
        (yield* ask(request(ONE_PLAN, owner, { id: planId }))).status,
        HOSTED_HTTP_STATUS.OK,
      );
      for (const path of [MESSAGES, CODE]) {
        assert.deepEqual(yield* ask(request(path, other, { id: planId })), notFound);
      }
      assert.deepEqual(
        yield* ask(request(SUBAGENT_MESSAGES, other, { id: planId, query: { call: "call-0-0" } })),
        notFound,
      );
    }),
  );

  it.effect(
    "a plan never planned on reads as an empty conversation on the agent tab's wire, and as no code shown",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );

        const read = yield* ask(request(MESSAGES, owner, { id: planId }));
        const page = readAnswer(codingAgentMessagesAnswerSchema, HOSTED_HTTP_STATUS.OK, read);
        assert.deepEqual(
          [page.messages, page.status, page.earlier],
          [[], CODING_AGENT_STATUS.COMPLETED, undefined],
        );
        assert.deepEqual(yield* ask(request(CODE, owner, { id: planId })), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { code: [] },
        });
        assert.equal(
          (yield* ask(
            request(MESSAGES, owner, { id: planId, query: { after: "0:0", before: planId } }),
          )).status,
          HOSTED_HTTP_STATUS.BAD_REQUEST,
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

  it.effect(
    "a start from a Linear issue in a workspace with no Linear connected is refused, and starts no plan",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();

        const refused = yield* ask(
          request(PLANS, owner, { method: "POST", body: { ...RELAY, linearIssueId: "issue-1" } }),
        );

        assert.deepEqual(
          refused,
          refusal(HOSTED_HTTP_STATUS.CONFLICT, HOSTED_API_ERROR.LINEAR_UNAVAILABLE),
        );
        assert.deepEqual(yield* ask(request(PLANS, owner)), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { plans: [], planlessAgents: [] },
        });
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
          body: { plans: [], planlessAgents: [] },
        });
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

        assert.deepEqual(
          [unchosen, elsewhere],
          [
            unreachable({ reason: REPOSITORY_UNREACHED.NOT_CONNECTED, repository: "acme/ledger" }),
            unreachable({
              reason: REPOSITORY_UNREACHED.NOT_CONNECTED,
              repository: "octocat/relay",
            }),
          ],
        );
        const opened = readAnswer(
          taskAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(ONE_PLAN, owner, { id: planId })),
        );
        assert.deepEqual([opened.plan.name, opened.plan.repository], [RELAY.name, null]);
        assert.equal(
          readAnswer(taskListAnswerSchema, HOSTED_HTTP_STATUS.OK, yield* ask(request(PLANS, owner)))
            .plans.length,
          1,
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
          (yield* runDrawOnBoard({ userId: other, taskId: planId }, unparsedWire(DRAW_API))).status,
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
              readAnswer(taskTranscriptAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).transcript,
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
                spoken(0, TRANSCRIPT_SPEAKER.USER, "Invites should expire.", [0, 1_200]),
                spoken(1, TRANSCRIPT_SPEAKER.ASSISTANT, "Mm.", [600, 1_100]),
                spoken(2, TRANSCRIPT_SPEAKER.ASSISTANT, "After how many days?", [9_000, 9_500]),
              ],
              by: { userId: owner, name: "Test User" },
            },
            {
              id: second,
              startedAt: 2_000_000,
              messages: [spoken(0, TRANSCRIPT_SPEAKER.USER, "Seven days.", [0, 500])],
              by: { userId: owner, name: "Test User" },
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
    "a teammate's call about a shared plan reads in every member's transcript, with what its record holds and whose call it was",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const started = readAnswer(
          taskAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        ).plan;
        yield* joinWorkspace(started.workspaceId, other);
        const read = (userId: string) =>
          Effect.map(
            ask(request(TRANSCRIPT, userId, { id: started.id })),
            (answered) =>
              readAnswer(taskTranscriptAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).transcript,
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
            },
          },
          [[USER, "After seven days.", 0]],
        );

        const expected = {
          calls: [
            {
              id: ownersCall,
              startedAt: 1_000_000,
              messages: [spoken(0, TRANSCRIPT_SPEAKER.USER, "Invites should expire.", [0, 500])],
              by: { userId: owner, name: "Test User" },
            },
            {
              id: teammatesCall,
              startedAt: 2_000_000,
              messages: [spoken(0, TRANSCRIPT_SPEAKER.USER, "After seven days.", [0, 500])],
              endedAt: 2_060_000,
              ending: VOICE_CLOSE_REASON.CONNECTION_LOST,
              usage: { seconds: 60, confirmed: false },
              // Whose call each was, which every member reads the same and the window says.
              by: { userId: other, name: "Test User" },
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
        taskAnswerSchema,
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
            taskWorkAnswerSchema,
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

  it.effect(
    "a file of the plan's repository reads a window as GitHub holds it on the default branch, naming that branch, on the App's token, each line cut as show_code cuts it; another account's plan reads as none",
    () =>
      Effect.gen(function* () {
        const relay = relayInstallation(7001);
        const github = githubReaching([relay], undefined, {}, contentsOf);
        const { owner, other, ask } = yield* openAccounts(github);
        const workspaceId = yield* openConnectedWorkspace(owner, relay);
        const planId = startedId(
          yield* ask(
            request(PLANS, owner, {
              method: "POST",
              body: { ...RELAY, workspaceId, repository: "acme/relay" },
            }),
          ),
        );
        const window = (userId: string, path: string, first: string, last: string) =>
          ask(request(FILE, userId, { id: planId, query: { path, first, last } }));

        const read = readAnswer(
          taskFileAnswerSchema,
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
            taskFileAnswerSchema,
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
    "a window of the default branch names the commit its head stands at, and is read at that commit, so lines picked from it pin to it",
    () =>
      Effect.gen(function* () {
        const head = "0123456789abcdef0123456789abcdef01234567";
        const relay = relayInstallation(7011);
        const github = githubReaching([relay], undefined, {}, (sent) =>
          new URL(sent.url).pathname === "/repos/Acme/Relay/git/ref/heads/main"
            ? Response.json({ ref: "refs/heads/main", object: { type: "commit", sha: head } })
            : contentsOf(sent),
        );
        const { owner, ask } = yield* openAccounts(github);
        const workspaceId = yield* openConnectedWorkspace(owner, relay);
        const planId = startedId(
          yield* ask(
            request(PLANS, owner, {
              method: "POST",
              body: { ...RELAY, workspaceId, repository: "acme/relay" },
            }),
          ),
        );

        const read = readAnswer(
          taskFileAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(
            request(FILE, owner, {
              id: planId,
              query: { path: "src/invite.ts", first: "1", last: "2" },
            }),
          ),
        );

        assert.deepEqual(read, {
          file: {
            path: "src/invite.ts",
            repository: "Acme/Relay",
            branch: "main",
            commit: head,
            firstLine: 1,
            lineCount: 4,
            lines: ["one", "two"],
          },
        });
        const asked = github.sent.find((sent) => CONTENTS_PATH.test(new URL(sent.url).pathname));
        assert.equal(new URL(asked?.url ?? ORIGIN).searchParams.get("ref"), head);
      }),
  );

  it.effect(
    "a file is refused by the rule show_code keeps: a secret file and a path leaving the tree before GitHub is asked, and a missing file, a directory, a link, and a file too large or not text by name, one GitHub found nothing at naming the branch it was looked for on",
    () =>
      Effect.gen(function* () {
        const relay = relayInstallation(7002);
        const github = githubReaching([relay], undefined, {}, contentsOf);
        const { owner, ask } = yield* openAccounts(github);
        const workspaceId = yield* openConnectedWorkspace(owner, relay);
        const planId = startedId(
          yield* ask(
            request(PLANS, owner, {
              method: "POST",
              body: { ...RELAY, workspaceId, repository: "acme/relay" },
            }),
          ),
        );
        const refusalOf = (path: string) =>
          Effect.map(
            ask(request(FILE, owner, { id: planId, query: { path, first: "1", last: "10" } })),
            (answered) => readAnswer(taskFileAnswerSchema, HOSTED_HTTP_STATUS.OK, answered),
          );
        const asked = () =>
          github.sent.filter((sent) => CONTENTS_PATH.test(new URL(sent.url).pathname)).length;

        assert.deepEqual(yield* refusalOf("config/.env.local"), {
          refusal: TASK_FILE_REFUSAL.SECRET,
        });
        const missing = { refusal: TASK_FILE_REFUSAL.MISSING };
        assert.deepEqual(yield* refusalOf("src/../../other/secret.ts"), missing);
        assert.equal(asked(), 0, "neither is asked of GitHub");
        assert.deepEqual(
          yield* refusalOf("gone.ts"),
          { ...missing, branch: "main" },
          "nothing at the path names the branch it was looked for on",
        );
        assert.deepEqual(yield* refusalOf("src"), missing, "a directory is on the branch");
        assert.deepEqual(yield* refusalOf("linked.ts"), missing, "a link is on the branch");
        assert.deepEqual(yield* refusalOf("big.json"), { refusal: TASK_FILE_REFUSAL.NOT_TEXT });
        assert.deepEqual(yield* refusalOf("assets/logo.png"), {
          refusal: TASK_FILE_REFUSAL.NOT_TEXT,
        });
      }),
  );

  it.effect(
    "a member who never signed in with GitHub reads a file of the plan's repository through the installation connected to the workspace",
    () =>
      Effect.gen(function* () {
        const relay = relayInstallation(7003);
        const github = githubReaching([relay], undefined, {}, contentsOf);
        const { owner, other, ask } = yield* openAccounts(github);
        const workspaceId = yield* openConnectedWorkspace(owner, relay);
        yield* joinWorkspace(workspaceId, other);
        const planId = startedId(
          yield* ask(
            request(PLANS, owner, {
              method: "POST",
              body: { ...RELAY, workspaceId, repository: "acme/relay" },
            }),
          ),
        );

        // The member has no GitHub account row, so the read can only go through the installation.
        const read = readAnswer(
          taskFileAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(
            request(FILE, other, {
              id: planId,
              query: { path: "src/invite.ts", first: "1", last: "2" },
            }),
          ),
        );
        assert.deepEqual(read, {
          file: {
            path: "src/invite.ts",
            repository: "Acme/Relay",
            branch: "main",
            firstLine: 1,
            lineCount: 4,
            lines: ["one", "two"],
          },
        });
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
      yield* saveNotes({ userId, taskId: planId }, [
        added(PLAN_HEADING.CONTEXT, "Only admins can invite."),
      ]);
      yield* TestClock.adjust(Duration.millis(PLAN_REVISION.JOIN_WITHIN_MS + 1));
      yield* saveNotes({ userId, taskId: planId }, [
        added(PLAN_HEADING.GOAL, "Members invite by email."),
      ]);
    });

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
    "the developer's edit of a plan saves their text as a revision of theirs, naming them on the sections it moved alone",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const planId = startedId(
          yield* ask(request(PLANS, owner, { method: "POST", body: RELAY })),
        );
        yield* makeSavedDocumentTask(planId, INVITATIONS_TEXT);
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
        const by = plan.lastEdit?.by ?? assert.fail("the edit names no member");
        assert.equal(by.userId, owner);
        assert.deepEqual(plan.sectionEdits, [
          { section: "Context", actor: PLAN_ACTOR.DEVELOPER, by, at, duringCall: false },
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
        yield* makeDocumentTask(planId, lukes);
        const edit = (id: string, value: string) =>
          ask(
            request(EDIT, owner, {
              id,
              method: "POST",
              body: { document: { base: INVITATIONS_TEXT, value } },
            }),
          );

        // At the bound alone, but past it once laid over the line Luke added.
        const padding = "x".repeat(TASK_BOUNDS.MAX_BODY_CHARS - INVITATIONS_TEXT.length);
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
    "a plan takes only its workspace installation's repositories, at its start and in a change, and a personal workspace with nothing connected takes none",
    () =>
      Effect.gen(function* () {
        const acmeInstallation = {
          id: 7101,
          login: "acme",
          accountId: 9101,
          repositories: [{ owner: "acme", name: "relay" }],
        };
        const github = githubReaching([
          acmeInstallation,
          { id: 7102, login: "octocat", repositories: [{ owner: "octocat", name: "dotfiles" }] },
        ]);
        const { owner, ask } = yield* openAccounts(github);
        const acme = yield* openConnectedWorkspace(owner, acmeInstallation);
        const start = (body: WireBoundaryInput) =>
          ask(request(PLANS, owner, { method: "POST", body }));
        const change = (planId: string, repository: string) =>
          ask(request(ONE_PLAN, owner, { id: planId, method: "PATCH", body: { repository } }));
        const repositoryOf = (status: number, answered: Answer) =>
          readAnswer(taskAnswerSchema, status, answered).plan.repository;
        const ofOtherOwner = unreachable({
          reason: REPOSITORY_UNREACHED.OTHER_OWNER,
          repository: "octocat/dotfiles",
          connectedTo: "acme",
        });
        const notConnected = (repository: string) =>
          unreachable({ reason: REPOSITORY_UNREACHED.NOT_CONNECTED, repository });

        const relay = yield* start({ ...RELAY, workspaceId: acme, repository: "acme/relay" });
        const otherStart = yield* start({
          ...LEDGER,
          workspaceId: acme,
          repository: "octocat/dotfiles",
        });
        const unnamed = startedId(yield* start({ ...LEDGER, workspaceId: acme }));
        const otherChange = yield* change(unnamed, "octocat/dotfiles");
        const ownChange = yield* change(unnamed, "acme/relay");
        // The personal workspace has nothing connected, so even the repository the account's own workspace reaches is refused there.
        const personalStart = yield* start({ ...LEDGER, repository: "acme/relay" });
        const personal = startedId(yield* start(LEDGER));
        const personalChanges = [
          yield* change(personal, "octocat/dotfiles"),
          yield* change(personal, "acme/relay"),
        ];

        assert.equal(repositoryOf(HOSTED_HTTP_STATUS.CREATED, relay), "acme/relay");
        assert.deepEqual([otherStart, otherChange], [ofOtherOwner, ofOtherOwner]);
        assert.equal(repositoryOf(HOSTED_HTTP_STATUS.OK, ownChange), "acme/relay");
        assert.deepEqual(
          [personalStart, ...personalChanges],
          [
            notConnected("acme/relay"),
            notConnected("octocat/dotfiles"),
            notConnected("acme/relay"),
          ],
        );
        const opened = readAnswer(
          taskAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(ONE_PLAN, owner, { id: personal })),
        );
        assert.equal(opened.plan.repository, null);
        const listed = readAnswer(
          taskListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(PLANS, owner)),
        );
        assert.equal(listed.plans.length, 3);
      }),
  );

  it.effect(
    "a plan's owner moves it to a workspace of theirs whose GitHub reaches its repository; a teammate may not, a workspace the owner is not in answers as none, and one that does not reach the repository says why",
    () =>
      Effect.gen(function* () {
        const acmeInstallation = {
          id: 7201,
          login: "acme",
          accountId: 9201,
          repositories: [{ owner: "acme", name: "relay" }],
        };
        const octocatInstallation = {
          id: 7202,
          login: "octocat",
          accountId: 9202,
          repositories: [{ owner: "octocat", name: "dotfiles" }],
        };
        const github = githubReaching([acmeInstallation, octocatInstallation]);
        const { owner, other, ask } = yield* openAccounts(github);
        const bare = yield* openWorkspace(owner);
        const acme = yield* openConnectedWorkspace(owner, acmeInstallation);
        const octocat = yield* openConnectedWorkspace(owner, octocatInstallation);
        const strangers = yield* openWorkspace(other);
        yield* joinWorkspace(bare, other);
        const plan = yield* createTask(owner, {
          organizationId: bare,
          name: RELAY.name,
          repository: "acme/relay",
        });
        const move = (bearer: string, workspaceId: string) =>
          ask(request(ONE_PLAN, bearer, { id: plan.id, method: "PATCH", body: { workspaceId } }));

        const byTeammate = yield* move(other, acme);
        const toStrangers = yield* move(owner, strangers);
        const toOctocat = yield* move(owner, octocat);
        const toAcme = yield* move(owner, acme);

        assert.deepEqual(
          byTeammate,
          refusal(HOSTED_HTTP_STATUS.FORBIDDEN, HOSTED_API_ERROR.NOT_PERMITTED),
        );
        assert.deepEqual(
          toStrangers,
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          toOctocat,
          unreachable({
            reason: REPOSITORY_UNREACHED.OTHER_OWNER,
            repository: "acme/relay",
            connectedTo: "octocat",
          }),
        );
        const moved = readAnswer(taskAnswerSchema, HOSTED_HTTP_STATUS.OK, toAcme).plan;
        assert.deepEqual([moved.workspaceId, moved.repository], [acme, "acme/relay"]);
        // The teammate was in the workspace the plan left, not the one it moved to.
        assert.deepEqual(
          yield* ask(request(ONE_PLAN, other, { id: plan.id })),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
      }),
  );
});
