import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { oauthProvider } from "@better-auth/oauth-provider";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { it } from "@effect/vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Database } from "@repo/database/core/query";
import { oauthClient, oauthClientResource, oauthResource } from "@repo/database/schemas/auth";
import { openMigratedPglite, openWorkspace, sqlClientOverPglite } from "@repo/database/testing";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { settleJsonSchemaGolden } from "@repo/wire/testing";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/pglite";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter } from "effect/http";
import { afterEach, vi } from "vitest";
import { authDatabaseAdapter } from "../auth/auth-database.js";
import {
  AUTH_BASE_PATH,
  DISABLED_AUTH_PATHS,
  denyOAuthClientPrivileges,
  denyOAuthResourcePrivileges,
  JWT_KEY_STORAGE,
  OAUTH_PROVIDER_SCOPES,
} from "../auth/auth-policy.js";
import {
  DESKTOP_OAUTH_CLIENT,
  type OAuthClient,
  oauthClientRecord,
} from "../auth/oauth-clients.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { MEMBER_MCP_METADATA_ROUTE, memberMcpApp, memberMcpAuth, memberMcpIssuer } from "./app.js";
import {
  MEMBER_MCP_PATH,
  MEMBER_MCP_SCOPE,
  memberMcpResourceUrl,
  oauthResourceRecord,
} from "./resource.js";
import { LIST_WORKSPACES_TOOL } from "./tools.js";

/**
 * The member MCP server, answered by its group the way a function answers
 * it, over a Better Auth configured as `auth.ts` configures its provider and
 * key set, over a migrated PGlite the tools read too. The tokens are the
 * provider's own, minted through a seeded test client linked to the
 * resource: a signed-up account authorizes it, as a client's sign-in will,
 * and the client exchanges its code. The key set the admission verifies
 * against is fetched from the auth service, as on a deployment, through a
 * `fetch` that reaches the in-process handler alone. The SDK's own client
 * drives the server at both revisions it serves. Synthetic accounts.
 */

const ORIGIN = "https://app.test";
const RESOURCE = memberMcpResourceUrl(ORIGIN);
/** Another resource the auth service mints tokens for, whose tokens name the server no more than the desktop's do. */
const OTHER_RESOURCE = `${ORIGIN}/api/other`;
const SECRET = "member-mcp-test-secret-with-enough-length";
const LOOPBACK = "http://127.0.0.1/callback";

/** RFC 7636's example pair, standing in for a verifier the client drew. */
const PKCE = {
  verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
} as const;

/** An outside MCP client as the switch-on child will register one: public, PKCE, linked to the resource. */
const MCP_CLIENT: OAuthClient = {
  id: "mcp-test",
  name: "An MCP client under test",
  scopes: [MEMBER_MCP_SCOPE.MCP, MEMBER_MCP_SCOPE.OFFLINE_ACCESS],
  redirectUris: [LOOPBACK],
  tokenEndpointAuthMethod: "none",
  grantTypes: ["authorization_code", "refresh_token"],
  responseTypes: ["code"],
  type: "web",
};

/** The protocol revisions the server serves, as the SDK's client is told to speak each. */
const REVISION = { MODERN: "2026-07-28", LEGACY: "2025-11-25" } as const;

const decodeTokens = Schema.decodeUnknownSync(Schema.Struct({ access_token: Schema.String }));
const decodeMetadata = Schema.decodeUnknownSync(
  Schema.Struct({
    resource: Schema.String,
    authorization_servers: Schema.Array(Schema.String),
    scopes_supported: Schema.Array(Schema.String),
    bearer_methods_supported: Schema.Array(Schema.String),
  }),
);
const decodeListed = Schema.decodeUnknownSync(
  Schema.Struct({
    workspaces: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        slug: Schema.String,
        name: Schema.String,
        role: Schema.String,
      }),
    ),
  }),
);

/** The JSON Schema goldens of this package, where a tool's input a model is shown is recorded. */
const GOLDEN_ROOT = path.join(fileURLToPath(import.meta.url), "../../../fixtures/json-schema");

afterEach(() => {
  vi.restoreAllMocks();
});

/** Better Auth as `auth.ts` configures what the server reaches: the key set, the provider with the resource, and a second resource beside it; email sign-up stands in for the social providers. */
function testAuth(client: Awaited<ReturnType<typeof openMigratedPglite>>) {
  return betterAuth({
    baseURL: ORIGIN,
    basePath: AUTH_BASE_PATH,
    secret: SECRET,
    database: authDatabaseAdapter(drizzle({ client })),
    emailAndPassword: { enabled: true },
    disabledPaths: [...DISABLED_AUTH_PATHS],
    plugins: [
      jwt(JWT_KEY_STORAGE),
      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/consent",
        allowDynamicClientRegistration: false,
        clientPrivileges: denyOAuthClientPrivileges,
        scopes: [...OAUTH_PROVIDER_SCOPES],
        resourcePrivileges: denyOAuthResourcePrivileges,
      }),
    ],
  });
}

type TestAuth = ReturnType<typeof testAuth>;

/** The server's group over the test's database and auth service, as a fetch a client is handed, with the clients seeded and the key set reachable. */
const standing = Effect.gen(function* () {
  const client = yield* Effect.acquireRelease(Effect.promise(openMigratedPglite), (opened) =>
    Effect.promise(() => opened.close()),
  );
  const auth = testAuth(client);
  const services = Layer.succeedContext(yield* Layer.build(sqlClientOverPglite(client)));
  yield* seedRows.pipe(Effect.provide(services));
  // The key set is fetched from the auth service over HTTP, as on a deployment: here the in-process handler, and nothing else answers.
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const request = new Request(input, init);
    if (!request.url.startsWith(`${ORIGIN}${AUTH_BASE_PATH}/`)) {
      return Promise.reject(new Error(`this test reaches no network: ${request.url}`));
    }
    return auth.handler(request);
  });
  const resourceClient = oauthProviderResourceClient(auth).getActions();
  const web = HttpRouter.toWebHandler(
    memberMcpApp(memberMcpAuth(resourceClient, ORIGIN)).pipe(HttpRouter.provideRequest(services)),
    { disableLogger: true },
  );
  yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
  const fetch = (input: string | URL | Request, init?: RequestInit) =>
    web.handler(new Request(input, init));
  return { auth, fetch, services };
});

/** The rows a deployment's seeder writes, the desktop's client and the server's resource, a second resource beside it, and the MCP client linked to both resources. */
const seedRows = Effect.gen(function* () {
  const db = yield* Database;
  const now = new Date();
  const resource = oauthResourceRecord(ORIGIN, now);
  yield* db.insert(oauthResource).values([
    { ...resource, allowedScopes: [...resource.allowedScopes] },
    {
      ...resource,
      id: OTHER_RESOURCE,
      identifier: OTHER_RESOURCE,
      name: "Another resource",
      allowedScopes: [MEMBER_MCP_SCOPE.MCP],
    },
  ]);
  yield* db.insert(oauthClient).values(
    [DESKTOP_OAUTH_CLIENT, MCP_CLIENT].map((client) => ({
      ...oauthClientRecord(client, now),
      scopes: [...client.scopes],
      redirectUris: [...client.redirectUris],
      grantTypes: [...client.grantTypes],
      responseTypes: [...client.responseTypes],
    })),
  );
  yield* db.insert(oauthClientResource).values(
    [RESOURCE, OTHER_RESOURCE].map((resourceId) => ({
      id: randomUUID(),
      clientId: MCP_CLIENT.id,
      resourceId,
      createdAt: now,
    })),
  );
});

/** A signed-up account, and the cookie its browser carries. */
async function signUp(auth: TestAuth): Promise<{ userId: string; cookie: string }> {
  const name = `member-${randomUUID()}`;
  const { headers, response } = await auth.api.signUpEmail({
    body: { name, email: `${name}@app.test`, password: "a-password-long-enough" },
    returnHeaders: true,
  });
  const cookie = headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");
  return { userId: response.user.id, cookie };
}

/** What a token is minted for: its client, its scopes, and the resource it names, or none for the desktop's opaque one. */
interface Grant {
  readonly client: OAuthClient;
  readonly scope: readonly string[];
  readonly resource?: string;
}

/** An access token minted by the auth service as a client's sign-in mints one: the signed-in browser authorizes the client, which exchanges the code with its verifier. */
async function mintedToken(auth: TestAuth, cookie: string, grant: Grant): Promise<string> {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: grant.client.id,
    redirect_uri: LOOPBACK,
    scope: grant.scope.join(" "),
    state: "oauth-state",
    code_challenge: PKCE.challenge,
    code_challenge_method: "S256",
    ...(grant.resource === undefined ? undefined : { resource: grant.resource }),
  });
  const authorized = await auth.handler(
    new Request(`${ORIGIN}${AUTH_BASE_PATH}/oauth2/authorize?${query}`, {
      headers: { accept: "text/html", "sec-fetch-mode": "navigate", cookie },
    }),
  );
  const landed = new URL(authorized.headers.get("location") ?? "", ORIGIN);
  assert.equal(`${landed.origin}${landed.pathname}`, LOOPBACK, await authorized.text());
  assert.ok(landed.searchParams.has("code"), `${grant.client.id} ${grant.scope}: ${landed.search}`);
  const exchanged = await auth.handler(
    new Request(`${ORIGIN}${AUTH_BASE_PATH}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: landed.searchParams.get("code") ?? "",
        redirect_uri: LOOPBACK,
        client_id: grant.client.id,
        code_verifier: PKCE.verifier,
        ...(grant.resource === undefined ? undefined : { resource: grant.resource }),
      }),
    }),
  );
  assert.equal(exchanged.status, HOSTED_HTTP_STATUS.OK, await exchanged.clone().text());
  return decodeTokens(await exchanged.json()).access_token;
}

/** One JSON-RPC POST to the server as a client sends it, under the bearer given or none. */
function post(fetch: typeof globalThis.fetch, bearer: string | undefined, origin?: string) {
  return Effect.promise(async () => {
    const headers = new Headers({
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    });
    if (bearer !== undefined) headers.set("authorization", `Bearer ${bearer}`);
    if (origin !== undefined) headers.set("origin", origin);
    const response = await fetch(`${ORIGIN}${MEMBER_MCP_PATH}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    return { status: response.status, challenge: response.headers.get("www-authenticate") };
  });
}

/** An SDK client connected under the bearer, speaking the revision given. */
function connected(fetch: typeof globalThis.fetch, bearer: string, revision: string) {
  return Effect.promise(async () => {
    const client = new Client(
      { name: "member-test", version: "1.0.0" },
      {
        versionNegotiation: {
          mode: revision === REVISION.MODERN ? { pin: revision } : "legacy",
        },
      },
    );
    const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}${MEMBER_MCP_PATH}`), {
      fetch,
      requestInit: { headers: { authorization: `Bearer ${bearer}` } },
    });
    await client.connect(transport);
    return { client, transport };
  });
}

/** The metadata document's address a challenge must name for the resource (RFC 9728). */
const METADATA_URL = `${ORIGIN}/.well-known/oauth-protected-resource${MEMBER_MCP_PATH}`;

it.effect(
  "no token, the desktop's opaque token, and a token for another resource are each refused with the challenge naming the metadata; a token without the scope is refused for its scope; a browser's origin is refused",
  () =>
    Effect.gen(function* () {
      const { auth, fetch } = yield* standing;
      const { cookie } = yield* Effect.promise(() => signUp(auth));
      const desktop = yield* Effect.promise(() =>
        mintedToken(auth, cookie, {
          client: DESKTOP_OAUTH_CLIENT,
          scope: DESKTOP_OAUTH_CLIENT.scopes,
        }),
      );
      const elsewhere = yield* Effect.promise(() =>
        mintedToken(auth, cookie, {
          client: MCP_CLIENT,
          scope: [MEMBER_MCP_SCOPE.MCP],
          resource: OTHER_RESOURCE,
        }),
      );
      const unscoped = yield* Effect.promise(() =>
        mintedToken(auth, cookie, {
          client: MCP_CLIENT,
          scope: [MEMBER_MCP_SCOPE.OFFLINE_ACCESS],
          resource: RESOURCE,
        }),
      );

      for (const bearer of [undefined, desktop, elsewhere]) {
        const refused = yield* post(fetch, bearer);
        assert.equal(refused.status, HOSTED_HTTP_STATUS.UNAUTHORIZED);
        assert.equal(refused.challenge, `Bearer resource_metadata="${METADATA_URL}"`);
      }
      const forbidden = yield* post(fetch, unscoped);
      assert.equal(forbidden.status, HOSTED_HTTP_STATUS.FORBIDDEN);
      assert.match(
        forbidden.challenge ?? "",
        /^Bearer error="insufficient_scope", scope="vespin:mcp"/u,
      );
      const page = yield* post(fetch, undefined, "https://page.test");
      assert.equal(page.status, HOSTED_HTTP_STATUS.FORBIDDEN);
    }),
);

it.effect.each(Object.values(REVISION))(
  "an SDK client at %s lists list_workspaces as the golden shows it and runs it as the member",
  (revision) =>
    Effect.gen(function* () {
      const { auth, fetch, services } = yield* standing;
      const { userId, cookie } = yield* Effect.promise(() => signUp(auth));
      const workspaceId = yield* openWorkspace(userId).pipe(Effect.provide(services));
      const token = yield* Effect.promise(() =>
        mintedToken(auth, cookie, {
          client: MCP_CLIENT,
          scope: [MEMBER_MCP_SCOPE.MCP, MEMBER_MCP_SCOPE.OFFLINE_ACCESS],
          resource: RESOURCE,
        }),
      );
      const { client, transport } = yield* connected(fetch, token, revision);

      const listed = yield* Effect.promise(() => client.listTools());
      const called = yield* Effect.promise(() =>
        client.callTool({ name: LIST_WORKSPACES_TOOL.name, arguments: {} }),
      );
      yield* Effect.promise(() => client.close());

      assert.equal(transport.protocolVersion, revision);
      const golden = JSON.parse(
        yield* Effect.promise(() =>
          fs.readFile(path.join(GOLDEN_ROOT, "list-workspaces-input.json"), "utf8"),
        ),
      );
      assert.deepEqual(
        listed.tools.map(({ name, inputSchema }) => ({ name, inputSchema })),
        [{ name: LIST_WORKSPACES_TOOL.name, inputSchema: golden }],
      );
      assert.notEqual(called.isError, true, JSON.stringify(called));
      const [content] = called.content;
      assert.ok(content?.type === "text");
      assert.deepEqual(decodeListed(JSON.parse(content.text)), {
        workspaces: [
          {
            id: workspaceId,
            slug: `workspace-${workspaceId}`,
            name: "Test Workspace",
            role: WORKSPACE_ROLE.OWNER,
          },
        ],
      });
    }),
);

it.effect("the metadata names the resource, the auth service, the scopes, and the header", () =>
  Effect.gen(function* () {
    const { fetch } = yield* standing;
    const answered = yield* Effect.promise(() => fetch(`${ORIGIN}${MEMBER_MCP_METADATA_ROUTE}`));
    assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
    const metadata = decodeMetadata(yield* Effect.promise(() => answered.json()));
    assert.equal(metadata.resource, RESOURCE);
    assert.deepEqual(metadata.authorization_servers, [memberMcpIssuer(ORIGIN)]);
    assert.deepEqual(metadata.scopes_supported, Object.values(MEMBER_MCP_SCOPE));
    assert.deepEqual(metadata.bearer_methods_supported, ["header"]);
  }),
);

it("list_workspaces shows the model the recorded input", async () => {
  await settleJsonSchemaGolden(GOLDEN_ROOT, "list-workspaces-input", LIST_WORKSPACES_TOOL.input);
});
