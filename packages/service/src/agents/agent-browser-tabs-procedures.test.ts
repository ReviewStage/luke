import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { upsertBrowserTab } from "@luke/database/models/agent-browser-tabs";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { recordRepositoryReads } from "@luke/database/models/github-repository-reads";
import { saveGitHubToken } from "@luke/database/models/github-token-store";
import { createTask } from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, joinWorkspace, openWorkspace } from "@luke/database/testing";
import {
  AGENT_BROWSER_TAB_OPENER,
  type AgentBrowserTab,
  agentBrowserTabAnswerSchema,
  agentBrowserTabsAnswerSchema,
} from "@luke/features/agent-browser-tab-wire";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { type Context, DateTime, Effect, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import {
  agentBrowserTabsProcedures,
  BROWSER_TAKEOVER_HOLD_MS,
} from "./agent-browser-tabs-procedures.js";

/**
 * A task's Browser tabs, answered by the hosted oRPC router the way the web
 * route answers them, over a real dialect: a member who reaches the task
 * lists every tab they see, each naming the coding agent whose browser holds
 * it; a takeover makes them the driver for the hold, a
 * second member's answers the first as driver until that hold lapses, and a
 * hand-back gives the tab back; a member who does not control a coding agent
 * on its starter's own token may see its tab but not drive it; and a task or
 * tab the bearer does not reach is not found.
 *
 * Synthetic accounts, bearers, workspaces, agents, and pages throughout.
 */

const ORIGIN = "https://luke.test";

/** The repository a coding agent on its starter's token works in, which a reader's token reads. */
const TOKEN_REPOSITORY = "octo-member/side";

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

const openAccount = Effect.gen(function* () {
  const id = `user-${randomUUID()}`;
  yield* Database.use((db) =>
    db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` }),
  );
  return id;
});

/** A member whose verified token GitHub last answered reading the token agent's repository. */
const keepReadingToken = (userId: string) =>
  Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const sealedToken = `sealed-${randomUUID()}`;
    yield* saveGitHubToken(
      userId,
      { keyVersion: 1, sealedDataKey: "sealed-key", sealedToken },
      { hint: "fixture…abcd", githubUserId: "4242", githubLogin: "octo-member", expiresAt: null },
      now,
    );
    yield* recordRepositoryReads(
      userId,
      sealedToken,
      [{ repository: TOKEN_REPOSITORY, readable: true }],
      now,
    );
  });

/**
 * A starter's task, shared with a teammate and a reader, with two tabs: one
 * in a coding agent's browser, and one in a coding agent's on the starter's
 * own token, which the reader sees and the teammate does not.
 */
const openTask = Effect.gen(function* () {
  const [starter, teammate, reader, outsider] = [
    yield* openAccount,
    yield* openAccount,
    yield* openAccount,
    yield* openAccount,
  ];
  const workspace = yield* openWorkspace(starter);
  yield* joinWorkspace(workspace, teammate);
  yield* joinWorkspace(workspace, reader);
  yield* openWorkspace(outsider);
  yield* keepReadingToken(reader);
  const { id: taskId } = yield* createTask(starter, {
    organizationId: workspace,
    name: "Checkout",
  });
  const startAgent = (
    repository: string,
    githubAccess: typeof GITHUB_ACCESS.APP | typeof GITHUB_ACCESS.TOKEN,
  ) =>
    Effect.map(
      createCodingAgent(starter, {
        taskId,
        planSnapshot: "# Checkout",
        prompt: null,
        idempotencyKey: randomUUID(),
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        repository,
        githubAccess,
      }),
      (started) => Option.getOrThrow(started).agent,
    );
  const coder = yield* startAgent("acme/shop", GITHUB_ACCESS.APP);
  const tokenCoder = yield* startAgent(TOKEN_REPOSITORY, GITHUB_ACCESS.TOKEN);
  const open = (conversationId: string, address: string) =>
    upsertBrowserTab({
      conversationId,
      targetId: randomUUID(),
      address,
      title: address,
      openedBy: { kind: AGENT_BROWSER_TAB_OPENER.AGENT },
    });
  const coderTab = yield* open(coder.conversationId, "http://localhost:3000/");
  yield* TestClock.adjust("1 second");
  const tokenTab = yield* open(tokenCoder.conversationId, "https://side.test/");
  const bearers = new Map(
    [starter, teammate, reader, outsider].map((id) => [`Bearer ${id}`, id] as const),
  );
  const ask = (request: Request) => answer(bearers, request);
  return {
    starter,
    teammate,
    reader,
    outsider,
    taskId,
    coder,
    tokenCoder,
    coderTab,
    tokenTab,
    ask,
  };
});

const answer = (bearers: ReadonlyMap<string, string>, request: Request) =>
  Effect.gen(function* () {
    // SAFETY: the procedures yield the database and the clock alone, which the test's own context holds.
    const services = (yield* Effect.context<never>()) as Context.Context<WebServices>;
    const handle = hostedFetch({
      agentBrowserTabs: agentBrowserTabsProcedures({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
          ),
      }),
    });
    const response = yield* Effect.promise(() => handle(request, services));
    // SAFETY: the route answers JSON; the test compares it as the wire value it is.
    const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
    return { status: response.status, body } satisfies Answer;
  });

function request(userId: string | undefined, path: string, method = "GET") {
  return new Request(new URL(path, ORIGIN), {
    method,
    headers: userId === undefined ? {} : { authorization: `Bearer ${userId}` },
  });
}

const tabsPath = (taskId: string) => `/api/plans/${taskId}/browser-tabs`;

const driverPath = (taskId: string, tabId: string) => `${tabsPath(taskId)}/${tabId}/driver`;

const refusal = (status: number, error: string): Answer => ({ status, body: { error } });

function tabsOf(answered: Answer): readonly AgentBrowserTab[] {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
  const read = readEither(agentBrowserTabsAnswerSchema)(unparsedWire(answered.body));
  if (Result.isFailure(read)) return assert.fail(`not the wire's: ${read.failure.refusal}`);
  return read.success.tabs;
}

function tabOf(answered: Answer): AgentBrowserTab {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
  const read = readEither(agentBrowserTabAnswerSchema)(unparsedWire(answered.body));
  if (Result.isFailure(read)) return assert.fail(`not the wire's: ${read.failure.refusal}`);
  return read.success.tab;
}

it.layer(getTestDB())("a task's Browser tabs route", (it) => {
  it.effect(
    "a member lists the tabs they see on the task, each naming whose browser holds it",
    () =>
      Effect.gen(function* () {
        const {
          starter,
          teammate,
          reader,
          taskId,
          coder,
          tokenCoder,
          coderTab,
          tokenTab,
          ask,
        } = yield* openTask;
        const listed = (member: string) =>
          Effect.map(ask(request(member, tabsPath(taskId))), (answered) =>
            tabsOf(answered).map((tab) => [tab.id, tab.agentId]),
          );

        const all = [
          [coderTab.id, coder.id],
          [tokenTab.id, tokenCoder.id],
        ];
        assert.deepEqual(yield* listed(starter), all);
        assert.deepEqual(yield* listed(reader), all);
        assert.deepEqual(yield* listed(teammate), all.slice(0, 1));
        const [first] = tabsOf(yield* ask(request(starter, tabsPath(taskId))));
        assert.deepEqual(first, {
          id: coderTab.id,
          agentId: coder.id,
          address: "http://localhost:3000/",
          title: "http://localhost:3000/",
          openedBy: { kind: AGENT_BROWSER_TAB_OPENER.AGENT },
          driver: null,
          createdAt: coderTab.createdAt.getTime(),
          lastActedAt: coderTab.lastActedAt.getTime(),
        });
      }),
  );

  it.effect(
    "a takeover makes the member the driver for the hold, another member's answers them as driver until it lapses, and a hand-back gives the tab back",
    () =>
      Effect.gen(function* () {
        const { starter, teammate, taskId, coderTab, ask } = yield* openTask;
        const path = driverPath(taskId, coderTab.id);
        const takenAt = (yield* DateTime.nowAsDate).getTime();

        const taken = tabOf(yield* ask(request(starter, path, "POST")));
        assert.deepEqual(taken.driver, {
          userId: starter,
          heldUntil: takenAt + BROWSER_TAKEOVER_HOLD_MS,
        });
        assert.deepEqual(tabOf(yield* ask(request(teammate, path, "POST"))).driver, taken.driver);
        assert.deepEqual(tabOf(yield* ask(request(teammate, path, "DELETE"))).driver, taken.driver);

        yield* TestClock.adjust(BROWSER_TAKEOVER_HOLD_MS + 1_000);
        const [lapsed] = tabsOf(yield* ask(request(teammate, `/api/plans/${taskId}/browser-tabs`)));
        assert.equal(lapsed?.driver, null);
        assert.equal(tabOf(yield* ask(request(teammate, path, "POST"))).driver?.userId, teammate);
        assert.equal(tabOf(yield* ask(request(teammate, path, "DELETE"))).driver, null);
      }),
  );

  it.effect(
    "a tab of a coding agent on its starter's token is driven by its starter alone, and a task or tab out of reach is not found",
    () =>
      Effect.gen(function* () {
        const { starter, teammate, reader, outsider, taskId, coderTab, tokenTab, ask } =
          yield* openTask;
        const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);

        assert.deepEqual(
          yield* ask(request(reader, driverPath(taskId, tokenTab.id), "POST")),
          refusal(HOSTED_HTTP_STATUS.FORBIDDEN, HOSTED_API_ERROR.NOT_PERMITTED),
        );
        assert.deepEqual(
          yield* ask(request(teammate, driverPath(taskId, tokenTab.id), "POST")),
          notFound,
        );
        assert.equal(
          tabOf(yield* ask(request(starter, driverPath(taskId, tokenTab.id), "POST"))).driver
            ?.userId,
          starter,
        );
        assert.deepEqual(yield* ask(request(outsider, tabsPath(taskId))), notFound);
        assert.deepEqual(
          yield* ask(request(outsider, driverPath(taskId, coderTab.id), "POST")),
          notFound,
        );
        assert.deepEqual(yield* ask(request(starter, tabsPath("not-a-task"))), notFound);
        assert.deepEqual(
          yield* ask(request(starter, driverPath(taskId, randomUUID()), "POST")),
          notFound,
        );
        assert.deepEqual(
          yield* ask(request(undefined, tabsPath(taskId))),
          refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
        );
      }),
  );
});
