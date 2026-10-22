import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { user } from "@luke/database/schemas/auth";
import {
  getTestDB,
  joinWorkspace,
  leaveWorkspace,
  openWorkspace,
  WORKSPACE_ROLE,
} from "@luke/database/testing";
import { HOSTED_API_ERROR, HOSTED_SERVICE_PATH } from "@luke/features";
import {
  INTEGRATION_LANDING_STATUS,
  INTEGRATION_PROVIDER,
  type IntegrationLandingStatus,
  integrationLandingPath,
} from "@luke/features/integration-wire";
import type { WireBoundaryInput } from "@luke/wire";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Clock, type Context, Effect, Layer, Option, Redacted } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import { hostedFetch } from "../../orpc/handler.js";
import type { WebServices } from "../../runtime.js";
import { SentryApp, type SentryAppSettings, sentryAppService } from "./sentry-app-config.js";
import { sentryInstallApp } from "./sentry-install-app.js";
import { sentryInstallProcedures } from "./sentry-install-procedures.js";

/**
 * Luke's Sentry integration installed for a workspace, as the install group
 * answers it: an owner or admin opens an install at Sentry, Sentry returns
 * the browser with a code the group proves with Sentry before it links the
 * installation, any member reads what stands, and an admin disconnects one.
 * The store is the real one over the migrations on PGlite; Sentry's
 * integration platform is the one network double, which grants a token for
 * each installation's own code alone and records every call it heard.
 */

const ORIGIN = "https://luke.test";

const SETTINGS: SentryAppSettings = {
  slug: "luke",
  clientId: "client-id",
  clientSecret: Redacted.make("client-secret"),
};

const ORG_SLUG = "acme";

/** An account with a user row; its id. */
const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** One call Sentry heard: its method, its path, and the bearer it carried where it carried one. */
interface SentryCall {
  readonly method: string;
  readonly path: string;
  readonly bearer: string | null;
}

/**
 * Sentry's integration platform: a code exchanged under Luke's client for a
 * token where the code is the one `codes` holds for the installation, and an
 * installation verified with that token, answering the organization it is on.
 */
function sentryApi(codes: ReadonlyMap<string, string>) {
  const heard: SentryCall[] = [];
  const layer = fakeHttpClientLayer(async (url, init) => {
    const { pathname } = new URL(url);
    const method = init.method ?? "GET";
    heard.push({ method, path: pathname, bearer: new Headers(init.headers).get("authorization") });
    const [, installationId, rest] =
      /^\/api\/0\/sentry-app-installations\/([^/]+)\/(.*)$/u.exec(pathname) ?? [];
    if (installationId === undefined) return Response.json({}, { status: 404 });
    if (rest === "authorizations/" && method === "POST") {
      // SAFETY: the group sends one JSON body per exchange.
      const body = JSON.parse(await new Response(init.body).text()) as Record<string, string>;
      const granted =
        body.client_id === SETTINGS.clientId &&
        body.client_secret === Redacted.value(SETTINGS.clientSecret) &&
        codes.get(installationId) === body.code;
      return granted
        ? Response.json({ token: `token-${installationId}` })
        : Response.json({ detail: "invalid grant" }, { status: 401 });
    }
    if (rest === "" && method === "PUT") {
      const verified =
        new Headers(init.headers).get("authorization") === `Bearer token-${installationId}`;
      return verified
        ? Response.json({
            uuid: installationId,
            status: "installed",
            organization: { slug: ORG_SLUG },
          })
        : Response.json({ detail: "unauthorized" }, { status: 401 });
    }
    return Response.json({}, { status: 404 });
  });
  return { layer, heard };
}

/** The group over the test's database, the integration as `settings` configures it, and Sentry. */
const standing = (settings: SentryAppSettings | undefined) =>
  Effect.gen(function* () {
    const codes = new Map<string, string>();
    const sentry = sentryApi(codes);
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      Layer.succeed(SentryApp, sentryAppService(settings, ["SENTRY_APP_SLUG"])),
      sentry.layer,
    );
    const app = HttpRouter.toWebHandler(
      sentryInstallApp().pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    yield* Effect.addFinalizer(() => Effect.promise(() => app.dispose()));
    const context = yield* Effect.context<never>().pipe(Effect.provide(services));
    const procedures = hostedFetch({
      workspaceSentry: sentryInstallProcedures({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(incoming.headers.get("authorization")?.replace("Bearer ", "")),
          ),
      }),
    });
    // SAFETY: the procedures yield the database, the Sentry integration and the HTTP client alone, which is all a test provides of the web runtime's services.
    const webServices = context as Context.Context<WebServices>;
    const send = (path: string, userId: string, body?: WireBoundaryInput) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          procedures(
            new Request(new URL(path, ORIGIN), {
              method: body === undefined ? "GET" : "POST",
              headers: {
                authorization: `Bearer ${userId}`,
                ...(body === undefined ? undefined : { "content-type": "application/json" }),
              },
              ...(body === undefined ? undefined : { body: JSON.stringify(body) }),
            }),
            webServices,
          ),
        );
        // SAFETY: the router answers JSON; the test compares it as the wire value it is.
        const answer = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
        return { status: response.status, body: answer };
      });
    /** An install begun by the account; the state Sentry's address carries, or the refusal. */
    const install = (userId: string, workspaceId: string) =>
      Effect.map(
        send(HOSTED_SERVICE_PATH.WORKSPACE_SENTRY_INSTALL, userId, { workspaceId }),
        (answer) => {
          // SAFETY: an install answers `{ url }`, or a refusal that carries none.
          const { url } = answer.body as { url?: string };
          return {
            ...answer,
            url,
            state: url === undefined ? undefined : new URL(url).searchParams.get("state"),
          };
        },
      );
    /** Sentry returning the browser from installing on an organization; where it was sent on. */
    const returned = (
      state: string,
      installationId: string,
      code: string = `code-${installationId}`,
    ) =>
      Effect.gen(function* () {
        const query = new URLSearchParams({ code, installationId, orgSlug: ORG_SLUG, state });
        const response = yield* Effect.promise(() =>
          app.handler(
            new Request(new URL(`${HOSTED_SERVICE_PATH.SENTRY_INSTALLED}?${query}`, ORIGIN)),
          ),
        );
        return response.headers.get("location");
      });
    return {
      sentry,
      /** Sentry minting the code an install of this installation returns with. */
      installed: (installationId: string) => {
        codes.set(installationId, `code-${installationId}`);
        return installationId;
      },
      install,
      returned,
      read: (userId: string, workspaceId: string) =>
        send(
          `${HOSTED_SERVICE_PATH.WORKSPACE_SENTRY_INSTALLATIONS}?workspaceId=${workspaceId}`,
          userId,
        ),
      disconnect: (userId: string, workspaceId: string, installationId: string) =>
        send(HOSTED_SERVICE_PATH.WORKSPACE_SENTRY_DISCONNECT, userId, {
          workspaceId,
          installationId,
        }),
    };
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

const landed = (status: IntegrationLandingStatus) =>
  integrationLandingPath(INTEGRATION_PROVIDER.SENTRY, status);

it.layer(getTestDB())("a workspace's Sentry installation", (it) => {
  it.effect(
    "an admin installs Sentry for the workspace, proven with Sentry, and every member reads it under its organization",
    () =>
      Effect.gen(function* () {
        const group = yield* standing(SETTINGS);
        const { admin, member, workspaceId } = yield* team;
        const installationId = group.installed(randomUUID());

        const begun = yield* group.install(admin, workspaceId);
        assert.equal(begun.status, HOSTED_HTTP_STATUS.OK);
        assert.ok(
          begun.url?.startsWith("https://sentry.io/sentry-apps/luke/external-install/?state="),
        );
        const landing = yield* group.returned(
          begun.state ?? assert.fail("no state"),
          installationId,
        );
        const read = yield* group.read(member, workspaceId);

        assert.equal(landing, landed(INTEGRATION_LANDING_STATUS.CONNECTED));
        assert.deepEqual(read, {
          status: HOSTED_HTTP_STATUS.OK,
          body: { configured: true, installations: [{ installationId, account: ORG_SLUG }] },
        });
        assert.deepEqual(
          group.sentry.heard.map(({ method, path, bearer }) => ({ method, path, bearer })),
          [
            {
              method: "POST",
              path: `/api/0/sentry-app-installations/${installationId}/authorizations/`,
              bearer: null,
            },
            {
              method: "PUT",
              path: `/api/0/sentry-app-installations/${installationId}/`,
              bearer: `Bearer token-${installationId}`,
            },
          ],
        );
      }),
  );

  it.effect(
    "a member may not begin an install, a stranger is answered as though there were no such workspace, and nothing is linked",
    () =>
      Effect.gen(function* () {
        const group = yield* standing(SETTINGS);
        const { member, stranger, workspaceId } = yield* team;

        const refused = yield* group.install(member, workspaceId);
        const unknown = yield* group.install(stranger, workspaceId);
        const strangersRead = yield* group.read(stranger, workspaceId);
        const read = yield* group.read(member, workspaceId);

        assert.deepEqual(
          { status: refused.status, body: refused.body },
          { status: HOSTED_HTTP_STATUS.FORBIDDEN, body: { error: HOSTED_API_ERROR.NOT_PERMITTED } },
        );
        assert.deepEqual(unknown.body, { error: HOSTED_API_ERROR.NOT_FOUND });
        assert.deepEqual(strangersRead.body, { error: HOSTED_API_ERROR.NOT_FOUND });
        assert.deepEqual(read.body, { configured: true, installations: [] });
      }),
  );

  it.effect("a state is spent once, so one replayed or made up links nothing", () =>
    Effect.gen(function* () {
      const group = yield* standing(SETTINGS);
      const { admin, workspaceId } = yield* team;
      const first = group.installed(randomUUID());
      const second = group.installed(randomUUID());

      const begun = yield* group.install(admin, workspaceId);
      const state = begun.state ?? assert.fail("no state");
      yield* group.returned(state, first);
      const replayed = yield* group.returned(state, second);
      const madeUp = yield* group.returned("not-a-state", second);
      const read = yield* group.read(admin, workspaceId);

      assert.equal(replayed, landed(INTEGRATION_LANDING_STATUS.EXPIRED));
      assert.equal(madeUp, landed(INTEGRATION_LANDING_STATUS.EXPIRED));
      assert.deepEqual(read.body, {
        configured: true,
        installations: [{ installationId: first, account: ORG_SLUG }],
      });
    }),
  );

  it.effect("an admin who lost the role while Sentry was open links nothing", () =>
    Effect.gen(function* () {
      const group = yield* standing(SETTINGS);
      const { owner, admin, workspaceId } = yield* team;
      const installationId = group.installed(randomUUID());

      const begun = yield* group.install(admin, workspaceId);
      yield* leaveWorkspace(workspaceId, admin);
      yield* joinWorkspace(workspaceId, admin, WORKSPACE_ROLE.MEMBER);
      const landing = yield* group.returned(begun.state ?? assert.fail("no state"), installationId);
      const read = yield* group.read(owner, workspaceId);

      assert.equal(landing, landed(INTEGRATION_LANDING_STATUS.EXPIRED));
      assert.deepEqual(read.body, { configured: true, installations: [] });
      assert.deepEqual(group.sentry.heard, []);
    }),
  );

  it.effect("a code Sentry does not grant links nothing, and the state it came with is spent", () =>
    Effect.gen(function* () {
      const group = yield* standing(SETTINGS);
      const { admin, workspaceId } = yield* team;
      const installationId = group.installed(randomUUID());

      const begun = yield* group.install(admin, workspaceId);
      const state = begun.state ?? assert.fail("no state");
      const forged = yield* group.returned(state, installationId, "forged");
      const again = yield* group.returned(state, installationId);
      const read = yield* group.read(admin, workspaceId);

      assert.equal(forged, landed(INTEGRATION_LANDING_STATUS.NOT_COMPLETED));
      assert.equal(again, landed(INTEGRATION_LANDING_STATUS.EXPIRED));
      assert.deepEqual(read.body, { configured: true, installations: [] });
      assert.deepEqual(
        group.sentry.heard.map((call) => call.method),
        ["POST"],
        "an installation whose code was refused is never verified",
      );
    }),
  );

  it.effect(
    "an installation already active for another workspace stays there, and this one is told so",
    () =>
      Effect.gen(function* () {
        const group = yield* standing(SETTINGS);
        const first = yield* team;
        const second = yield* team;
        const installationId = group.installed(randomUUID());

        const one = yield* group.install(first.admin, first.workspaceId);
        yield* group.returned(one.state ?? assert.fail("no state"), installationId);
        const two = yield* group.install(second.admin, second.workspaceId);
        const landing = yield* group.returned(two.state ?? assert.fail("no state"), installationId);
        const firstRead = yield* group.read(first.member, first.workspaceId);
        const secondRead = yield* group.read(second.member, second.workspaceId);

        assert.equal(landing, landed(INTEGRATION_LANDING_STATUS.ALREADY_CONNECTED));
        assert.deepEqual(firstRead.body, {
          configured: true,
          installations: [{ installationId, account: ORG_SLUG }],
        });
        assert.deepEqual(secondRead.body, { configured: true, installations: [] });
      }),
  );

  it.effect(
    "an admin disconnects an installation, a member may not, and another workspace's is not found",
    () =>
      Effect.gen(function* () {
        const group = yield* standing(SETTINGS);
        const { admin, member, workspaceId } = yield* team;
        const other = yield* team;
        const installationId = group.installed(randomUUID());
        const othersId = group.installed(randomUUID());
        const begun = yield* group.install(admin, workspaceId);
        yield* group.returned(begun.state ?? assert.fail("no state"), installationId);
        const othersBegun = yield* group.install(other.admin, other.workspaceId);
        yield* group.returned(othersBegun.state ?? assert.fail("no state"), othersId);

        const refused = yield* group.disconnect(member, workspaceId, installationId);
        const elsewhere = yield* group.disconnect(admin, workspaceId, othersId);
        const disconnected = yield* group.disconnect(admin, workspaceId, installationId);
        const othersRead = yield* group.read(other.member, other.workspaceId);

        assert.deepEqual(refused.body, { error: HOSTED_API_ERROR.NOT_PERMITTED });
        assert.deepEqual(elsewhere.body, { error: HOSTED_API_ERROR.NOT_FOUND });
        assert.deepEqual(disconnected, {
          status: HOSTED_HTTP_STATUS.OK,
          body: { configured: true, installations: [] },
        });
        assert.deepEqual(othersRead.body, {
          configured: true,
          installations: [{ installationId: othersId, account: ORG_SLUG }],
        });
      }),
  );

  it.effect("a deployment without the integration says so to a member and refuses an install", () =>
    Effect.gen(function* () {
      const group = yield* standing(undefined);
      const { admin, member, workspaceId } = yield* team;

      const read = yield* group.read(member, workspaceId);
      const begun = yield* group.install(admin, workspaceId);

      assert.deepEqual(read.body, { configured: false, installations: [] });
      assert.deepEqual(begun.body, { error: HOSTED_API_ERROR.UNAVAILABLE });
    }),
  );
});
