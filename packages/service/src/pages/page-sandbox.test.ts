import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database, type DatabaseServices } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import { writePage } from "@repo/database/models/task-pages";
import { user } from "@repo/database/schemas/auth";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, joinWorkspace, leaveWorkspace, startTask } from "@repo/database/testing";
import {
  PAGE_FRAME_STATUS,
  PAGE_IN_MAC_APP_PATH,
  PAGE_SANDBOX_ORIGIN,
} from "@repo/features/page-frame";
import { PAGE_OWNER, PAGE_SHOWER, taskPageOwner } from "@repo/features/page-wire";
import { Clock, type Context, Duration, Effect, Layer, Option, Redacted } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { agentPagesProcedures } from "../agents/agent-pages-procedures.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { taskFilesProcedures } from "../tasks/task-files-procedures.js";
import { PAGE_LINK_ROUTE, PageLinks, type PageSandbox } from "./page-links.js";
import { pageSandboxApp } from "./page-sandbox-app.js";

const APP_ORIGIN = "https://tryluke.dev";

const SANDBOX: PageSandbox = {
  origin: PAGE_SANDBOX_ORIGIN,
  key: Redacted.make("synthetic-page-link-key-for-tests-only-0000"),
  appOrigins: [APP_ORIGIN],
};

const CHART = { title: "Invite funnel", html: "<!doctype html><p>Invites by week</p>" } as const;

const LOAD = { FRAME: "iframe", TAB: "document", UNNAMED: "unnamed" } as const;

type Load = (typeof LOAD)[keyof typeof LOAD];

const loadHeaders = (load: Load): Record<string, string> =>
  load === LOAD.UNNAMED ? {} : { "sec-fetch-dest": load };

const openAccount = Effect.gen(function* () {
  const id = `user-${randomUUID()}`;
  yield* Database.use((db) =>
    db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` }),
  );
  return id;
});

const pageOnTask = Effect.gen(function* () {
  const starter = yield* openAccount;
  const teammate = yield* openAccount;
  const task = yield* startTask(starter, { name: "Teammate invitations" });
  yield* joinWorkspace(task.workspaceId, teammate);
  const page = Option.getOrThrow(
    yield* writePage(starter, taskPageOwner(task.id), CHART, { kind: PAGE_SHOWER.APP }),
  );
  return { starter, teammate, task, page };
});

const standing = (sandbox: PageSandbox | undefined) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      Layer.succeed(PageLinks, { sandbox }),
    );
    const route = HttpRouter.toWebHandler(
      pageSandboxApp().pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    yield* Effect.addFinalizer(() => Effect.promise(() => route.dispose()));
    const context = (yield* Effect.context<DatabaseServices | PageLinks>().pipe(
      Effect.provide(services),
    )) as Context.Context<WebServices>;
    const resolveUserId = (incoming: Request) =>
      Effect.succeed(
        Option.fromNullishOr(incoming.headers.get("authorization")?.replace("Bearer ", "")),
      );
    const procedures = hostedFetch({
      agentPages: agentPagesProcedures({ resolveUserId }),
      taskFiles: taskFilesProcedures({ resolveUserId }),
    });
    const frame = (userId: string, path: string, load: Load = LOAD.FRAME) =>
      Effect.promise(() =>
        procedures(
          new Request(`${APP_ORIGIN}${path}`, {
            headers: { authorization: `Bearer ${userId}`, ...loadHeaders(load) },
          }),
          context,
        ),
      );
    const follow = (link: string, host = new URL(link).host, load: Load = LOAD.FRAME) => {
      const token = new URL(link).pathname.slice(`/${PAGE_LINK_ROUTE.STEP}/`.length);
      const address = `https://${host}${PAGE_LINK_ROUTE.PATH}?${PAGE_LINK_ROUTE.TOKEN_QUERY}=${token}`;
      return Effect.promise(() =>
        route.handler(new Request(address, { headers: loadHeaders(load) })),
      );
    };
    return { frame, follow };
  });

const framePath = (taskId: string, pageId: string, version: number) =>
  `/api/plans/${taskId}/pages/${pageId}/versions/${version}/frame`;

function linkOf(answer: Response): string {
  assert.equal(answer.status, PAGE_FRAME_STATUS);
  return answer.headers.get("location") ?? "";
}

function directivesOf(policy: string): ReadonlyMap<string, string> {
  return new Map(
    policy.split(";").map((directive) => {
      const [name = "", ...sources] = directive.trim().split(/\s+/u);
      return [name, sources.join(" ")];
    }),
  );
}

const NOT_FOUND = { status: HOSTED_HTTP_STATUS.NOT_FOUND, error: HOSTED_API_ERROR.NOT_FOUND };

const refusalOf = (answer: Response) =>
  Effect.map(
    Effect.promise(() => answer.json()),
    (body: { readonly error?: string }) => ({ status: answer.status, error: body.error }),
  );

it.layer(getTestDB())("a page framed on the web", (it) => {
  it.effect(
    "a member's frame is sent on to a link on the sandbox that serves the version as a page sealed off from the app, framed by the app alone and setting no cookie",
    () =>
      Effect.gen(function* () {
        const { frame, follow } = yield* standing(SANDBOX);
        const { starter, teammate, task, page } = yield* pageOnTask;
        const agent = Option.getOrThrow(
          yield* createAgent(starter, {
            taskId: null,
            organizationId: task.workspaceId,
            descriptionSnapshot: null,
            prompt: "Chart the funnel",
            idempotencyKey: randomUUID(),
            model: "anthropic/claude-opus-5.5",
            effort: "high",
            repository: null,
            runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
          }),
        ).agent;
        const owner = { kind: PAGE_OWNER.AGENT, agentId: agent.id } as const;
        const shower = { kind: PAGE_SHOWER.AGENT, agentId: agent.id } as const;
        const own = Option.getOrThrow(
          yield* writePage(starter, owner, { title: "Mockup", html: "<p>Mockup</p>" }, shower),
        );

        const answer = yield* frame(teammate, framePath(task.id, page.id, 1));
        const served = yield* follow(linkOf(answer));
        const policy = directivesOf(served.headers.get("content-security-policy") ?? "");
        const agentLink = linkOf(
          yield* frame(teammate, `/api/agents/${agent.id}/pages/${own.id}/versions/1/frame`),
        );
        const agentServed = yield* follow(agentLink);

        assert.ok(linkOf(answer).startsWith(`${PAGE_SANDBOX_ORIGIN}/${PAGE_LINK_ROUTE.STEP}/`));
        assert.equal(answer.headers.get("cache-control"), "private, no-store");
        assert.equal(answer.headers.get("referrer-policy"), "no-referrer");
        assert.equal(served.status, HOSTED_HTTP_STATUS.OK);
        assert.ok((yield* Effect.promise(() => served.text())).endsWith("<p>Invites by week</p>"));
        assert.equal(served.headers.get("content-type"), "text/html; charset=utf-8");
        assert.equal(policy.get("sandbox"), "allow-scripts");
        assert.equal(policy.get("connect-src"), "'none'");
        assert.equal(policy.get("frame-ancestors"), APP_ORIGIN);
        assert.equal(served.headers.get("x-content-type-options"), "nosniff");
        assert.equal(served.headers.get("referrer-policy"), "no-referrer");
        assert.equal(served.headers.get("cache-control"), "private, no-store");
        assert.equal(served.headers.get("set-cookie"), null);
        assert.ok((yield* Effect.promise(() => agentServed.text())).endsWith("<p>Mockup</p>"));
      }),
  );

  it.effect(
    "an account the page's task does not reach is minted no link, and one that loses the task is served nothing by the link it was minted",
    () =>
      Effect.gen(function* () {
        const { frame, follow } = yield* standing(SANDBOX);
        const { teammate, task, page } = yield* pageOnTask;
        const outsider = yield* openAccount;
        const link = linkOf(yield* frame(teammate, framePath(task.id, page.id, 1)));

        yield* leaveWorkspace(task.workspaceId, teammate);

        assert.deepEqual(
          yield* refusalOf(yield* frame(outsider, framePath(task.id, page.id, 1))),
          NOT_FOUND,
        );
        assert.deepEqual(yield* refusalOf(yield* follow(link)), NOT_FOUND);
      }),
  );

  it.effect("a link is served until a minute after it was minted, and not after", () =>
    Effect.gen(function* () {
      const { frame, follow } = yield* standing(SANDBOX);
      const { teammate, task, page } = yield* pageOnTask;
      const link = linkOf(yield* frame(teammate, framePath(task.id, page.id, 1)));

      yield* TestClock.adjust(Duration.seconds(59));
      const within = yield* follow(link);
      yield* TestClock.adjust(Duration.seconds(1));

      assert.equal(within.status, HOSTED_HTTP_STATUS.OK);
      assert.deepEqual(yield* refusalOf(yield* follow(link)), NOT_FOUND);
    }),
  );

  it.effect(
    "a page's frame address and its link answer a frame's load alone: a whole tab's, or a load that names none, is minted no link and served no page",
    () =>
      Effect.gen(function* () {
        const { frame, follow } = yield* standing(SANDBOX);
        const { teammate, task, page } = yield* pageOnTask;
        const path = framePath(task.id, page.id, 1);
        const link = linkOf(yield* frame(teammate, path, LOAD.FRAME));
        const host = new URL(link).host;

        assert.equal((yield* follow(link, host, LOAD.FRAME)).status, HOSTED_HTTP_STATUS.OK);
        for (const load of [LOAD.TAB, LOAD.UNNAMED]) {
          assert.deepEqual(yield* refusalOf(yield* frame(teammate, path, load)), NOT_FOUND, load);
          assert.deepEqual(yield* refusalOf(yield* follow(link, host, load)), NOT_FOUND, load);
        }
      }),
  );

  it.effect(
    "a link is served on the sandbox's host as its links spell it alone: never on the app's, nor on the sandbox's spelled with a trailing dot",
    () =>
      Effect.gen(function* () {
        const { frame, follow } = yield* standing(SANDBOX);
        const { teammate, task, page } = yield* pageOnTask;
        const link = linkOf(yield* frame(teammate, framePath(task.id, page.id, 1)));
        const host = new URL(link).host;

        for (const elsewhere of [new URL(APP_ORIGIN).host, `${host}.`]) {
          assert.deepEqual(yield* refusalOf(yield* follow(link, elsewhere)), NOT_FOUND, elsewhere);
        }
      }),
  );

  it.effect(
    "without a sandbox, a frame is sent to the page saying pages open in the Mac app, and the route serves no link",
    () =>
      Effect.gen(function* () {
        const configured = yield* standing(SANDBOX);
        const unset = yield* standing(undefined);
        const { teammate, task, page } = yield* pageOnTask;
        const link = linkOf(yield* configured.frame(teammate, framePath(task.id, page.id, 1)));

        assert.equal(
          linkOf(yield* unset.frame(teammate, framePath(task.id, page.id, 1))),
          PAGE_IN_MAC_APP_PATH,
        );
        assert.deepEqual(yield* refusalOf(yield* unset.follow(link)), NOT_FOUND);
      }),
  );
});
