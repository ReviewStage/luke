import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { writePage } from "@luke/database/models/plan-pages";
import { PLAN_REVISION } from "@luke/database/models/plan-revisions";
import { createTask, readTask } from "@luke/database/models/task-store";
import { personalWorkspaceOf } from "@luke/database/models/workspace-store";
import { user } from "@luke/database/schemas/auth";
import { planRevision } from "@luke/database/schemas/plan-revision";
import {
  fakeWorkspaceSeams,
  getTestDB,
  joinWorkspace,
  openWorkspace,
} from "@luke/database/testing";
import { PAGE_SHOWER, taskPageOwner } from "@luke/features/page-wire";
import { PLAN_EDIT_REFUSAL, planEditAnswerSchema } from "@luke/features/plan-edit";
import {
  REPOSITORY_UNREACHED,
  type RepositoryUnreached,
} from "@luke/features/repository-reach-wire";
import {
  PLAN_ACTOR,
  planRevisionAnswerSchema,
  planRevisionsAnswerSchema,
  TASK_BOUNDS,
  TASK_FILE_REFUSAL,
  TASK_PRIORITY,
  TASK_STATUS,
  taskAnswerSchema,
  taskDeleteAnswerSchema,
  taskFileAnswerSchema,
  taskListAnswerSchema,
  UNTITLED_TASK_NAME,
} from "@luke/features/task-wire";
import {
  type AgentSessions,
  EVE_RESET_OUTCOME,
} from "@luke/service/agents/brain-host/eve-sessions";
import { messagesProcedures } from "@luke/service/agents/messages-procedures";
import { sessionSandboxesLayer } from "@luke/service/agents/session-sandboxes";
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
import { PLAN_SAVE_STATUS, saveNotes } from "@luke/service/tasks/plan-notes";
import { taskFilesProcedures } from "@luke/service/tasks/task-files-procedures";
import { tasksApp } from "@luke/service/tasks/tasks-app";
import { tasksProcedures } from "@luke/service/tasks/tasks-procedures";
import {
  connectWorkspaceGitHub,
  type FakeGitHub,
  fakeGitHub,
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
import { keepAwakeDetached } from "@luke/service/testing/session-sandboxes-fake";
import { added } from "@luke/service/testing/task-contents";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { eq, sql } from "drizzle-orm";
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
import { DISPATCH_QUERY, ORPC_ROUTE_KEY } from "../server/function-dispatch.js";
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
const FILE = (taskId: string) => `${ONE_TASK(taskId)}/file`;
const SKILLS = (taskId: string) => `${ONE_TASK(taskId)}/skills`;
const TREE = (taskId: string) => `${ONE_TASK(taskId)}/tree`;
/** A window of a file the File tab asks for. */
const README_WINDOW = { path: "README.md", first: "1", last: "10" } as const;
const PAGES = (taskId: string) => `${ONE_TASK(taskId)}/pages`;
const REVISIONS = (taskId: string) => `${ONE_TASK(taskId)}/revisions`;
const REVISION = (taskId: string, seq: number) => `${REVISIONS(taskId)}/${seq}`;
const RESTORE = (taskId: string, seq: number) => `${REVISION(taskId, seq)}/restore`;
const EDIT = (taskId: string) => `${ONE_TASK(taskId)}/edit`;
const PAGE = (taskId: string, pageId: string, version: string) =>
  `${PAGES(taskId)}/${pageId}/versions/${version}`;

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

/** The Linear connector the deployment names, the accounts' own. */
const LINEAR_CONNECTORS = { LINEAR_CONNECTOR_UID: "oauth/linear" } as const;

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
  const asked = (caller: string): AgentSessions => ({
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

/**
 * The routes over the test's own database and the GitHub given, answering
 * one request: a plan's own routes as a client sends them, landed by the
 * platform through the committed rewrites and the grouped function's
 * dispatcher on the hosted oRPC router; or, where a route key is named,
 * landed on a function holding the old group under that key.
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
      integrationConnectOver(LINEAR_CONNECTORS),
    );
    const seams = {
      // The account read as `resolveHostedUserId` reads it: the bearer where one is carried, else the session cookie.
      resolveUserId: (incoming: Request) =>
        requestUserId(incoming, userInfoOf(signedIn.bearers), sessionOf(signedIn.sessions)),
      workspaces: yield* fakeWorkspaceSeams,
      eveOrigin: () => ORIGIN,
      sessionSandboxes: sessionSandboxesLayer,
      keepAwake: keepAwakeDetached,
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
    const routed = hostedFetch({
      messages: messagesProcedures(seams),
      plans: tasksProcedures(seams),
      taskFiles: taskFilesProcedures(seams),
    });
    const tasksRoute = { fetch: (each: Request) => routed(each, webServices) };
    const response = yield* Effect.promise(() => {
      if (landedAs !== undefined) {
        return dispatched(request, new Map([[landedAs, { fetch: (each) => handler(each) }]]));
      }
      return dispatched(request, new Map([[ORPC_ROUTE_KEY, tasksRoute]]));
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

it.layer(getTestDB())("the plan routes", (it) => {
  it.effect("a started plan lists, and opens with what its notes saved", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts();
      const taskId = startedId(yield* ask(request(TASKS, owner, { method: "POST", body: RELAY })));
      const saved = yield* saveNotes({ userId: owner, taskId: taskId }, [
        added("Context", "Only admins can invite."),
        added("Open questions", "- Who can withdraw an invite?"),
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

  it.effect(
    "a plan starts to do and unweighed unless its start says otherwise, a PATCH sets where it stands and how much it matters, and is refused as none to another account, and an archive from an older build settles it with no archive stamped",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const started = yield* ask(request(TASKS, owner, { method: "POST", body: RELAY }));
        const plain = readAnswer(taskAnswerSchema, HOSTED_HTTP_STATUS.CREATED, started).plan;
        assert.deepEqual([plain.status, plain.priority], [TASK_STATUS.TODO, TASK_PRIORITY.NONE]);
        const filed = readAnswer(
          taskAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(
            request(TASKS, owner, {
              method: "POST",
              body: { ...RELAY, status: TASK_STATUS.BACKLOG, priority: TASK_PRIORITY.LOW },
            }),
          ),
        ).plan;
        assert.deepEqual([filed.status, filed.priority], [TASK_STATUS.BACKLOG, TASK_PRIORITY.LOW]);
        assert.equal(filed.number, (plain.number ?? 0) + 1);

        const patch = (userId: string, body: WireBoundaryInput) =>
          ask(request(ONE_TASK(plain.id), userId, { method: "PATCH", body }));
        const changed = readAnswer(
          taskAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* patch(owner, { status: TASK_STATUS.DONE, priority: TASK_PRIORITY.URGENT }),
        ).plan;
        assert.deepEqual(
          [changed.status, changed.priority, changed.number],
          [TASK_STATUS.DONE, TASK_PRIORITY.URGENT, plain.number],
        );
        assert.deepEqual(
          yield* patch(owner, { status: "started" }),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.deepEqual(
          yield* patch(other, { status: TASK_STATUS.CANCELED }),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        // A plan is archived no longer: an older build's archive keeps a settled status, answers no archive, and the plan still takes a change after it.
        const settled = readAnswer(
          taskAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* patch(owner, { archived: true }),
        ).plan;
        assert.equal(settled.status, TASK_STATUS.DONE);
        assert.equal("archivedAt" in settled, false, "no archive is answered");
        assert.equal(
          readAnswer(
            taskAnswerSchema,
            HOSTED_HTTP_STATUS.OK,
            yield* patch(owner, { priority: TASK_PRIORITY.LOW }),
          ).plan.priority,
          TASK_PRIORITY.LOW,
        );
      }),
  );

  it.effect(
    "a plan starts assigned to the member its start names, a PATCH assigns it to another member or to no one, and an assignee who is no member is refused as an invalid request",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const shared = yield* openWorkspace(owner);
        yield* joinWorkspace(shared, other);
        const stranger = `user-${randomUUID()}`;
        const db = yield* Database;
        yield* db
          .insert(user)
          .values({ id: stranger, name: "Stranger", email: `${stranger}@luke.test` });
        const start = (body: WireBoundaryInput) =>
          ask(request(TASKS, owner, { method: "POST", body }));

        const assigned = readAnswer(
          taskAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* start({ ...RELAY, workspaceId: shared, assigneeId: other }),
        ).plan;
        assert.deepEqual(assigned.assignee, { userId: other, name: "Test User" });
        assert.deepEqual(
          yield* start({ ...RELAY, workspaceId: shared, assigneeId: stranger }),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );

        const patch = (body: WireBoundaryInput) =>
          ask(request(ONE_TASK(assigned.id), other, { method: "PATCH", body }));
        const reassigned = readAnswer(
          taskAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* patch({ assigneeId: owner }),
        ).plan;
        assert.equal(reassigned.assignee?.userId, owner);
        assert.deepEqual(
          yield* patch({ assigneeId: stranger }),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        const unassigned = readAnswer(
          taskAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* patch({ assigneeId: null }),
        ).plan;
        assert.equal(unassigned.assignee, undefined);
        const listed = readAnswer(
          taskListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(request(TASKS, owner)),
        ).plans;
        assert.deepEqual(
          listed.map((task) => task.assignee),
          [undefined],
          "nothing was started for the stranger",
        );
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
      // The reads that need only where the plan stands, not its document, refuse it as the open does, and a plan that is none alike.
      for (const id of [taskId, randomUUID()]) {
        const bearer = id === taskId ? other : owner;
        for (const read of [
          request(FILE(id), bearer, { query: README_WINDOW }),
          request(TREE(id), bearer),
          request(SKILLS(id), bearer),
        ]) {
          assert.deepEqual(yield* ask(read), notFound, read.url);
        }
      }
    }),
  );

  it.effect(
    "a plan's reads that need only where it stands answer while its history holds a revision this build cannot read, which the open, reading who wrote each section, cannot",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const taskId = startedId(
          yield* ask(request(TASKS, owner, { method: "POST", body: RELAY })),
        );
        const now = yield* DateTime.nowAsDate;
        // A revision a later build wrote, by a kind of writer this build has no name for.
        yield* Database.use((db) =>
          db.insert(planRevision).values({
            taskId,
            seq: 1_000,
            actor: sql`'a-later-writer'`,
            document: "## Goal\n\nInvite a teammate.\n",
            changes: 1,
            startedAt: now,
            at: now,
          }),
        );

        assert.deepEqual(
          yield* ask(request(ONE_TASK(taskId), owner)),
          refusal(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE),
        );
        for (const read of [
          request(FILE(taskId), owner, { query: README_WINDOW }),
          request(TREE(taskId), owner),
          request(SKILLS(taskId), owner),
        ]) {
          const answered = yield* ask(read);
          assert.equal(
            answered.status,
            HOSTED_HTTP_STATUS.OK,
            `${read.url} ${JSON.stringify(answered.body)}`,
          );
        }
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
        assert.equal(
          readAnswer(
            taskDeleteAnswerSchema,
            HOSTED_HTTP_STATUS.OK,
            yield* ask(request(ONE_TASK(taskId), owner, { method: "DELETE" })),
          ).deleted,
          true,
        );
      }),
  );

  it.effect(
    "a session cookie starts, reads, and deletes its account's task however the delete lands, while another account's cookie deletes and retires nothing",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask, retired } = yield* openAccounts();
        const cookie = sessionCookieOf(owner);
        const started = (body: typeof RELAY | typeof LEDGER) =>
          Effect.map(ask(request(TASKS, undefined, { method: "POST", body, cookie })), startedId);
        const relay = yield* started(RELAY);
        const ledger = yield* started(LEDGER);
        const deletedBy = (taskId: string, by: string) =>
          ask(request(ONE_TASK(taskId), undefined, { method: "DELETE", cookie: by }));
        const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);
        // A delete is answered with the transaction it committed in, whichever that is.
        const deletedAs = (taskId: string, by: string) =>
          Effect.map(
            deletedBy(taskId, by),
            (answer) => readAnswer(taskDeleteAnswerSchema, HOSTED_HTTP_STATUS.OK, answer).deleted,
          );

        assert.equal(
          (yield* ask(request(ONE_TASK(relay), undefined, { cookie }))).status,
          HOSTED_HTTP_STATUS.OK,
          "the cookie names the account on a read",
        );
        assert.deepEqual(yield* deletedBy(relay, sessionCookieOf(other)), notFound);
        assert.deepEqual(yield* deletedBy(ledger, sessionCookieOf(other)), notFound);
        assert.deepEqual(retired, [], "another account's cookie retires nothing");

        assert.equal(yield* deletedAs(relay, cookie), true);
        assert.equal(yield* deletedAs(ledger, cookie), true);
        assert.deepEqual(
          readAnswer(taskListAnswerSchema, HOSTED_HTTP_STATUS.OK, yield* ask(request(TASKS, owner)))
            .plans,
          [],
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
          document: { base: "", value: "Mine now.\n" },
        };

        assert.deepEqual(
          yield* ask(request(EDIT(taskId), other, { method: "POST", body })),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(
            request(EDIT(taskId), owner, {
              method: "POST",
              body: { field: "openQuestions", base: [], value: "Not a list." },
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
    "a start from a released desktop that still names a Linear issue or the issues to link starts its plan, and reads no issue from Linear or GitHub",
    () =>
      Effect.gen(function* () {
        const network = fakeGitHub(() => Response.json({ message: "Not Found" }, { status: 404 }));
        const { owner, ask } = yield* openAccounts(network);
        const start = (body: WireBoundaryInput) =>
          ask(request(TASKS, owner, { method: "POST", body }));

        // Note that the keys are spelled as v0.22.0 sends them, because nothing on this side declares them now.
        const fromLinear = yield* start({ ...RELAY, linearIssueId: "issue-1" });
        const linking = yield* start({
          ...LEDGER,
          issues: [
            { provider: "linear", id: "issue-1", relation: "closes" },
            { provider: "github", repository: "acme/relay", number: 7 },
          ],
        });

        assert.equal(
          readAnswer(taskAnswerSchema, HOSTED_HTTP_STATUS.CREATED, fromLinear).plan.name,
          RELAY.name,
        );
        assert.equal(
          readAnswer(taskAnswerSchema, HOSTED_HTTP_STATUS.CREATED, linking).plan.name,
          LEDGER.name,
        );
        assert.deepEqual(network.sent, []);
      }),
  );

  it.effect(
    "a start that names an account, a workspace issue Luke no longer keeps, or a repository in no shape GitHub spells, is refused",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts();
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
        const start = (body: WireBoundaryInput) =>
          ask(request(TASKS, owner, { method: "POST", body }));

        const naming = yield* start({ ...RELAY, userId: other });
        const issued = yield* start({ ...RELAY, issueId: "3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f60" });
        const shaped = yield* start({
          name: RELAY.name,
          repository: { owner: "acme", name: "relay" },
        });
        const pathed = yield* start({ name: RELAY.name, repository: "acme/../relay" });
        const bare = yield* start({ name: RELAY.name, repository: "relay" });

        assert.deepEqual(
          [naming, issued, shaped, pathed, bare],
          [invalid, invalid, invalid, invalid, invalid],
        );
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
          ask(request(FILE(taskId), userId, { query: { path, first, last } }));

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
            request(FILE(taskId), owner, {
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
            ask(request(FILE(taskId), owner, { query: { path, first: "1", last: "10" } })),
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
            request(FILE(taskId), other, {
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

  /**
   * The owner's plan written twice, far enough apart to be two revisions:
   * the context first, then the goal.
   */
  const twoRevisions = (userId: string, taskId: string) =>
    Effect.gen(function* () {
      yield* saveNotes({ userId, taskId: taskId }, [added("Context", "Only admins can invite.")]);
      yield* TestClock.adjust(Duration.millis(PLAN_REVISION.JOIN_WITHIN_MS + 1));
      yield* saveNotes({ userId, taskId: taskId }, [added("Goal", "Members invite by email.")]);
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
            taskPageOwner(taskId),
            { title: "Invite funnel", html: "<p>v1</p>" },
            { kind: PAGE_SHOWER.LUKE },
          ),
        );
        const version = (asker: string, pageId: string, number: string, method?: string) =>
          ask(request(PAGE(taskId, pageId, number), asker, method === undefined ? {} : { method }));
        const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);

        assert.deepEqual(yield* ask(request(PAGES(taskId), other)), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { pages: [] },
        });
        assert.deepEqual(yield* ask(request(PAGE(taskId, page.id, "1"), owner)), {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            page: {
              id: page.id,
              title: "Invite funnel",
              version: 1,
              at: page.at,
              shownBy: { kind: PAGE_SHOWER.LUKE },
              html: "<p>v1</p>",
            },
          },
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
    "a plan's files are refused as the old group refused them: the caller read before the query, an unreadable query, an id that is no UUID, and a wrong method",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const taskId = startedId(
          yield* ask(request(TASKS, owner, { method: "POST", body: RELAY })),
        );
        const unreadable = { query: { path: "src/invite.ts", first: "1", last: "2", raw: "2" } };

        assert.deepEqual(
          yield* ask(request(FILE(taskId), undefined, unreadable)),
          refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
          "the caller is read before the query",
        );
        assert.deepEqual(
          yield* ask(request(FILE(taskId), owner, unreadable)),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.deepEqual(
          yield* ask(request(TREE("not-a-plan"), owner)),
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          yield* ask(request(SKILLS(taskId), owner, { method: "POST" })),
          refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
        );
      }),
  );

  it.effect(
    "a route-path a client names on a plan's pages cannot steer the read to another procedure: it answers as the pages, and a delete there deletes nothing",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts();
        const taskId = startedId(
          yield* ask(request(TASKS, owner, { method: "POST", body: RELAY })),
        );
        const steered = (method?: string) =>
          ask(
            request(PAGES(taskId), owner, {
              query: { [DISPATCH_QUERY.PATH]: "plans/plan" },
              ...(method === undefined ? undefined : { method }),
            }),
          );

        assert.deepEqual(yield* steered(), { status: HOSTED_HTTP_STATUS.OK, body: { pages: [] } });
        assert.deepEqual(
          yield* steered("DELETE"),
          refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
        );
        assert.equal(
          (yield* ask(request(ONE_TASK(taskId), owner))).status,
          HOSTED_HTTP_STATUS.OK,
          "the plan stands",
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
          body: { conflict: { current: mergedText, by: merged.plan.lastEdit } },
        });
        assert.deepEqual(oversized, {
          status: HOSTED_HTTP_STATUS.OK,
          body: { refused: PLAN_EDIT_REFUSAL.TOO_LONG },
        });
      }),
  );

  it.effect(
    "a document edit that conflicts with a teammate's names the teammate as who wrote the text it met, though another section was saved since",
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
        yield* makeSavedDocumentTask(taskId, INVITATIONS_TEXT);
        const db = yield* Database;
        yield* db.update(user).set({ name: "Charles Pan" }).where(eq(user.id, other));
        const edit = (as: string, base: string, value: string) =>
          Effect.map(
            ask(request(EDIT(taskId), as, { method: "POST", body: { document: { base, value } } })),
            (answered) => readAnswer(planEditAnswerSchema, HOSTED_HTTP_STATUS.OK, answered),
          );

        const theirs = INVITATIONS_TEXT.replace("Only an admin", "Only an owner");
        yield* edit(other, INVITATIONS_TEXT, theirs);
        // The owner's own later save of another section is the plan's newest revision.
        const goal = theirs.replace("invite a teammate", "invite a teammate or a guest");
        yield* edit(owner, theirs, goal);
        const conflicted = yield* edit(
          owner,
          INVITATIONS_TEXT,
          INVITATIONS_TEXT.replace("Only an admin", "Only a workspace admin"),
        );

        assert.ok("conflict" in conflicted);
        assert.equal(conflicted.conflict.current, goal);
        assert.equal(conflicted.conflict.by?.actor, PLAN_ACTOR.DEVELOPER);
        assert.deepEqual(conflicted.conflict.by?.by, { userId: other, name: "Charles Pan" });
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
