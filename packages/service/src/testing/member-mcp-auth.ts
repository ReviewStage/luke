/**
 * member-mcp-auth.ts -- the member MCP server and the auth service it admits tokens of, stood up over a test's own PGlite, with a client's sign-in driven step by step.
 *
 * Better Auth is configured as `auth.ts` configures what the server and an
 * outside client reach: the key set, the provider with the resource, open
 * registration under the member MCP server's scopes, metadata-document
 * discovery over the fetch the test hands in, and the limiter on its
 * database storage; email sign-up stands in for the social providers. The
 * rows a deployment's seeder writes are seeded, and a test client linked to
 * the resource beside them. The key set the admission verifies against is
 * fetched from the auth service over HTTP, as on a deployment: here the
 * in-process handler, and nothing else answers. GitHub is the layer a test
 * hands in, by default one nobody reaches; an agent's harness is a recording
 * one that takes every message (`heard`), and the model catalog offers
 * nothing. Synthetic accounts.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cimd } from "@better-auth/cimd";
import { type ClientMetadataResourceFetch, oauthProvider } from "@better-auth/oauth-provider";
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Database } from "@repo/database/core/query";
import { oauthClient, oauthClientResource, oauthResource } from "@repo/database/schemas/auth";
import { openMigratedPglite, sqlClientOverPglite } from "@repo/database/testing";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/pglite";
import { Clock, Effect, Layer, Schema } from "effect";
import { HttpRouter } from "effect/http";
import type * as HttpClient from "effect/http/HttpClient";
import { vi } from "vitest";
import { authDatabaseAdapter } from "../auth/auth-database.js";
import {
  AUTH_BASE_PATH,
  AUTH_RATE_LIMIT,
  DISABLED_AUTH_PATHS,
  denyOAuthClientPrivileges,
  denyOAuthResourcePrivileges,
  JWT_KEY_STORAGE,
  LOGIN_PAGE,
  memberMcpClientDiscovery,
  OAUTH_PROVIDER_SCOPES,
  oauthClientRegistration,
} from "../auth/auth-policy.js";
import {
  DESKTOP_OAUTH_CLIENT,
  type OAuthClient,
  oauthClientRecord,
} from "../auth/oauth-clients.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import type { GitHubApp } from "../github/github-app.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { memberMcpApp, memberMcpAuth } from "../member-mcp/app.js";
import {
  MEMBER_MCP_PATH,
  MEMBER_MCP_SCOPE,
  memberMcpResourceUrl,
  oauthResourceRecord,
} from "../member-mcp/resource.js";
import { modelCatalogOf } from "../providers/model-catalog.js";
import { NO_GITHUB } from "./github-app-fake.js";
import { recordingHarness } from "./native-harness-fake.js";

/** The deployment the test stands at: its origin, the resource and the auth service under it. */
export const MEMBER_MCP_TEST = {
  ORIGIN: "https://app.test",
  /** The page the provider sends a consent to, as `auth.ts` names it. */
  CONSENT_PAGE: "/consent",
  /** The loopback redirect every client under test registers. */
  LOOPBACK: "http://127.0.0.1/callback",
} as const;

export const RESOURCE = memberMcpResourceUrl(MEMBER_MCP_TEST.ORIGIN);

/** Another resource the auth service mints tokens for, whose tokens name the server no more than the desktop's do. */
export const OTHER_RESOURCE = `${MEMBER_MCP_TEST.ORIGIN}/api/other`;

const SECRET = "member-mcp-test-secret-with-enough-length";

/** RFC 7636's example pair, standing in for a verifier the client drew. */
const PKCE = {
  verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
} as const;

/** An outside MCP client as a deployment held one before the doors opened: seeded public, PKCE, consent skipped, linked to both resources. */
export const MCP_CLIENT: OAuthClient = {
  id: "mcp-test",
  name: "An MCP client under test",
  scopes: [MEMBER_MCP_SCOPE.MCP, MEMBER_MCP_SCOPE.OFFLINE_ACCESS],
  redirectUris: [MEMBER_MCP_TEST.LOOPBACK],
  tokenEndpointAuthMethod: "none",
  grantTypes: ["authorization_code", "refresh_token"],
  responseTypes: ["code"],
  type: "web",
};

/** The deployment's environment with no key of its own, which no call here reads. */
const NO_ENVIRONMENT: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
};

/** The protocol revisions the server serves, as the SDK's client is told to speak each. */
export const REVISION = { MODERN: "2026-07-28", LEGACY: "2025-11-25" } as const;

const decodeTokens = Schema.decodeUnknownSync(Schema.Struct({ access_token: Schema.String }));
const decodeConsentAnswer = Schema.decodeUnknownSync(
  Schema.Struct({ redirect: Schema.Boolean, url: Schema.String }),
);

/** A transport no metadata document is fetched through: the test that discovers no client. */
const noMetadataDocument: ClientMetadataResourceFetch = (input) =>
  Promise.reject(new Error(`this test fetches no metadata document: ${String(input)}`));

/** Better Auth as `auth.ts` configures what the server and a client reach, its metadata documents fetched through the transport given. */
export function memberMcpTestAuth(
  client: Awaited<ReturnType<typeof openMigratedPglite>>,
  fetchClientMetadataResource: ClientMetadataResourceFetch = noMetadataDocument,
) {
  return betterAuth({
    baseURL: MEMBER_MCP_TEST.ORIGIN,
    basePath: AUTH_BASE_PATH,
    secret: SECRET,
    database: authDatabaseAdapter(drizzle({ client })),
    emailAndPassword: { enabled: true },
    rateLimit: AUTH_RATE_LIMIT,
    disabledPaths: [...DISABLED_AUTH_PATHS],
    plugins: [
      jwt(JWT_KEY_STORAGE),
      oauthProvider({
        loginPage: LOGIN_PAGE,
        consentPage: MEMBER_MCP_TEST.CONSENT_PAGE,
        ...oauthClientRegistration(),
        clientPrivileges: denyOAuthClientPrivileges,
        scopes: [...OAUTH_PROVIDER_SCOPES],
        resourcePrivileges: denyOAuthResourcePrivileges,
      }),
      cimd(memberMcpClientDiscovery(fetchClientMetadataResource)),
    ],
  });
}

export type MemberMcpTestAuth = ReturnType<typeof memberMcpTestAuth>;

/** The rows a deployment's seeder writes, the desktop's client and the server's resource, a second resource beside it, and the MCP client linked to both resources. */
const seedRows = Effect.gen(function* () {
  const db = yield* Database;
  const now = new Date();
  const resource = oauthResourceRecord(MEMBER_MCP_TEST.ORIGIN, now);
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

/** What a test stands the server up over: the transport its metadata documents are fetched through, and the GitHub its tools reach. */
export interface MemberMcpStandingOptions {
  readonly fetchClientMetadataResource?: ClientMetadataResourceFetch;
  readonly github?: Layer.Layer<GitHubApp | HttpClient.HttpClient>;
}

/**
 * The server's group over a migrated PGlite, the auth service, the clock,
 * and the GitHub given, as a fetch a client is handed, with the rows seeded
 * and the key set reachable. The `fetch` spy it installs is restored by the
 * test's `afterEach`.
 */
export function memberMcpStanding(options: MemberMcpStandingOptions = {}) {
  return Effect.gen(function* () {
    const client = yield* Effect.acquireRelease(Effect.promise(openMigratedPglite), (opened) =>
      Effect.promise(() => opened.close()),
    );
    const auth = memberMcpTestAuth(client, options.fetchClientMetadataResource);
    const harness = recordingHarness();
    const services = Layer.mergeAll(
      Layer.succeedContext(yield* Layer.build(sqlClientOverPglite(client))),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      options.github ?? NO_GITHUB,
      modelCatalogOf([]),
      Layer.succeed(HostedEnvironment, NO_ENVIRONMENT),
      harness.layer,
    );
    yield* seedRows.pipe(Effect.provide(services));
    // The key set is fetched from the auth service over HTTP, as on a deployment: here the in-process handler, and nothing else answers.
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const request = new Request(input, init);
      if (!request.url.startsWith(`${MEMBER_MCP_TEST.ORIGIN}${AUTH_BASE_PATH}/`)) {
        return Promise.reject(new Error(`this test reaches no network: ${request.url}`));
      }
      return auth.handler(request);
    });
    const resourceClient = oauthProviderResourceClient(auth).getActions();
    const web = HttpRouter.toWebHandler(
      memberMcpApp(memberMcpAuth(resourceClient, MEMBER_MCP_TEST.ORIGIN)).pipe(
        HttpRouter.provideRequest(services),
      ),
      { disableLogger: true },
    );
    yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
    const fetch = (input: string | URL | Request, init?: RequestInit) =>
      web.handler(new Request(input, init));
    return { auth, fetch, services, heard: harness.heard };
  });
}

/** A signed-up account, and the cookie its browser carries. */
export async function signUp(auth: MemberMcpTestAuth): Promise<{ userId: string; cookie: string }> {
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

/** What a token is minted for: its client, the scopes asked, and the resource it names, or none for the desktop's opaque one. */
export interface Grant {
  readonly clientId: string;
  readonly scope: readonly string[];
  readonly resource?: string;
}

/** The auth service's answer to the signed-in browser's authorization for the grant. */
export async function authorizeAnswer(
  auth: MemberMcpTestAuth,
  cookie: string,
  grant: Grant,
): Promise<Response> {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: grant.clientId,
    redirect_uri: MEMBER_MCP_TEST.LOOPBACK,
    scope: grant.scope.join(" "),
    state: "oauth-state",
    code_challenge: PKCE.challenge,
    code_challenge_method: "S256",
    ...(grant.resource === undefined ? undefined : { resource: grant.resource }),
  });
  return auth.handler(
    new Request(`${MEMBER_MCP_TEST.ORIGIN}${AUTH_BASE_PATH}/oauth2/authorize?${query}`, {
      headers: { accept: "text/html", "sec-fetch-mode": "navigate", cookie },
    }),
  );
}

/** Where the signed-in browser's authorization lands: the client's redirect with a code, or the consent page. */
export async function authorize(
  auth: MemberMcpTestAuth,
  cookie: string,
  grant: Grant,
): Promise<URL> {
  const authorized = await authorizeAnswer(auth, cookie, grant);
  const location = authorized.headers.get("location");
  assert.ok(location !== null, `${authorized.status}: ${await authorized.clone().text()}`);
  return new URL(location, MEMBER_MCP_TEST.ORIGIN);
}

/** The member's Allow on the consent page the authorization landed on, as the page sends it: where the client's answer then goes. */
export async function allowConsent(
  auth: MemberMcpTestAuth,
  cookie: string,
  consentPage: URL,
): Promise<URL> {
  const answered = await auth.handler(
    new Request(`${MEMBER_MCP_TEST.ORIGIN}${AUTH_BASE_PATH}/oauth2/consent`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ accept: true, oauth_query: consentPage.search.slice(1) }),
    }),
  );
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK, await answered.clone().text());
  return new URL(decodeConsentAnswer(await answered.json()).url);
}

/** The client's exchange of the code it landed with, under its verifier, for the access token. */
export async function exchangeCode(
  auth: MemberMcpTestAuth,
  grant: Grant,
  landed: URL,
): Promise<string> {
  assert.equal(`${landed.origin}${landed.pathname}`, MEMBER_MCP_TEST.LOOPBACK, landed.href);
  assert.ok(landed.searchParams.has("code"), `${grant.clientId} ${grant.scope}: ${landed.search}`);
  const exchanged = await auth.handler(
    new Request(`${MEMBER_MCP_TEST.ORIGIN}${AUTH_BASE_PATH}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: landed.searchParams.get("code") ?? "",
        redirect_uri: MEMBER_MCP_TEST.LOOPBACK,
        client_id: grant.clientId,
        code_verifier: PKCE.verifier,
        ...(grant.resource === undefined ? undefined : { resource: grant.resource }),
      }),
    }),
  );
  assert.equal(exchanged.status, HOSTED_HTTP_STATUS.OK, await exchanged.clone().text());
  return decodeTokens(await exchanged.json()).access_token;
}

/** An access token minted by the auth service as a trusted client's sign-in mints one: the signed-in browser authorizes the client straight to its redirect, which exchanges the code. */
export async function mintedToken(
  auth: MemberMcpTestAuth,
  cookie: string,
  grant: Grant,
): Promise<string> {
  return exchangeCode(auth, grant, await authorize(auth, cookie, grant));
}

/** One JSON-RPC POST to the server as a client sends it, under the bearer given or none. */
export function post(fetch: typeof globalThis.fetch, bearer: string | undefined, origin?: string) {
  return Effect.promise(async () => {
    const headers = new Headers({
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    });
    if (bearer !== undefined) headers.set("authorization", `Bearer ${bearer}`);
    if (origin !== undefined) headers.set("origin", origin);
    const response = await fetch(`${MEMBER_MCP_TEST.ORIGIN}${MEMBER_MCP_PATH}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    return { status: response.status, challenge: response.headers.get("www-authenticate") };
  });
}

/** An SDK client connected under the bearer, speaking the revision given: its `initialize` is the server's admission of the token. */
export function connected(fetch: typeof globalThis.fetch, bearer: string, revision: string) {
  return Effect.promise(async () => {
    const client = new Client(
      { name: "member-test", version: "1.0.0" },
      {
        versionNegotiation: {
          mode: revision === REVISION.MODERN ? { pin: revision } : "legacy",
        },
      },
    );
    const transport = new StreamableHTTPClientTransport(
      new URL(`${MEMBER_MCP_TEST.ORIGIN}${MEMBER_MCP_PATH}`),
      { fetch, requestInit: { headers: { authorization: `Bearer ${bearer}` } } },
    );
    await client.connect(transport);
    return { client, transport };
  });
}
