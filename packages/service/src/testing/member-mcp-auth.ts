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
import { SentryApp, sentryAppService } from "../triggers/sentry/sentry-app-config.js";
import { NO_GITHUB } from "./github-app-fake.js";
import { recordingHarness } from "./native-harness-fake.js";

export const MEMBER_MCP_TEST = {
  ORIGIN: "https://app.test",
  CONSENT_PAGE: "/consent",
  LOOPBACK: "http://127.0.0.1/callback",
} as const;

export const RESOURCE = memberMcpResourceUrl(MEMBER_MCP_TEST.ORIGIN);

export const OTHER_RESOURCE = `${MEMBER_MCP_TEST.ORIGIN}/api/other`;

const SECRET = "member-mcp-test-secret-with-enough-length";

const PKCE = {
  verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
} as const;

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

const NO_ENVIRONMENT: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
  titleAnthropicApiKey: undefined,
};

export const REVISION = { MODERN: "2026-07-28", LEGACY: "2025-11-25" } as const;

const decodeTokens = Schema.decodeUnknownSync(
  Schema.Struct({ access_token: Schema.String, refresh_token: Schema.optionalKey(Schema.String) }),
);
const decodeConsentAnswer = Schema.decodeUnknownSync(
  Schema.Struct({ redirect: Schema.Boolean, url: Schema.String }),
);

const noMetadataDocument: ClientMetadataResourceFetch = (input) =>
  Promise.reject(new Error(`this test fetches no metadata document: ${String(input)}`));

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

export interface MemberMcpStandingOptions {
  readonly fetchClientMetadataResource?: ClientMetadataResourceFetch;
  readonly github?: Layer.Layer<GitHubApp | HttpClient.HttpClient>;
}

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
      Layer.succeed(SentryApp, sentryAppService(undefined, [])),
    );
    yield* seedRows.pipe(Effect.provide(services));
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

export function registration(scope: readonly string[]) {
  return {
    client_name: "A client registered dynamically",
    redirect_uris: [MEMBER_MCP_TEST.LOOPBACK],
    application_type: "native",
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: scope.join(" "),
  };
}

export async function register(auth: MemberMcpTestAuth, body: object): Promise<Response> {
  return auth.handler(
    new Request(`${MEMBER_MCP_TEST.ORIGIN}${AUTH_BASE_PATH}/oauth2/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export interface Grant {
  readonly clientId: string;
  readonly scope: readonly string[];
  readonly resource?: string;
}

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

export async function exchangeCode(
  auth: MemberMcpTestAuth,
  grant: Grant,
  landed: URL,
): Promise<string> {
  return (await exchangeTokens(auth, grant, landed)).access_token;
}

export async function exchangeTokens(auth: MemberMcpTestAuth, grant: Grant, landed: URL) {
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
  return decodeTokens(await exchanged.json());
}

export async function mintedToken(
  auth: MemberMcpTestAuth,
  cookie: string,
  grant: Grant,
): Promise<string> {
  return exchangeCode(auth, grant, await authorize(auth, cookie, grant));
}

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
