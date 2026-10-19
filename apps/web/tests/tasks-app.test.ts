import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createIssue } from "@luke/database/models/issue-store";
import { writePage } from "@luke/database/models/plan-pages";
import { PLAN_REVISION } from "@luke/database/models/plan-revisions";
import { claimRuntimeSession } from "@luke/database/models/recorded-session";
import { createTask, openTaskConversation, readTask } from "@luke/database/models/task-store";
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
import { PAGE_SHOWER } from "@luke/features/page-wire";
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
import { EVE_RESET_OUTCOME, type EveSessions } from "@luke/service/agents/brain-host/eve-sessions";
import { messagesProcedures } from "@luke/service/agents/messages-procedures";
import {
  requestUserId,
  type SessionEndpoint,
  type UserInfoEndpoint,
} from "@luke/service/auth/bearer";
import { LINK_OUTCOME } from "@luke/service/github/github-installations";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "@luke/service/http/http";
import { hostedFetch } from "@luke/service/orpc/handler";
import { modelCatalogOf } from "@luke/service/providers/model-catalog";
import type { WebServices } from "@luke/service/runtime";
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
import {
  Clock,
  type Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Result,
  type Schema,
  Stream,
} from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { dispatched } from "./support/platform-landing";

/**
 * The Tasks tab's task routes, answered by the group the way a
 * function answers them, over a real dialect: the bearer names the account
 * and nothing else does, a task another account owns answers exactly as one
 * that does not exist, and what the notetaker's notes saved is what the window opens.
 * A plan's own routes are asked at the path a client sends, landed through
 * the committed rewrites on the hosted oRPC router; the old group's at the
 * path the rewrite hands it, the task id moved from the path into the `id`
 * query. A task's repository is kept only once the
 * Luke GitHub App, over a GitHub the test scripts, confirms the
 * installation connected to the task's workspace reaches it.
 *
 * Synthetic accounts, bearers, tokens, and repositories throughout.
 */

const ORIGIN = "https://luke.test";
const TASKS = "/api/plans";
const ONE_TASK = (taskId: string) => `${TASKS}/${taskId}`;
const BOARD = (taskId: string) => `${ONE_TASK(taskId)}/board`;
const TRANSCRIPT = (taskId: string) => `${ONE_TASK(taskId)}/transcript`;
const WORK = (taskId: string) => `${ONE_TASK(taskId)}/work`;
const MESSAGES = "/api/plans/messages";
const SUBAGENT_MESSAGES = "/api/plans/subagent-messages";
const CODE = "/api/plans/code";
const FILE = "/api/plans/file";
const REVISIONS = (taskId: string) => `${ONE_TASK(taskId)}/revisions`;
const REVISION = (taskId: string, seq: number) => `${REVISIONS(taskId)}/${seq}`;
const RESTORE = (taskId: string, seq: number) => `${REVISION(taskId, seq)}/restore`;
const EDIT = (taskId: string) => `${ONE_TASK(taskId)}/edit`;
const STOP = (taskId: string) => `${ONE_TASK(taskId)}/stop`;
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

/** How the fake eve writes down the deployment acting for an account, apart from any bearer a request carried. */
function deploymentFor(account: string): string {
  return `deployment for ${account}`;
}

/**
 * eve as a task's delete reaches it: each retire written down with who asked
 * it, over the request's bearer or as the deployment acting for an account;
 * a task here has no coding agent, so its delete asks eve nothing else, and
 * `coding-agents-app.test.ts` deletes one that has.
 */
function retiringEve() {
  const retired: (readonly [string, string])[] = [];
  const asked = (caller: string): EveSessions => ({
    open: () => Effect.die(new Error("a task's delete opens no session")),
    send: () => Effect.die(new Error("a task's delete sends no message")),
    cancel: () => Effect.die(new Error("a task with no agent has no turn to cancel")),
    reset: (sessionId) =>
      Effect.sync(() => {
        retired.push([caller, sessionId]);
        return { outcome: EVE_RESET_OUTCOME.RESET };
      }),
    stream: () => Stream.empty,
  });
  return {
    retired,
    eve: (authorization: Redacted.Redacted) => asked(Redacted.value(authorization)),
    eveAs: (account: string) => asked(deploymentFor(account)),
  };
}

/**
 * Two accounts, each behind its own bearer. The owner signed in with GitHub
 * through the App; the other signed in with Google alone, and reaches
 * nothing on GitHub. eve is a fake that writes down each retire, unless the
 * test asks for none, when the deployment composes its own: on an
 * environment naming no secret, over a network nothing answers on.
 */
const openAccounts = (
  github: FakeGitHub = UNREACHED_GITHUB,
  options: { readonly reachesEve?: boolean } = {},
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const owner = yield* openGithubUser();
    const other = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: other, name: "Test User", email: `${other}@luke.test` });
    const signedIn: SignedIn = {
      bearers: new Map([
        [`Bearer ${owner}`, owner],
        [`Bearer ${other}`, other],
      ]),
      sessions: new Map([
        [sessionCookieOf(owner), owner],
        [sessionCookieOf(other), other],
      ]),
    };
    const eve = options.reachesEve === false ? undefined : retiringEve();
    const ask = (request: Request, landedAs?: string) =>
      answer(signedIn, github, eve, request, landedAs);
    return { owner, other, ask, retired: eve?.retired ?? [] };
  });

/** How the suite's accounts sign in: each one's OAuth bearer, and the session cookie of a browser signed in to it. */
interface SignedIn {
  readonly bearers: ReadonlyMap<string, string>;
  readonly sessions: ReadonlyMap<string, string>;
}

/** The cookie a browser signed in to the account sends, as the faked auth service reads it. */
function sessionCookieOf(userId: string): string {
  return `better-auth.session_token=${userId}`;
}

/** The auth service's userinfo over the suite's bearers. */
function userInfoOf(bearers: ReadonlyMap<string, string>): UserInfoEndpoint {
  return (input) => {
    const sub = bearers.get(input.headers.get("authorization") ?? "");
    return Effect.succeed(sub === undefined ? undefined : { sub });
  };
}

/** The auth service's session read over the suite's session cookies. */
function sessionOf(sessions: ReadonlyMap<string, string>): SessionEndpoint {
  return (input) =>
    Effect.succeed(Option.fromNullishOr(sessions.get(input.headers.get("cookie") ?? "")));
}

/** The flattened paths the old group still serves, which a request names as the rewrite hands them to it. */
const GROUP_PATHS: ReadonlySet<string> = new Set([MESSAGES, SUBAGENT_MESSAGES, CODE, FILE, PAGE]);

/** The route keys the hosted oRPC router answers, as `tasks-procedures.ts` serves them. */
const TASK_ROUTES = [
  "plans",
  "plans/plan",
  "plans/board",
  "plans/edit",
  "plans/revisions",
  "plans/revision",
  "plans/restore",
  "plans/transcript",
  "plans/work",
  "plans/stop",
] as const;

/**
 * The routes over the test's own database and the GitHub given, answering
 * one request: a plan's own routes as a client sends them, landed by the
 * platform through the committed rewrites and the grouped function's
 * dispatcher on the hosted oRPC router; the old group's at its own
 * flattened path, or, where a route key is named, landed on a function
 * holding the group under that key.
 */
const answer = (
  signedIn: SignedIn,
  github: FakeGitHub,
  eve: ReturnType<typeof retiringEve> | undefined,
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
    const seams = {
      // The account read as `resolveHostedUserId` reads it: the bearer where one is carried, else the session cookie.
      resolveUserId: (incoming: Request) =>
        requestUserId(incoming, userInfoOf(signedIn.bearers), sessionOf(signedIn.sessions)),
      workspaces: yield* fakeWorkspaceSeams,
      eveOrigin: () => ORIGIN,
      ...(eve === undefined ? undefined : { eve: eve.eve, eveAs: eve.eveAs }),
    };
    const { handler, dispose } = HttpRouter.toWebHandler(
      tasksApp(seams).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    // SAFETY: the plans and transcript procedures yield the services above alone, which is all a test provides of the web runtime's services.
    const webServices = (yield* Effect.context<never>().pipe(
      Effect.provide(services),
    )) as Context.Context<WebServices>;
    const routed = hostedFetch(hostedRouter(seams));
    const tasksRoute = { fetch: (each: Request) => routed(each, webServices) };
    /** A task's transcript reads are the hosted oRPC router's, at the public paths their rewrites carry; the rest of the old group's flattened paths are its own. */
    const flattened = (each: Request): Promise<Response> => {
      const url = new URL(each.url);
      const id = url.searchParams.get("id") ?? "";
      const call = url.searchParams.get("call") ?? "";
      if (url.pathname === MESSAGES) {
        url.pathname = `/api/plans/${encodeURIComponent(id)}/messages`;
        return routed(new Request(url, each), webServices);
      }
      if (url.pathname === SUBAGENT_MESSAGES) {
        url.pathname = `/api/plans/${encodeURIComponent(id)}/subagents/${encodeURIComponent(call)}/messages`;
        return routed(new Request(url, each), webServices);
      }
      return handler(each);
    };
    const response = yield* Effect.promise(() => {
      if (landedAs !== undefined) {
        return dispatched(request, new Map([[landedAs, { fetch: (each) => flattened(each) }]]));
      }
      if (GROUP_PATHS.has(new URL(request.url).pathname)) return flattened(request);
      return dispatched(request, new Map(TASK_ROUTES.map((route) => [route, tasksRoute])));
    });
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
    /** A browser's session cookie, sent beside the bearer or, with no account named, in its place. */
    cookie?: string;
  } = {},
): Request {
  const url = new URL(path, ORIGIN);
  if (init.id !== undefined) url.searchParams.set("id", init.id);
  for (const [name, value] of Object.entries(init.query ?? {})) url.searchParams.set(name, value);
  if (init.command !== undefined) url.searchParams.set("command", init.command);
  const headers = new Headers();
  if (userId !== undefined) headers.set("authorization", `Bearer ${userId}`);
  if (init.cookie !== undefined) headers.set("cookie", init.cookie);
  // Every client sends its JSON body as JSON, which the oRPC routes read the body by.
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new Request(url, {
    method: init.method ?? "GET",
    headers,
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

/** The started task's id, failing the test where the answer is not a started task. */
function startedId(started: Answer): string {
  return readAnswer(taskAnswerSchema, HOSTED_HTTP_STATUS.CREATED, started).plan.id;
}

/** The task's own conversation, opened and recorded as running in an eve session of its own, as Luke's first turn on it leaves it: the session's id. */
const sessionOn = (owner: string, taskId: string) =>
  Effect.gen(function* () {
    const { conversationId } = Option.getOrThrow(yield* openTaskConversation(owner, taskId));
    const sessionId = `wrun_${randomUUID()}`;
    assert.equal(
      yield* claimRuntimeSession(
        { userId: owner, conversationId },
        sessionId,
        yield* DateTime.nowAsDate,
      ),
      true,
    );
    return sessionId;
  });

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

/** A call about the task, started at the instant given, with the fragments said on it in the order they were written. */
const callAbout = (
  input: { userId: string; taskId: string; startedAt: number; recorded?: Recorded },
  said: readonly Said[],
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [row] = yield* db
      .insert(voiceSessions)
      .values({
        userId: input.userId,
        taskId: input.taskId,
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
      const taskId = startedId(yield* ask(request(TASKS, owner, { method: "POST", body: RELAY })));
      const saved = yield* saveNotes({ userId: owner, taskId: taskId }, [
        added(PLAN_HEADING.CONTEXT, "Only admins can invite."),
        added(PLAN_HEADING.OPEN_QUESTIONS, "- Who can withdraw an invite?"),
      ]);
      assert.equal(saved.status, PLAN_SAVE_STATUS.SAVED);

      const listed = yield* ask(request(TASKS, owner));
      const opened = yield* ask(request(ONE_TASK(taskId), owner));

      assert.deepEqual(
        readAnswer(taskListAnswerSchema, HOSTED_HTTP_STATUS.OK, listed).plans.map((task) => [
          task.id,
          task.name,
        ]),
        [[taskId, RELAY.name]],
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
          ask(request(TASKS, owner, { method: "POST", body }));
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

      const planned = yield* ask(request(TASKS, owner, { method: "POST", body: RELAY }));
      const unplanned = yield* ask(
        request(TASKS, owner, { method: "POST", body: { ...LEDGER, planning: false } }),
      );

      assert.equal(documentOf(planned).body, DEFAULT_PLAN_TEMPLATE);
      assert.deepEqual(documentOf(unplanned), { body: "", assumptions: [] });
    }),
  );

  it.effect(
    "a start keeps its brief, one at its bound with every character escaped among them, and one past its bound is refused",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const briefOf = (answer: Answer) =>
          Effect.map(
            readTask(owner, startedId(answer)),
            (read) => Option.getOrUndefined(read)?.brief,
          );
        // Note that a control character is the widest a character escapes to in JSON, six bytes.
        const widest = "\u0001".repeat(TASK_BOUNDS.MAX_BRIEF_CHARS);

        const briefed = yield* ask(
          request(TASKS, owner, {
            method: "POST",
            body: { ...RELAY, brief: "Let any member invite a teammate." },
          }),
        );
        const atBound = yield* ask(
          request(TASKS, owner, { method: "POST", body: { ...LEDGER, brief: widest } }),
        );
        const overlong = yield* ask(
          request(TASKS, owner, {
            method: "POST",
            body: { ...LEDGER, brief: "x".repeat(TASK_BOUNDS.MAX_BRIEF_CHARS + 1) },
          }),
        );

        assert.equal(yield* briefOf(briefed), "Let any member invite a teammate.");
        assert.equal(yield* briefOf(atBound), widest);
        assert.deepEqual(
          overlong,
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
      }),
  );

  it.effect("a start that names no workspace lands in the account's personal one", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();

      const started = yield* ask(request(TASKS, owner, { method: "POST", body: RELAY }));
      yield* ask(request(TASKS, owner, { method: "POST", body: LEDGER }));

      const personal = yield* personalWorkspaceOf(owner);
      assert.ok(Option.isSome(personal));
      assert.equal(
        readAnswer(taskAnswerSchema, HOSTED_HTTP_STATUS.CREATED, started).plan.workspaceId,
        personal.value,
      );
      const listed = yield* ask(request(TASKS, owner));
      assert.deepEqual(
        readAnswer(taskListAnswerSchema, HOSTED_HTTP_STATUS.OK, listed).plans.map(
          (task) => task.workspaceId,
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
        request(TASKS, owner, { method: "POST", body: { ...RELAY, workspaceId: shared } }),
      );

      assert.equal(
        readAnswer(taskAnswerSchema, HOSTED_HTTP_STATUS.CREATED, started).plan.workspaceId,
        shared,
      );
      const listed = yield* ask(request(TASKS, owner));
      assert.deepEqual(
        readAnswer(taskListAnswerSchema, HOSTED_HTTP_STATUS.OK, listed).plans.map((task) => [
          task.name,
          task.workspaceId,
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
        const taskId = startedId(
          yield* ask(
            request(TASKS, owner, { method: "POST", body: { ...RELAY, workspaceId: shared } }),
          ),
        );
        const db = yield* Database;
        yield* db.update(user).set({ name: "Charles Pan" }).where(eq(user.id, owner));

        const ownersOf = (bearer: string) =>
          Effect.map(ask(request(TASKS, bearer)), (listed) =>
            readAnswer(taskListAnswerSchema, HOSTED_HTTP_STATUS.OK, listed).plans.map((task) => [
              task.ownerId,
              task.createdBy,
            ]),
          );
        const opened = readAnswer(
          taskAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(ONE_TASK(taskId), other)),
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
          request(TASKS, owner, { method: "POST", body: { ...RELAY, workspaceId: theirs } }),
        );
        const unknown = yield* ask(
          request(TASKS, owner, { method: "POST", body: { ...RELAY, workspaceId: "nowhere" } }),
        );

        const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);
        assert.deepEqual(refused, notFound);
        assert.deepEqual(unknown, notFound);
        const listed = yield* ask(request(TASKS, owner));
        assert.deepEqual(readAnswer(taskListAnswerSchema, HOSTED_HTTP_STATUS.OK, listed).plans, []);
      }),
  );

  it.effect("another account's plan answers as none on every route", () =>
    Effect.gen(function* () {
      const { owner, other, ask } = yield* openAccounts();
      const taskId = startedId(yield* ask(request(TASKS, owner, { method: "POST", body: RELAY })));
      const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);

      assert.deepEqual(yield* ask(request(ONE_TASK(taskId), other)), notFound);
      assert.deepEqual(
        yield* ask(request(ONE_TASK(taskId), other, { method: "DELETE" })),
        notFound,
      );
      assert.deepEqual(yield* ask(request(TASKS, other)), {
        status: HOSTED_HTTP_STATUS.OK,
        body: { plans: [], planlessAgents: [] },
      });
      assert.equal((yield* ask(request(ONE_TASK(taskId), owner))).status, HOSTED_HTTP_STATUS.OK);
      for (const path of [MESSAGES, CODE]) {
        assert.deepEqual(yield* ask(request(path, other, { id: taskId })), notFound);
      }
      assert.deepEqual(yield* ask(request(STOP(taskId), other, { method: "POST" })), notFound);
      assert.deepEqual(
        yield* ask(request(SUBAGENT_MESSAGES, other, { id: taskId, query: { call: "call-0-0" } })),
        notFound,
      );
    }),
  );

  it.effect("stopping Luke on a plan he never worked on stops nothing, and only a POST stops", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      const taskId = startedId(yield* ask(request(TASKS, owner, { method: "POST", body: RELAY })));

      assert.deepEqual(yield* ask(request(STOP(taskId), owner, { method: "POST" })), {
        status: HOSTED_HTTP_STATUS.OK,
        body: {},
      });
      assert.deepEqual(
        yield* ask(request(STOP(taskId), owner)),
        refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
      );
    }),
  );

  it.effect(
    "a session cookie's delete is refused as unavailable, stopping and deleting nothing, on a deployment that cannot reach eve as itself, while the bearer's delete goes on with its retires a courtesy",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts(UNREACHED_GITHUB, { reachesEve: false });
        const taskId = startedId(
          yield* ask(request(TASKS, owner, { method: "POST", body: RELAY })),
        );
        yield* sessionOn(owner, taskId);

        assert.deepEqual(
          yield* ask(
            request(ONE_TASK(taskId), undefined, {
              method: "DELETE",
              cookie: sessionCookieOf(owner),
            }),
          ),
          refusal(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE),
        );
        assert.equal(
          (yield* ask(request(ONE_TASK(taskId), owner))).status,
          HOSTED_HTTP_STATUS.OK,
          "the task stands",
        );
        assert.deepEqual(yield* ask(request(ONE_TASK(taskId), owner, { method: "DELETE" })), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { deleted: true },
        });
      }),
  );

  it.effect(
    "a session cookie starts, reads, and deletes its account's task however the delete lands, retiring the task's session as the deployment acting for the cookie's account, while another account's cookie deletes and retires nothing",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask, retired } = yield* openAccounts();
        const cookie = sessionCookieOf(owner);
        const started = (body: typeof RELAY | typeof LEDGER) =>
          Effect.map(ask(request(TASKS, undefined, { method: "POST", body, cookie })), startedId);
        const relay = yield* started(RELAY);
        const ledger = yield* started(LEDGER);
        const relaySession = yield* sessionOn(owner, relay);
        const ledgerSession = yield* sessionOn(owner, ledger);
        const deletedBy = (taskId: string, by: string) =>
          ask(request(ONE_TASK(taskId), undefined, { method: "DELETE", cookie: by }));
        const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);
        const deleted = { status: HOSTED_HTTP_STATUS.OK, body: { deleted: true } };

        assert.equal(
          (yield* ask(request(ONE_TASK(relay), undefined, { cookie }))).status,
          HOSTED_HTTP_STATUS.OK,
          "the cookie names the account on a read",
        );
        assert.deepEqual(yield* deletedBy(relay, sessionCookieOf(other)), notFound);
        assert.deepEqual(yield* deletedBy(ledger, sessionCookieOf(other)), notFound);
        assert.deepEqual(retired, [], "another account's cookie retires nothing");

        assert.deepEqual(yield* deletedBy(relay, cookie), deleted);
        assert.deepEqual(yield* deletedBy(ledger, cookie), deleted);
        assert.deepEqual(retired, [
          [deploymentFor(owner), relaySession],
          [deploymentFor(owner), ledgerSession],
        ]);
        assert.deepEqual(
          readAnswer(taskListAnswerSchema, HOSTED_HTTP_STATUS.OK, yield* ask(request(TASKS, owner)))
            .plans,
          [],
        );
      }),
  );

  it.effect(
    "a plan never planned on reads as an empty conversation on the agent tab's wire, and as no code shown",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const taskId = startedId(
          yield* ask(request(TASKS, owner, { method: "POST", body: RELAY })),
        );

        const read = yield* ask(request(MESSAGES, owner, { id: taskId }));
        const page = readAnswer(codingAgentMessagesAnswerSchema, HOSTED_HTTP_STATUS.OK, read);
        assert.deepEqual(
          [page.messages, page.status, page.earlier],
          [[], CODING_AGENT_STATUS.COMPLETED, undefined],
        );
        assert.deepEqual(yield* ask(request(CODE, owner, { id: taskId })), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { code: [] },
        });
        assert.equal(
          (yield* ask(
            request(MESSAGES, owner, { id: taskId, query: { after: "0:0", before: taskId } }),
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
        const taskId = startedId(
          yield* ask(request(TASKS, owner, { method: "POST", body: RELAY })),
        );
        const body = {
          document: { base: DEFAULT_PLAN_TEMPLATE, value: `${DEFAULT_PLAN_TEMPLATE}Mine now.\n` },
        };

        assert.deepEqual(
          yield* ask(request(EDIT(taskId), other, { method: "POST", body })),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(
            request(EDIT(taskId), owner, {
              method: "POST",
              body: { field: PLAN_FIELD.OPEN_QUESTIONS, base: [], value: "Not a list." },
            }),
          ),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.deepEqual(
          yield* ask(request(EDIT(taskId), owner, { method: "GET" })),
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
          request(TASKS, owner, { method: "POST", body: { ...RELAY, linearIssueId: "issue-1" } }),
        );

        assert.deepEqual(
          refused,
          refusal(HOSTED_HTTP_STATUS.CONFLICT, HOSTED_API_ERROR.LINEAR_UNAVAILABLE),
        );
        assert.deepEqual(yield* ask(request(TASKS, owner)), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { plans: [], planlessAgents: [] },
        });
      }),
  );

  it.effect(
    "a start from an issue of the workspace names it, and one from an issue of a workspace the account is not in, or of another workspace of its own, is refused and starts no plan",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const workspaceId = yield* openWorkspace(owner);
        const elsewhere = yield* openWorkspace(owner);
        const theirs = yield* openWorkspace(other);
        const filed = (userId: string, organizationId: string) =>
          Effect.map(createIssue(userId, { organizationId, title: "Invites expire" }), (made) =>
            Option.getOrElse(made, () => assert.fail("the issue was not filed")),
          );
        const mine = yield* filed(owner, workspaceId);
        const another = yield* filed(owner, elsewhere);
        const outside = yield* filed(other, theirs);
        const start = (issueId: string) =>
          ask(request(TASKS, owner, { method: "POST", body: { ...RELAY, workspaceId, issueId } }));
        const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);

        assert.deepEqual(yield* start(outside.id), notFound);
        assert.deepEqual(yield* start(another.id), notFound);
        assert.deepEqual(yield* ask(request(TASKS, owner)), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { plans: [], planlessAgents: [] },
        });
        const started = readAnswer(
          taskAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* start(mine.id),
        );
        assert.equal(started.plan.issueId, mine.id);
      }),
  );

  it.effect(
    "a start that names an account, or a repository in no shape GitHub spells, is refused",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
        const start = (body: WireBoundaryInput) =>
          ask(request(TASKS, owner, { method: "POST", body }));

        const naming = yield* start({ ...RELAY, userId: other });
        const shaped = yield* start({
          name: RELAY.name,
          repository: { owner: "acme", name: "relay" },
        });
        const pathed = yield* start({ name: RELAY.name, repository: "acme/../relay" });
        const bare = yield* start({ name: RELAY.name, repository: "relay" });

        assert.deepEqual([naming, shaped, pathed, bare], [invalid, invalid, invalid, invalid]);
        assert.deepEqual(yield* ask(request(TASKS, owner)), {
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
        const taskId = startedId(
          yield* ask(request(TASKS, owner, { method: "POST", body: RELAY })),
        );
        const unchosen = yield* ask(
          request(TASKS, owner, { method: "POST", body: { ...RELAY, repository: "acme/ledger" } }),
        );
        const elsewhere = yield* ask(
          request(ONE_TASK(taskId), owner, {
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
          yield* ask(request(ONE_TASK(taskId), owner)),
        );
        assert.deepEqual([opened.plan.name, opened.plan.repository], [RELAY.name, null]);
        assert.equal(
          readAnswer(taskListAnswerSchema, HOSTED_HTTP_STATUS.OK, yield* ask(request(TASKS, owner)))
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
        const taskId = startedId(
          yield* ask(request(TASKS, owner, { method: "POST", body: RELAY })),
        );
        const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
        const save = (userId: string, body: WireBoundaryInput) =>
          ask(request(BOARD(taskId), userId, { method: "PUT", body }));

        assert.deepEqual(yield* ask(request(BOARD(taskId), other)), notFound);
        assert.deepEqual(yield* save(other, { elements: [NOTE], appliedDrawing: 0 }), notFound);
        assert.equal(
          (yield* runDrawOnBoard({ userId: other, taskId: taskId }, unparsedWire(DRAW_API))).status,
          DRAW_ON_BOARD_STATUS.NOT_DRAWN,
        );
        assert.deepEqual(
          yield* save(owner, { elements: [{ ...NOTE, type: "image" }], appliedDrawing: 0 }),
          invalid,
        );
        assert.deepEqual(
          yield* save(owner, { elements: [NOTE], appliedDrawing: 0, taskId }),
          invalid,
        );
        assert.deepEqual(yield* ask(request(BOARD(taskId), owner)), {
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
        const taskId = startedId(
          yield* ask(request(TASKS, owner, { method: "POST", body: RELAY })),
        );
        const read = () =>
          Effect.map(
            ask(request(TRANSCRIPT(taskId), owner)),
            (answered) =>
              readAnswer(taskTranscriptAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).transcript,
          );
        const { USER, ASSISTANT } = VOICE_SEGMENT_ROLE;

        assert.deepEqual(yield* read(), { calls: [], earlierOmitted: false });
        // Made newest first, so the order read back is the calls' starts and not the rows'.
        const second = yield* callAbout({ userId: owner, taskId, startedAt: 2_000_000 }, [
          [USER, "Seven days.", 0],
        ]);
        // Luke's acknowledgment lands inside the developer's sentence, which a
        // fragment written after it still finishes, as the captions draw it.
        const first = yield* callAbout({ userId: owner, taskId, startedAt: 1_000_000 }, [
          [USER, "Invites ", 0],
          [ASSISTANT, "Mm.", 600],
          [USER, "should expire.", 700],
          [ASSISTANT, "After how many days?", 9_000],
        ]);
        yield* callAbout({ userId: owner, taskId, startedAt: 3_000_000 }, []);
        const otherTask = startedId(
          yield* ask(request(TASKS, owner, { method: "POST", body: RELAY })),
        );
        yield* callAbout({ userId: owner, taskId: otherTask, startedAt: 3_000_000 }, [
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
          yield* ask(request(TRANSCRIPT(taskId), other)),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(request(TRANSCRIPT(taskId), owner, { method: "PUT" })),
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
          yield* ask(request(TASKS, owner, { method: "POST", body: RELAY })),
        ).plan;
        yield* joinWorkspace(started.workspaceId, other);
        const read = (userId: string) =>
          Effect.map(
            ask(request(TRANSCRIPT(started.id), userId)),
            (answered) =>
              readAnswer(taskTranscriptAnswerSchema, HOSTED_HTTP_STATUS.OK, answered).transcript,
          );
        const { USER } = VOICE_SEGMENT_ROLE;

        const ownersCall = yield* callAbout(
          { userId: owner, taskId: started.id, startedAt: 1_000_000 },
          [[USER, "Invites should expire.", 0]],
        );
        const teammatesCall = yield* callAbout(
          {
            userId: other,
            taskId: started.id,
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
        yield* ask(request(TASKS, owner, { method: "POST", body: RELAY })),
      ).plan;
      yield* joinWorkspace(started.workspaceId, other);

      const saved = yield* ask(
        request(BOARD(started.id), other, {
          method: "PUT",

          body: { elements: [NOTE], appliedDrawing: 0 },
        }),
      );

      assert.equal(saved.status, HOSTED_HTTP_STATUS.OK);
      assert.deepEqual(
        readAnswer(
          boardAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(BOARD(started.id), owner)),
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
        const taskId = startedId(
          yield* ask(request(TASKS, owner, { method: "POST", body: RELAY })),
        );

        assert.deepEqual(
          readAnswer(
            taskWorkAnswerSchema,
            HOSTED_HTTP_STATUS.OK,
            yield* ask(request(WORK(taskId), owner)),
          ),
          { turns: [], code: [] },
        );
        const older = new URL(WORK(taskId), ORIGIN);
        older.searchParams.set("before", "turn-1");
        assert.deepEqual(
          yield* ask(new Request(older, { headers: { authorization: `Bearer ${owner}` } })),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.deepEqual(
          yield* ask(request(WORK(taskId), other)),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(request(WORK(taskId), owner, { method: "PUT" })),
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
        const taskId = startedId(
          yield* ask(
            request(TASKS, owner, {
              method: "POST",
              body: { ...RELAY, workspaceId, repository: "acme/relay" },
            }),
          ),
        );
        const window = (userId: string, path: string, first: string, last: string) =>
          ask(request(FILE, userId, { id: taskId, query: { path, first, last } }));

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
        const taskId = startedId(
          yield* ask(
            request(TASKS, owner, {
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
              id: taskId,
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
        const taskId = startedId(
          yield* ask(
            request(TASKS, owner, {
              method: "POST",
              body: { ...RELAY, workspaceId, repository: "acme/relay" },
            }),
          ),
        );
        const refusalOf = (path: string) =>
          Effect.map(
            ask(request(FILE, owner, { id: taskId, query: { path, first: "1", last: "10" } })),
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
        const taskId = startedId(
          yield* ask(
            request(TASKS, owner, {
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
              id: taskId,
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

  it.effect(
    "a change whose body passes the change's bound is refused as too large, its plan unchanged, though the change it carries reads",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const taskId = startedId(
          yield* ask(request(TASKS, owner, { method: "POST", body: RELAY })),
        );
        // A rename the bound would admit, padded with the whitespace JSON reads past to a body larger than any change.
        const body = `${JSON.stringify({ name: "Invitation expiry" })}${" ".repeat(16_384)}`;
        const padded = new Request(new URL(ONE_TASK(taskId), ORIGIN), {
          method: "PATCH",
          headers: {
            authorization: `Bearer ${owner}`,
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(body)),
          },
          body,
        });

        assert.deepEqual(
          yield* ask(padded),
          refusal(HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE, HOSTED_API_ERROR.REQUEST_TOO_LARGE),
        );
        assert.equal(
          readAnswer(
            taskAnswerSchema,
            HOSTED_HTTP_STATUS.OK,
            yield* ask(request(ONE_TASK(taskId), owner)),
          ).plan.name,
          RELAY.name,
        );
      }),
  );

  it.effect("no bearer, a wrong method, and an id that is no UUID are refused", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();

      assert.deepEqual(
        yield* ask(request(TASKS, undefined)),
        refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
      );
      assert.deepEqual(
        yield* ask(request(TASKS, owner, { method: "DELETE" })),
        refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
      );
      assert.deepEqual(
        yield* ask(request(ONE_TASK("not-a-plan"), owner)),
        refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
      );
    }),
  );
  /**
   * The owner's plan written twice, far enough apart to be two revisions:
   * the context first, then the goal.
   */
  const twoRevisions = (userId: string, taskId: string) =>
    Effect.gen(function* () {
      yield* saveNotes({ userId, taskId: taskId }, [
        added(PLAN_HEADING.CONTEXT, "Only admins can invite."),
      ]);
      yield* TestClock.adjust(Duration.millis(PLAN_REVISION.JOIN_WITHIN_MS + 1));
      yield* saveNotes({ userId, taskId: taskId }, [
        added(PLAN_HEADING.GOAL, "Members invite by email."),
      ]);
    });

  it.effect(
    "another account reads no history of the plan, no revision of it, and restores none",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const taskId = startedId(
          yield* ask(request(TASKS, owner, { method: "POST", body: RELAY })),
        );
        yield* twoRevisions(owner, taskId);
        const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);

        assert.deepEqual(yield* ask(request(REVISIONS(taskId), other)), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { revisions: [] },
        });
        assert.deepEqual(yield* ask(request(REVISION(taskId, 1), other)), notFound);
        assert.deepEqual(
          yield* ask(request(RESTORE(taskId, 1), other, { method: "POST" })),
          notFound,
        );
        const page = readAnswer(
          planRevisionsAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(REVISIONS(taskId), owner)),
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
        const taskId = startedId(
          yield* ask(request(TASKS, owner, { method: "POST", body: RELAY })),
        );
        const page = Option.getOrThrow(
          yield* writePage(
            owner,
            taskId,
            { title: "Invite funnel", html: "<p>v1</p>" },
            { kind: PAGE_SHOWER.LUKE },
          ),
        );
        const version = (asker: string, pageId: string, number: string, method?: string) =>
          ask(
            request(PAGE, asker, {
              id: taskId,
              query: { page: pageId, version: number },
              ...(method === undefined ? undefined : { method }),
            }),
          );
        const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);

        assert.deepEqual(yield* ask(request(`/api/plans/${taskId}/pages`, other), "plans/pages"), {
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
        const taskId = startedId(
          yield* ask(request(TASKS, owner, { method: "POST", body: RELAY })),
        );
        yield* makeSavedDocumentTask(taskId, INVITATIONS_TEXT);
        const value = INVITATIONS_TEXT.replace("Only an admin", "Only an owner");

        const answered = readAnswer(
          planEditAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(
            request(EDIT(taskId), owner, {
              method: "POST",
              body: { document: { base: INVITATIONS_TEXT, value } },
            }),
          ),
        );
        const page = readAnswer(
          planRevisionsAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(REVISIONS(taskId), owner)),
        );
        const { revision } = readAnswer(
          planRevisionAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(REVISION(taskId, 2), owner)),
        );

        assert.ok("plan" in answered);
        const { plan: task } = answered;
        const at = task.lastEdit?.at ?? assert.fail("the edit names no last edit");
        assert.deepEqual(task.document, { body: value, assumptions: [] });
        assert.equal(task.lastEdit?.actor, PLAN_ACTOR.DEVELOPER);
        const by = task.lastEdit?.by ?? assert.fail("the edit names no member");
        assert.equal(by.userId, owner);
        assert.deepEqual(task.sectionEdits, [
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
        const taskId = startedId(
          yield* ask(request(TASKS, owner, { method: "POST", body: RELAY })),
        );
        const lukes = `${INVITATIONS_TEXT}- An accepted invite is never reused.\n`;
        yield* makeDocumentTask(taskId, lukes);
        const edit = (id: string, value: string) =>
          ask(
            request(EDIT(id), owner, {
              method: "POST",
              body: { document: { base: INVITATIONS_TEXT, value } },
            }),
          );

        // At the bound alone, but past it once laid over the line Luke added.
        const padding = "x".repeat(TASK_BOUNDS.MAX_BODY_CHARS - INVITATIONS_TEXT.length);
        const oversized = yield* edit(
          taskId,
          INVITATIONS_TEXT.replace("Only an admin", `Only an admin${padding}`),
        );
        const merged = readAnswer(
          planEditAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* edit(taskId, INVITATIONS_TEXT.replace("Only an admin", "Only an owner")),
        );
        const conflicted = yield* edit(
          taskId,
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
          ask(request(TASKS, owner, { method: "POST", body }));
        const change = (taskId: string, repository: string) =>
          ask(request(ONE_TASK(taskId), owner, { method: "PATCH", body: { repository } }));
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
          yield* ask(request(ONE_TASK(personal), owner)),
        );
        assert.equal(opened.plan.repository, null);
        const listed = readAnswer(
          taskListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(TASKS, owner)),
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
        const task = yield* createTask(owner, {
          organizationId: bare,
          name: RELAY.name,
          repository: "acme/relay",
        });
        const move = (bearer: string, workspaceId: string) =>
          ask(request(ONE_TASK(task.id), bearer, { method: "PATCH", body: { workspaceId } }));

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
        // The teammate was in the workspace the task left, not the one it moved to.
        assert.deepEqual(
          yield* ask(request(ONE_TASK(task.id), other)),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
      }),
  );
});
