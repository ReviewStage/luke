import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { writePage } from "@luke/database/models/plan-pages";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, joinWorkspace, openWorkspace } from "@luke/database/testing";
import {
  PAGE_OWNER,
  PAGE_SHOWER,
  planPageVersionAnswerSchema,
  taskPagesAnswerSchema,
} from "@luke/features/page-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { type Context, Effect, Option, Result } from "effect";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { agentPagesProcedures } from "./agent-pages-procedures.js";

/**
 * The pages a coding agent on no task showed on itself, answered by the
 * hosted oRPC router the way the web route answers them, over a real
 * dialect: a member of the agent's workspace lists them and reads a version's
 * HTML, while an account of another workspace lists none and reads no
 * version, exactly as for an agent that does not exist, and a version the
 * page never had, or a path that names no UUID, is refused.
 *
 * Synthetic accounts, bearers, workspaces, agents, and pages throughout.
 */

const ORIGIN = "https://luke.test";

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

const answer = (bearers: ReadonlyMap<string, string>, request: Request) =>
  Effect.gen(function* () {
    // SAFETY: the procedures yield the database and the clock alone, which the test's own context holds.
    const services = (yield* Effect.context<never>()) as Context.Context<WebServices>;
    const handle = hostedFetch({
      agentPages: agentPagesProcedures({
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

const get = (userId: string, path: string) =>
  new Request(new URL(path, ORIGIN), { headers: { authorization: `Bearer ${userId}` } });

const pagesPath = (agentId: string) => `/api/agents/${agentId}/pages`;

const versionPath = (agentId: string, pageId: string, version: string) =>
  `${pagesPath(agentId)}/${pageId}/versions/${version}`;

function readOk<S extends Parameters<typeof readEither>[0]>(schema: S, answered: Answer) {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
  const read = readEither(schema)(unparsedWire(answered.body));
  if (Result.isFailure(read)) return assert.fail(`not the wire's: ${read.failure.refusal}`);
  return read.success;
}

it.layer(getTestDB())("an agent's own pages over HTTP", (it) => {
  it.effect(
    "a member lists an agent's pages and reads a version, and another workspace's account reads nothing of them",
    () =>
      Effect.gen(function* () {
        const starter = yield* openAccount;
        const teammate = yield* openAccount;
        const outsider = yield* openAccount;
        const workspace = yield* openWorkspace(starter);
        yield* joinWorkspace(workspace, teammate);
        yield* openWorkspace(outsider);
        const started = yield* createCodingAgent(starter, {
          taskId: null,
          organizationId: workspace,
          planSnapshot: null,
          prompt: "Chart the funnel",
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: null,
        });
        const agentId = Option.getOrThrow(started).agent.id;
        const shower = { kind: PAGE_SHOWER.AGENT, agentId } as const;
        const owner = { kind: PAGE_OWNER.AGENT, agentId } as const;
        const chart = Option.getOrThrow(
          yield* writePage(starter, owner, { title: "Funnel", html: "<h1>One</h1>" }, shower),
        );
        yield* writePage(
          starter,
          owner,
          { pageId: chart.id, title: "Funnel by week", html: "<h1>Two</h1>" },
          shower,
        );
        const bearers = new Map(
          [starter, teammate, outsider].map((id) => [`Bearer ${id}`, id] as const),
        );
        const ask = (userId: string, path: string) => answer(bearers, get(userId, path));

        const listed = readOk(taskPagesAnswerSchema, yield* ask(teammate, pagesPath(agentId)));
        const first = readOk(
          planPageVersionAnswerSchema,
          yield* ask(teammate, versionPath(agentId, chart.id, "1")),
        );

        assert.deepEqual(
          listed.pages.map(({ id, title, version, shownBy }) => ({ id, title, version, shownBy })),
          [{ id: chart.id, title: "Funnel by week", version: 2, shownBy: shower }],
        );
        assert.deepEqual([first.page.title, first.page.html], ["Funnel", "<h1>One</h1>"]);
        assert.deepEqual(readOk(taskPagesAnswerSchema, yield* ask(outsider, pagesPath(agentId))), {
          pages: [],
        });
        const notFound = {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          body: { error: HOSTED_API_ERROR.NOT_FOUND },
        };
        assert.deepEqual(yield* ask(outsider, versionPath(agentId, chart.id, "1")), notFound);
        assert.deepEqual(yield* ask(teammate, versionPath(agentId, chart.id, "3")), notFound);
        assert.deepEqual(yield* ask(teammate, versionPath("not-a-uuid", chart.id, "1")), notFound);
        assert.equal(
          (yield* ask(teammate, versionPath(agentId, chart.id, "zero"))).status,
          HOSTED_HTTP_STATUS.BAD_REQUEST,
        );
      }),
  );
});
