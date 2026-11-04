import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { DatabaseServices } from "@repo/database/core/query";
import { OrganizationRefused } from "@repo/database/models/workspace-seams";
import { HOSTED_SERVICE_PATH } from "@repo/features";
import type { WireBoundaryInput } from "@repo/wire";
import { type Context, Effect, Option, Schema } from "effect";
import { afterEach, vi } from "vitest";
import { AUTH_BASE_PATH } from "../auth/auth-policy.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import {
  allowConsent,
  authorize,
  exchangeTokens,
  MEMBER_MCP_TEST,
  type MemberMcpTestAuth,
  memberMcpStanding,
  RESOURCE,
  register,
  registration,
  signUp,
} from "../testing/member-mcp-auth.js";
import { type ClientConsentDelete, clientConsentDelete } from "./client-consents.js";
import { mcpClientsProcedures } from "./clients-procedures.js";
import { MEMBER_MCP_SCOPE } from "./resource.js";

/**
 * The outside MCP clients a member allowed, end to end over the auth
 * service as `auth.ts` configures what a client reaches, on the test's own
 * PGlite the resource reads too (`../testing/member-mcp-auth.ts`). A client
 * registers dynamically and a member signs it in through consent; the
 * resource lists it to that member alone on their bearer, and revokes it
 * under their browser's session through the provider's own consent
 * endpoints, after which its refresh is refused and its next sign-in asks
 * again, while another member's grant of the same client stands. A revoke
 * whose consent delete fails answers a failure and leaves the client
 * listed, so the member is offered it again. Synthetic accounts.
 */

const MCP_SCOPES = [MEMBER_MCP_SCOPE.MCP, MEMBER_MCP_SCOPE.OFFLINE_ACCESS] as const;

const decodeRegistered = Schema.decodeUnknownSync(Schema.Struct({ client_id: Schema.String }));
const decodeRefusal = Schema.decodeUnknownSync(Schema.Struct({ error: Schema.String }));
const decodeListed = Schema.decodeUnknownSync(
  Schema.Struct({
    serverUrl: Schema.String,
    clients: Schema.Array(
      Schema.Struct({
        clientId: Schema.String,
        name: Schema.NullOr(Schema.String),
        redirectUris: Schema.Array(Schema.String),
      }),
    ),
  }),
);

afterEach(() => {
  vi.restoreAllMocks();
});

/** A consent delete that the provider refuses, as one whose session lapsed between the two writes would be. */
const lapsedSession: ClientConsentDelete = () =>
  Effect.fail(new OrganizationRefused({ status: HOSTED_HTTP_STATUS.UNAUTHORIZED }));

/** The resource over the standing's database and auth service: a member's bearer names them, and their cookie is their session. */
function resource(
  auth: MemberMcpTestAuth,
  services: Context.Context<DatabaseServices>,
  deleteClientConsent: ClientConsentDelete = clientConsentDelete(auth.api),
) {
  const handle = hostedFetch({
    mcpClients: mcpClientsProcedures({
      resolveUserId: (incoming) =>
        Effect.succeed(
          Option.fromNullishOr(incoming.headers.get("authorization")?.replace(/^Bearer /u, "")),
        ),
      resolveSessionUserId: (incoming) =>
        Effect.tryPromise(async () => {
          const session = await auth.api.getSession({ headers: incoming.headers });
          return Option.fromNullishOr(session?.user.id);
        }),
      deleteClientConsent,
      memberMcpServerUrl: RESOURCE,
    }),
  });
  // SAFETY: the resource yields the database alone, which is all a test provides of the web runtime's services.
  const webServices = services as Context.Context<WebServices>;
  const ask = (path: string, init: RequestInit) =>
    Effect.promise(async () => {
      const response = await handle(
        new Request(`${MEMBER_MCP_TEST.ORIGIN}${path}`, init),
        webServices,
      );
      // SAFETY: the route answers JSON; the test reads it as the wire value it is.
      const body = (await response.json()) as WireBoundaryInput;
      return { status: response.status, body };
    });
  return {
    list: (userId: string) =>
      ask(HOSTED_SERVICE_PATH.ACCOUNT_MCP_CLIENTS, {
        headers: { authorization: `Bearer ${userId}` },
      }),
    revoke: (cookie: string, clientId: string) =>
      ask(`${HOSTED_SERVICE_PATH.ACCOUNT_MCP_CLIENTS}?${new URLSearchParams({ clientId })}`, {
        method: "DELETE",
        headers: { cookie },
      }),
  };
}

/** A client registered dynamically, as Claude Code and its kind register. */
const registered = (auth: MemberMcpTestAuth) =>
  Effect.promise(async () => {
    const answer = await register(auth, registration(MCP_SCOPES));
    return decodeRegistered(await answer.json()).client_id;
  });

/** A member's sign-in of the client through consent; answers its refresh token. */
const signedIn = (auth: MemberMcpTestAuth, cookie: string, clientId: string) =>
  Effect.promise(async () => {
    const grant = { clientId, scope: MCP_SCOPES, resource: RESOURCE };
    const asked = await authorize(auth, cookie, grant);
    assert.equal(asked.pathname, MEMBER_MCP_TEST.CONSENT_PAGE, asked.href);
    const landed = await allowConsent(auth, cookie, asked);
    const { refresh_token } = await exchangeTokens(auth, grant, landed);
    assert.ok(refresh_token !== undefined, "the client asked offline_access");
    return refresh_token;
  });

/** The client's refresh as it sends one: its status, and the error where it was refused. */
const refreshed = (auth: MemberMcpTestAuth, clientId: string, refreshToken: string) =>
  Effect.promise(async () => {
    const answer = await auth.handler(
      new Request(`${MEMBER_MCP_TEST.ORIGIN}${AUTH_BASE_PATH}/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: clientId,
          resource: RESOURCE,
        }),
      }),
    );
    const body: unknown = await answer.json();
    return answer.ok ? "refreshed" : decodeRefusal(body).error;
  });

/** The client ids a member's list names. */
const listedIds = (answer: { readonly body: WireBoundaryInput }) =>
  decodeListed(answer.body).clients.map((client) => client.clientId);

it.effect("a client a member signed in through consent is listed to them alone", () =>
  Effect.gen(function* () {
    const { auth, services } = yield* memberMcpStanding();
    const owner = yield* Effect.promise(() => signUp(auth));
    const other = yield* Effect.promise(() => signUp(auth));
    const clientId = yield* registered(auth);
    yield* signedIn(auth, owner.cookie, clientId);
    const clients = resource(
      auth,
      yield* Effect.context<DatabaseServices>().pipe(Effect.provide(services)),
    );

    const listed = yield* clients.list(owner.userId);
    assert.equal(listed.status, HOSTED_HTTP_STATUS.OK);
    assert.deepEqual(decodeListed(listed.body), {
      serverUrl: RESOURCE,
      clients: [
        {
          clientId,
          name: "A client registered dynamically",
          redirectUris: [MEMBER_MCP_TEST.LOOPBACK],
        },
      ],
    });
    assert.deepEqual(listedIds(yield* clients.list(other.userId)), []);
  }),
);

it.effect(
  "a revoke is the member's own: their client's refresh is refused and its sign-in asks again, while another member's grant of it stands",
  () =>
    Effect.gen(function* () {
      const { auth, services } = yield* memberMcpStanding();
      const owner = yield* Effect.promise(() => signUp(auth));
      const other = yield* Effect.promise(() => signUp(auth));
      const clientId = yield* registered(auth);
      const ownerRefresh = yield* signedIn(auth, owner.cookie, clientId);
      const otherRefresh = yield* signedIn(auth, other.cookie, clientId);
      const clients = resource(
        auth,
        yield* Effect.context<DatabaseServices>().pipe(Effect.provide(services)),
      );

      const revoked = yield* clients.revoke(other.cookie, clientId);
      assert.equal(revoked.status, HOSTED_HTTP_STATUS.OK);
      assert.deepEqual(listedIds(revoked), []);
      assert.equal(yield* refreshed(auth, clientId, otherRefresh), "invalid_grant");
      const asked = yield* Effect.promise(() =>
        authorize(auth, other.cookie, { clientId, scope: MCP_SCOPES, resource: RESOURCE }),
      );
      assert.equal(asked.pathname, MEMBER_MCP_TEST.CONSENT_PAGE, asked.href);

      assert.deepEqual(listedIds(yield* clients.list(owner.userId)), [clientId]);
      assert.equal(yield* refreshed(auth, clientId, ownerRefresh), "refreshed");
    }),
);

it.effect(
  "a revoke whose consent delete fails answers a failure and leaves the client listed, and asked again it lands",
  () =>
    Effect.gen(function* () {
      const { auth, services } = yield* memberMcpStanding();
      const owner = yield* Effect.promise(() => signUp(auth));
      const clientId = yield* registered(auth);
      const refreshToken = yield* signedIn(auth, owner.cookie, clientId);
      const database = yield* Effect.context<DatabaseServices>().pipe(Effect.provide(services));

      const halfDone = yield* resource(auth, database, lapsedSession).revoke(
        owner.cookie,
        clientId,
      );
      assert.equal(halfDone.status, HOSTED_HTTP_STATUS.UNAUTHORIZED);
      assert.equal(yield* refreshed(auth, clientId, refreshToken), "invalid_grant");
      const clients = resource(auth, database);
      assert.deepEqual(listedIds(yield* clients.list(owner.userId)), [clientId]);

      const again = yield* clients.revoke(owner.cookie, clientId);
      assert.equal(again.status, HOSTED_HTTP_STATUS.OK);
      assert.deepEqual(listedIds(again), []);
    }),
);
