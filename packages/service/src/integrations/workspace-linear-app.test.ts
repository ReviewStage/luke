import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { workspaceOf } from "@luke/database/models/workspace-store";
import { user } from "@luke/database/schemas/auth";
import { workspaceIntegrationConnection } from "@luke/database/schemas/workspace-integration";
import { getTestDB, joinWorkspace, openWorkspace, WORKSPACE_ROLE } from "@luke/database/testing";
import { HOSTED_API_ERROR, HOSTED_SERVICE_PATH } from "@luke/features";
import {
  INTEGRATION_LANDING_STATUS,
  INTEGRATION_PROVIDER,
  integrationLandingPath,
} from "@luke/features/integration-wire";
import type { WireBoundaryInput } from "@luke/wire";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { eq } from "drizzle-orm";
import { Clock, type Context, Effect, Layer, Option } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { GRANTING_SIGN_IN_URL, integrationConnectOver } from "../testing/integration-connect.js";
import { mintIntegrationState } from "./integrations-app.js";
import { workspaceLinearApp } from "./workspace-linear-app.js";
import { workspaceLinearProcedures } from "./workspace-linear-procedures.js";

/**
 * A workspace's one Linear connection, as the hosted oRPC router and the
 * browser's callback answer it: an owner or admin begins the sign-in for every member, the browser's
 * return connects the workspace, any member then reads the issues it
 * reaches through the workspace's grant, and a Disconnect ends every read.
 * The store is the real one over the migrations on PGlite; Vercel Connect is
 * the production read of a deployment naming the accounts' Linear connector
 * and the workspace Linear connector beside it, over a
 * Connect that grants every subject a token naming it; Linear's GraphQL API
 * is the one network double, which records every bearer and query it was
 * asked with.
 */

const ORIGIN = "https://luke.test";
/** The accounts' Linear connector alone, as a deployment named it before workspaces had a connector of their own. */
const ACCOUNT_LINEAR_CONNECTOR = { LINEAR_CONNECTOR_UID: "mcp.linear.app/linear" } as const;
const LINEAR_CONNECTOR = {
  ...ACCOUNT_LINEAR_CONNECTOR,
  LINEAR_WORKSPACE_CONNECTOR_UID: "linear/luke-workspaces",
} as const;

/** One issue as Linear's GraphQL API lists it. */
const LINEAR_NODE = {
  id: "issue-1",
  identifier: "ENG-1",
  title: "Start a plan from Linear",
  url: "https://linear.app/acme/issue/ENG-1",
  state: { name: "Todo" },
  assignee: { name: "Sam Okafor" },
};

/** An account with a user row; its id. */
const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** Linear's GraphQL API, listing the one issue to anyone unless it `refuses` every token, and every bearer and query it heard. */
function linearApi(refuses: boolean) {
  const asked: { bearer: string; query: string }[] = [];
  const layer = fakeHttpClientLayer(async (_url, init) => {
    // SAFETY: the client sends one GraphQL request body per call.
    const body = JSON.parse(await new Response(init.body).text()) as {
      query: string;
      variables: { id?: string };
    };
    asked.push({ bearer: new Headers(init.headers).get("authorization") ?? "", query: body.query });
    if (refuses) return Response.json({ errors: [{ message: "unauthorized" }] }, { status: 401 });
    // An issue asked for by its identifier is the one issue, or Linear's null for one it holds no such issue for.
    if (body.variables.id !== undefined) {
      const issue = body.variables.id === LINEAR_NODE.identifier ? LINEAR_NODE : null;
      return Response.json({ data: { issue } });
    }
    return Response.json({ data: { issues: { nodes: [LINEAR_NODE] } } });
  });
  return { layer, asked };
}

/** The group over the test's database, a deployment naming these Linear connectors, and Linear's API. */
const standing = (
  refuses = false,
  connectors: Readonly<Record<string, string>> = LINEAR_CONNECTOR,
) =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock;
    const linear = linearApi(refuses);
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, clock),
      integrationConnectOver(connectors),
      linear.layer,
    );
    const callback = HttpRouter.toWebHandler(
      workspaceLinearApp({ now: () => clock.currentTimeMillisUnsafe() }).pipe(
        HttpRouter.provideRequest(services),
      ),
      { disableLogger: true },
    );
    yield* Effect.addFinalizer(() => Effect.promise(() => callback.dispose()));
    const context = yield* Effect.context<never>().pipe(Effect.provide(services));
    const procedures = hostedFetch({
      workspaceLinear: workspaceLinearProcedures({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(incoming.headers.get("authorization")?.replace("Bearer ", "")),
          ),
        mintState: mintIntegrationState,
      }),
    });
    // SAFETY: the procedures yield the database, Connect, the clock and the HTTP client alone, which is all a test provides of the web runtime's services.
    const webServices = context as Context.Context<WebServices>;
    const fetch = (path: string) =>
      Effect.promise(() => callback.handler(new Request(new URL(path, ORIGIN))));
    /** One request the procedures answer: its status, and its body as JSON. */
    const answered = (request: Request) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() => procedures(request, webServices));
        // SAFETY: the router answers JSON; the test compares it as the wire value it is.
        const answer = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
        return { status: response.status, body: answer };
      });
    const post = (path: string, userId: string, body: WireBoundaryInput) =>
      answered(
        new Request(new URL(path, ORIGIN), {
          method: "POST",
          headers: { authorization: `Bearer ${userId}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    return {
      linear,
      answered,
      connect: (userId: string, workspaceId: string) =>
        post(HOSTED_SERVICE_PATH.WORKSPACE_LINEAR_CONNECT, userId, { workspaceId }),
      disconnect: (userId: string, workspaceId: string) =>
        post(HOSTED_SERVICE_PATH.WORKSPACE_LINEAR_DISCONNECT, userId, { workspaceId }),
      issues: (userId: string, workspaceId: string) =>
        post(HOSTED_SERVICE_PATH.WORKSPACE_LINEAR_ISSUES, userId, { workspaceId }),
      issue: (userId: string, workspaceId: string, identifier: string) =>
        post(HOSTED_SERVICE_PATH.WORKSPACE_LINEAR_ISSUES, userId, { workspaceId, identifier }),
      /** The browser back from Connect with the state the sign-in carried; where it was sent on. */
      returned: (state: string) =>
        Effect.map(
          fetch(`${HOSTED_SERVICE_PATH.WORKSPACE_LINEAR_CONNECTED}?state=${state}`),
          (response) => response.headers.get("location"),
        ),
    };
  });

/** The state the sign-in Connect began carries back, read off the callback address it was handed. */
const signInState = (workspaceId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [row] = yield* db
      .select({ state: workspaceIntegrationConnection.state })
      .from(workspaceIntegrationConnection)
      .where(eq(workspaceIntegrationConnection.organizationId, workspaceId));
    return row?.state ?? assert.fail("no sign-in under way");
  });

/** A workspace with an owner, an admin, and a member, and a stranger to it. */
const team = Effect.gen(function* () {
  const owner = yield* openAccount;
  const admin = yield* openAccount;
  const member = yield* openAccount;
  const stranger = yield* openAccount;
  const workspaceId = yield* openWorkspace(owner);
  yield* joinWorkspace(workspaceId, admin, WORKSPACE_ROLE.ADMIN);
  yield* joinWorkspace(workspaceId, member, WORKSPACE_ROLE.MEMBER);
  return { owner, admin, member, stranger, workspaceId };
});

it.layer(getTestDB())("a workspace's Linear connection", (it) => {
  it.effect(
    "an admin connects Linear for the workspace, a member may not, and a stranger is answered as though there were no such workspace",
    () =>
      Effect.gen(function* () {
        const group = yield* standing();
        const { admin, member, stranger, workspaceId } = yield* team;

        const refused = yield* group.connect(member, workspaceId);
        const unknown = yield* group.connect(stranger, workspaceId);
        const begun = yield* group.connect(admin, workspaceId);
        const landed = yield* group.returned(yield* signInState(workspaceId));
        const listed = yield* workspaceOf(member, workspaceId);

        assert.deepEqual(refused, {
          status: HOSTED_HTTP_STATUS.FORBIDDEN,
          body: { error: HOSTED_API_ERROR.NOT_PERMITTED },
        });
        assert.deepEqual(unknown.body, { error: HOSTED_API_ERROR.NOT_FOUND });
        assert.deepEqual(begun, {
          status: HOSTED_HTTP_STATUS.OK,
          body: { url: GRANTING_SIGN_IN_URL },
        });
        assert.equal(
          landed,
          integrationLandingPath(INTEGRATION_PROVIDER.LINEAR, INTEGRATION_LANDING_STATUS.CONNECTED),
        );
        assert.ok(Option.isSome(listed));
        assert.deepEqual(listed.value.linear, { active: true });
      }),
  );

  it.effect(
    "every member reads the issues through the workspace's own grant, with no team filter, and a workspace with none connected is refused",
    () =>
      Effect.gen(function* () {
        const group = yield* standing();
        const { admin, member, workspaceId } = yield* team;
        const other = yield* team;

        const before = yield* group.issues(member, workspaceId);
        yield* group.connect(admin, workspaceId);
        yield* group.returned(yield* signInState(workspaceId));
        const read = yield* group.issues(member, workspaceId);
        const elsewhere = yield* group.issues(other.member, other.workspaceId);

        assert.deepEqual(before.body, { error: HOSTED_API_ERROR.LINEAR_UNAVAILABLE });
        assert.deepEqual(read, {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            issues: [
              {
                id: LINEAR_NODE.id,
                identifier: LINEAR_NODE.identifier,
                title: LINEAR_NODE.title,
                url: LINEAR_NODE.url,
                state: "Todo",
                assignee: "Sam Okafor",
              },
            ],
          },
        });
        // The token Connect issues names its subject: the workspace, never the member asking.
        assert.deepEqual(
          group.linear.asked.map((ask) => ask.bearer),
          [`Bearer token_${workspaceId}`],
        );
        assert.equal(group.linear.asked[0]?.query.includes("team"), false);
        assert.deepEqual(elsewhere.body, { error: HOSTED_API_ERROR.LINEAR_UNAVAILABLE });
      }),
  );

  it.effect(
    "a member reads one issue by its identifier, its state and its assignee among it, through the workspace's grant, and none for an identifier Linear holds no issue for",
    () =>
      Effect.gen(function* () {
        const group = yield* standing();
        const { admin, member, stranger, workspaceId } = yield* team;
        yield* group.connect(admin, workspaceId);
        yield* group.returned(yield* signInState(workspaceId));

        const read = yield* group.issue(member, workspaceId, "ENG-1");
        const unknown = yield* group.issue(member, workspaceId, "ENG-404");
        const strangers = yield* group.issue(stranger, workspaceId, "ENG-1");
        const malformed = yield* group.issue(member, workspaceId, "eng 1");

        assert.deepEqual(read, {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            issues: [
              {
                id: LINEAR_NODE.id,
                identifier: LINEAR_NODE.identifier,
                title: LINEAR_NODE.title,
                url: LINEAR_NODE.url,
                state: "Todo",
                assignee: "Sam Okafor",
              },
            ],
          },
        });
        assert.deepEqual(unknown, { status: HOSTED_HTTP_STATUS.OK, body: { issues: [] } });
        assert.ok(
          group.linear.asked[0]?.query.includes("assignee { name }"),
          "Linear is asked who it is assigned to",
        );
        assert.notEqual(strangers.status, HOSTED_HTTP_STATUS.OK);
        assert.notEqual(malformed.status, HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(
          group.linear.asked.map((ask) => ask.bearer),
          [`Bearer token_${workspaceId}`, `Bearer token_${workspaceId}`],
        );
      }),
  );

  it.effect("a Disconnect by an admin ends every read through the workspace's grant", () =>
    Effect.gen(function* () {
      const group = yield* standing();
      const { admin, member, workspaceId } = yield* team;
      yield* group.connect(admin, workspaceId);
      yield* group.returned(yield* signInState(workspaceId));

      const refused = yield* group.disconnect(member, workspaceId);
      const disconnected = yield* group.disconnect(admin, workspaceId);
      const after = yield* group.issues(member, workspaceId);

      assert.deepEqual(refused.body, { error: HOSTED_API_ERROR.NOT_PERMITTED });
      assert.equal(disconnected.status, HOSTED_HTTP_STATUS.OK);
      // SAFETY: a disconnect answers the workspace as it then stands.
      assert.equal(
        (disconnected.body as { workspace: { linear?: unknown } }).workspace.linear,
        undefined,
      );
      assert.deepEqual(after.body, { error: HOSTED_API_ERROR.LINEAR_UNAVAILABLE });
    }),
  );

  it.effect(
    "Linear refusing the workspace's token marks its connection expired, so Settings says so and the issues are refused",
    () =>
      Effect.gen(function* () {
        const group = yield* standing(true);
        const { admin, member, workspaceId } = yield* team;
        yield* group.connect(admin, workspaceId);
        yield* group.returned(yield* signInState(workspaceId));

        const refused = yield* group.issues(member, workspaceId);
        const listed = yield* workspaceOf(member, workspaceId);

        assert.deepEqual(refused.body, { error: HOSTED_API_ERROR.LINEAR_UNAVAILABLE });
        assert.ok(Option.isSome(listed));
        assert.deepEqual(listed.value.linear, { active: false });
      }),
  );

  it.effect(
    "a deployment naming only the accounts' Linear connector connects no workspace, since its tokens are its MCP server's and Linear's API refuses them",
    () =>
      Effect.gen(function* () {
        const group = yield* standing(false, ACCOUNT_LINEAR_CONNECTOR);
        const { admin, member, workspaceId } = yield* team;

        const begun = yield* group.connect(admin, workspaceId);
        const read = yield* group.issues(member, workspaceId);
        const listed = yield* workspaceOf(member, workspaceId);

        assert.deepEqual(begun.body, { error: HOSTED_API_ERROR.UNAVAILABLE });
        assert.deepEqual(read.body, { error: HOSTED_API_ERROR.LINEAR_UNAVAILABLE });
        assert.ok(Option.isSome(listed));
        assert.equal(listed.value.linear, undefined);
        assert.deepEqual(group.linear.asked, []);
      }),
  );

  it.effect(
    "the refusals are byte for byte the old group's: unsigned is 401 whatever it sent, a stray key or a body past the cap is refused, and another method is 405",
    () =>
      Effect.gen(function* () {
        const group = yield* standing();
        const { admin, workspaceId } = yield* team;
        const asked = (init: { method?: string; signedIn?: boolean; body?: string }) => {
          const headers = new Headers();
          if (init.signedIn !== false) headers.set("authorization", `Bearer ${admin}`);
          const request: RequestInit = { method: init.method ?? "POST", headers };
          if (init.body !== undefined) {
            headers.set("content-type", "application/json");
            headers.set("content-length", String(new TextEncoder().encode(init.body).byteLength));
            request.body = init.body;
          }
          return group.answered(
            new Request(new URL(HOSTED_SERVICE_PATH.WORKSPACE_LINEAR_ISSUES, ORIGIN), request),
          );
        };

        assert.deepEqual(
          yield* asked({ signedIn: false, body: JSON.stringify({ workspaceId: 7 }) }),
          {
            status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
            body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
          },
        );
        assert.deepEqual(yield* asked({ body: JSON.stringify({ workspaceId, team: "ENG" }) }), {
          status: HOSTED_HTTP_STATUS.BAD_REQUEST,
          body: { error: HOSTED_API_ERROR.INVALID_REQUEST },
        });
        assert.deepEqual(
          yield* asked({ body: JSON.stringify({ workspaceId, query: "x".repeat(4_096) }) }),
          {
            status: HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE,
            body: { error: HOSTED_API_ERROR.REQUEST_TOO_LARGE },
          },
        );
        assert.deepEqual(yield* asked({ method: "GET" }), {
          status: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
          body: { error: HOSTED_API_ERROR.METHOD_NOT_ALLOWED },
        });
      }),
  );
});
