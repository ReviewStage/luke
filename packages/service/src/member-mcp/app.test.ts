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
import { readAgent } from "@repo/database/models/agent-store";
import { listRevisions } from "@repo/database/models/plan-revisions";
import { listTaskSections, writeTaskSections } from "@repo/database/models/task-section-store";
import { createTask, readTask } from "@repo/database/models/task-store";
import { agentTable } from "@repo/database/schemas/agent";
import { oauthClient, oauthClientResource, oauthResource } from "@repo/database/schemas/auth";
import {
  joinWorkspace,
  openMigratedPglite,
  openTaskAgent,
  openWorkspace,
  sqlClientOverPglite,
} from "@repo/database/testing";
import { AGENT_ARCHIVER } from "@repo/features/agent-wire";
import { NOTE_KIND } from "@repo/features/plan-template";
import { PULL_REQUEST_ACTION } from "@repo/features/pull-request-write-wire";
import { TASK_SECTION_WRITE } from "@repo/features/task-section-wire";
import { PLAN_ACTOR, TASK_STATUS } from "@repo/features/task-wire";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { settleJsonSchemaGolden } from "@repo/wire/testing";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { Clock, Effect, Layer, Option, Schema } from "effect";
import { HttpRouter } from "effect/http";
import type * as HttpClient from "effect/http/HttpClient";
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
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import type { GitHubApp } from "../github/github-app.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { modelCatalogOf } from "../providers/model-catalog.js";
import {
  freshInstallation,
  type GraphqlCall,
  graphqlAnswering,
  mutationOf,
  PUBLISHED,
  PULL_REQUEST_NODE_ID,
  publishedPullRequestDrafted,
  RELAY_FULL_NAME,
} from "../testing/agents-app-support.js";
import {
  connectWorkspaceGitHub,
  githubReaching,
  NO_GITHUB,
  signInWithGitHub,
  standingGithubRow,
} from "../testing/github-app-fake.js";
import { MEMBER_MCP_METADATA_ROUTE, memberMcpApp, memberMcpAuth, memberMcpIssuer } from "./app.js";
import {
  MEMBER_MCP_PATH,
  MEMBER_MCP_SCOPE,
  memberMcpResourceUrl,
  oauthResourceRecord,
} from "./resource.js";
import { LIST_WORKSPACES_TOOL, MEMBER_MCP_TOOL, MEMBER_MCP_TOOLS } from "./tools.js";

/**
 * The member MCP server, answered by its group the way a function answers
 * it, over a Better Auth configured as `auth.ts` configures its provider and
 * key set, over a migrated PGlite the tools read too. The tokens are the
 * provider's own, minted through a seeded test client linked to the
 * resource: a signed-up account authorizes it, as a client's sign-in will,
 * and the client exchanges its code. The key set the admission verifies
 * against is fetched from the auth service, as on a deployment, through a
 * `fetch` that reaches the in-process handler alone. The SDK's own client
 * drives the server at both revisions it serves. GitHub is reached by no
 * call here but a change to a pull request's, which answers from a script
 * as the Pull request tab's own tests script it, no agent's session is,
 * and the model catalog offers nothing. Synthetic accounts and tokens.
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

/** The member's own GitHub token, as their sign-in through the App left it. */
const MEMBER_GITHUB_TOKEN = "ghu_member";

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
/** The rows of a list read by their ids alone. */
const IdsSchema = Schema.Array(Schema.Struct({ id: Schema.String }));
const decodeTasks = Schema.decodeUnknownSync(Schema.Struct({ tasks: IdsSchema }));
const decodeAgents = Schema.decodeUnknownSync(Schema.Struct({ agents: IdsSchema }));
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

const decodeMade = Schema.decodeUnknownSync(
  Schema.Struct({ task: Schema.Struct({ id: Schema.String }) }),
);

/** The JSON Schema goldens of the server's tools, where a tool's input a model is shown is recorded. */
const GOLDEN_ROOT = path.join(
  fileURLToPath(import.meta.url),
  "../../../fixtures/json-schema/member-mcp",
);

/** The golden a tool's input is recorded under: its name, hyphenated, as the package's goldens are named. */
function goldenOf(toolName: string): string {
  return `${toolName.replaceAll("_", "-")}-input`;
}

/** The head commit a changes read answers its pull request at. */
const decodeHead = Schema.decodeUnknownSync(
  Schema.Struct({ pullRequest: Schema.Struct({ headSha: Schema.String }) }),
);

/** A tool's answer as the agent reads it: whether it is the tool's error, and its JSON text read. */
const decodeAnswer = Schema.decodeUnknownSync(
  Schema.Struct({
    isError: Schema.optionalKey(Schema.Boolean),
    content: Schema.Tuple([Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })]),
  }),
);

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

/** The server's group over the test's database, auth service, clock, and the GitHub given, as a fetch a client is handed, with the clients seeded and the key set reachable. */
const standingOver = (github: Layer.Layer<GitHubApp | HttpClient.HttpClient>) =>
  Effect.gen(function* () {
    const client = yield* Effect.acquireRelease(Effect.promise(openMigratedPglite), (opened) =>
      Effect.promise(() => opened.close()),
    );
    const auth = testAuth(client);
    const services = Layer.mergeAll(
      Layer.succeedContext(yield* Layer.build(sqlClientOverPglite(client))),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      github,
      modelCatalogOf([]),
      Layer.succeed(HostedEnvironment, NO_ENVIRONMENT),
    );
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

/** The same, over a GitHub nobody reaches. */
const standing = standingOver(NO_GITHUB);

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
  "an SDK client at %s lists every tool as its golden shows it, with its annotations, and runs list_workspaces as the member",
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
      const goldens = yield* Effect.forEach(MEMBER_MCP_TOOLS, ({ name, annotations }) =>
        Effect.promise(async () => ({
          name,
          inputSchema: JSON.parse(
            await fs.readFile(path.join(GOLDEN_ROOT, `${goldenOf(name)}.json`), "utf8"),
          ),
          annotations,
        })),
      );
      assert.deepEqual(
        listed.tools.map(({ name, inputSchema, annotations }) => ({
          name,
          inputSchema,
          annotations,
        })),
        goldens,
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

it.effect(
  "a member with several workspaces lists the one a list names, reads their own tasks and agents by id, and reads nothing of a workspace they are not in nor changes an agent's pull request there",
  () =>
    Effect.gen(function* () {
      const { auth, fetch, services } = yield* standing;
      const member = yield* Effect.promise(() => signUp(auth));
      const stranger = yield* Effect.promise(() => signUp(auth));
      const rows = yield* Effect.gen(function* () {
        const own = yield* openWorkspace(member.userId);
        const second = yield* openWorkspace(member.userId);
        const elsewhere = yield* openWorkspace(stranger.userId);
        const ownTask = yield* createTask(member.userId, {
          organizationId: own,
          name: "Seat billing",
        });
        const strangerTask = yield* createTask(stranger.userId, {
          organizationId: elsewhere,
          name: "A stranger's task",
        });
        return {
          own,
          second,
          elsewhere,
          ownTask: ownTask.id,
          strangerTask: strangerTask.id,
          ownAgent: yield* openTaskAgent(member.userId, own, ownTask.id),
          strangerAgent: yield* openTaskAgent(stranger.userId, elsewhere, strangerTask.id),
        };
      }).pipe(Effect.provide(services));
      const token = yield* Effect.promise(() =>
        mintedToken(auth, member.cookie, {
          client: MCP_CLIENT,
          scope: [MEMBER_MCP_SCOPE.MCP],
          resource: RESOURCE,
        }),
      );
      const { client } = yield* connected(fetch, token, REVISION.MODERN);
      const call = (name: string, args: Record<string, unknown>) =>
        Effect.promise(async () => {
          const answer = decodeAnswer(await client.callTool({ name, arguments: args }));
          return { refused: answer.isError === true, text: answer.content[0].text };
        });
      const slugOf = (workspaceId: string) => `workspace-${workspaceId}`;

      const unnamed = yield* call(MEMBER_MCP_TOOL.LIST_TASKS, {});
      const tasks = yield* call(MEMBER_MCP_TOOL.LIST_TASKS, { workspace: slugOf(rows.own) });
      const agents = yield* call(MEMBER_MCP_TOOL.LIST_AGENTS, { workspace: slugOf(rows.own) });
      const strangers = yield* Effect.forEach(
        [
          [MEMBER_MCP_TOOL.LIST_TASKS, { workspace: slugOf(rows.elsewhere) }],
          [MEMBER_MCP_TOOL.LIST_AGENTS, { workspace: slugOf(rows.elsewhere) }],
          [MEMBER_MCP_TOOL.READ_TASK, { taskId: rows.strangerTask }],
          [MEMBER_MCP_TOOL.READ_AGENT, { agentId: rows.strangerAgent }],
          [MEMBER_MCP_TOOL.READ_AGENT_CHANGES, { agentId: rows.strangerAgent }],
          [
            MEMBER_MCP_TOOL.AGENT_PULL_REQUEST_ACTION,
            {
              agentId: rows.strangerAgent,
              change: { action: PULL_REQUEST_ACTION.READY_FOR_REVIEW },
            },
          ],
        ] as const,
        ([name, args]) => call(name, args),
      );
      const owns = yield* Effect.forEach(
        [
          [MEMBER_MCP_TOOL.READ_TASK, { taskId: rows.ownTask }],
          [MEMBER_MCP_TOOL.READ_AGENT, { agentId: rows.ownAgent }],
          [MEMBER_MCP_TOOL.READ_AGENT_CHANGES, { agentId: rows.ownAgent }],
        ] as const,
        ([name, args]) => call(name, args),
      );
      yield* Effect.promise(() => client.close());

      // A list that names no workspace is refused where the member has two, naming both and no other.
      assert.equal(unnamed.refused, true);
      assert.ok(
        unnamed.text.includes(slugOf(rows.own)) && unnamed.text.includes(slugOf(rows.second)),
      );
      assert.ok(!unnamed.text.includes(slugOf(rows.elsewhere)));
      assert.deepEqual(
        decodeTasks(JSON.parse(tasks.text)).tasks.map(({ id }) => id),
        [rows.ownTask],
      );
      assert.deepEqual(
        decodeAgents(JSON.parse(agents.text)).agents.map(({ id }) => id),
        [rows.ownAgent],
      );
      for (const refused of strangers) {
        assert.equal(refused.refused, true, refused.text);
        assert.ok(
          !refused.text.includes(rows.strangerTask) && !refused.text.includes(rows.elsewhere),
        );
      }
      for (const read of owns) assert.equal(read.refused, false, read.text);
    }),
);

it.effect(
  "a member makes, starts, messages, stops, changes, and plans nothing in a workspace they are not in",
  () =>
    Effect.gen(function* () {
      const { auth, fetch, services } = yield* standing;
      const member = yield* Effect.promise(() => signUp(auth));
      const stranger = yield* Effect.promise(() => signUp(auth));
      const rows = yield* Effect.gen(function* () {
        yield* openWorkspace(member.userId);
        const elsewhere = yield* openWorkspace(stranger.userId);
        const task = yield* createTask(stranger.userId, {
          organizationId: elsewhere,
          name: "A stranger's task",
        });
        const sectionId = randomUUID();
        yield* writeTaskSections(stranger.userId, {
          kind: TASK_SECTION_WRITE.CREATE,
          id: sectionId,
          workspaceId: elsewhere,
          title: "A stranger's section",
        });
        return {
          elsewhere,
          taskId: task.id,
          sectionId,
          agentId: yield* openTaskAgent(stranger.userId, elsewhere, task.id),
        };
      }).pipe(Effect.provide(services));
      const token = yield* Effect.promise(() =>
        mintedToken(auth, member.cookie, {
          client: MCP_CLIENT,
          scope: [MEMBER_MCP_SCOPE.MCP],
          resource: RESOURCE,
        }),
      );
      const { client } = yield* connected(fetch, token, REVISION.MODERN);
      const workspace = `workspace-${rows.elsewhere}`;
      const { taskId, agentId } = rows;

      const answers = yield* Effect.forEach(
        [
          [MEMBER_MCP_TOOL.CREATE_TASK, { workspace, name: "Planted" }],
          [MEMBER_MCP_TOOL.UPDATE_TASK, { taskId, name: "Renamed" }],
          [
            MEMBER_MCP_TOOL.EDIT_PLAN,
            { taskId, notes: [{ kind: NOTE_KIND.ADD, section: "Problem", text: "Planted." }] },
          ],
          [MEMBER_MCP_TOOL.CREATE_SECTION, { workspace, title: "Planted" }],
          [MEMBER_MCP_TOOL.DELETE_SECTION, { sectionId: rows.sectionId }],
          [MEMBER_MCP_TOOL.START_AGENT, { taskId }],
          [MEMBER_MCP_TOOL.START_AGENT, { workspace, prompt: "Go." }],
          [MEMBER_MCP_TOOL.START_AGENT, { from: { agentId } }],
          [MEMBER_MCP_TOOL.MESSAGE_AGENT, { agentId, text: "Hello." }],
          [MEMBER_MCP_TOOL.STOP_AGENT, { agentId }],
          [MEMBER_MCP_TOOL.UPDATE_AGENT, { agentId, archived: true }],
        ] as const,
        ([name, args]) =>
          Effect.promise(async () => {
            const answer = decodeAnswer(await client.callTool({ name, arguments: args }));
            return { name, refused: answer.isError === true, text: answer.content[0].text };
          }),
      );
      yield* Effect.promise(() => client.close());
      const after = yield* Effect.gen(function* () {
        return {
          task: yield* readTask(stranger.userId, taskId),
          sections: yield* listTaskSections(stranger.userId),
          agent: yield* readAgent(stranger.userId, agentId),
        };
      }).pipe(Effect.provide(services));

      for (const answer of answers) {
        assert.equal(answer.refused, true, `${answer.name}: ${answer.text}`);
        assert.ok(!answer.text.includes(taskId) && !answer.text.includes(rows.elsewhere));
      }
      const task = Option.getOrThrow(after.task);
      assert.equal(task.task.name, "A stranger's task");
      assert.equal(task.text, "");
      assert.deepEqual(
        after.sections.sections.map(({ id }) => id),
        [rows.sectionId],
      );
      assert.equal(Option.getOrThrow(after.agent).archivedAt, null);
    }),
);

it.effect(
  "a task a member makes, its plan's notes, and an agent they archive are the member's own, as the desktop shows them",
  () =>
    Effect.gen(function* () {
      const { auth, fetch, services } = yield* standing;
      const member = yield* Effect.promise(() => signUp(auth));
      const agentId = yield* Effect.gen(function* () {
        const own = yield* openWorkspace(member.userId);
        return yield* openTaskAgent(member.userId, own, null);
      }).pipe(Effect.provide(services));
      const token = yield* Effect.promise(() =>
        mintedToken(auth, member.cookie, {
          client: MCP_CLIENT,
          scope: [MEMBER_MCP_SCOPE.MCP],
          resource: RESOURCE,
        }),
      );
      const { client } = yield* connected(fetch, token, REVISION.MODERN);
      const call = (name: string, args: Record<string, unknown>) =>
        Effect.promise(async () => {
          const answer = decodeAnswer(await client.callTool({ name, arguments: args }));
          assert.notEqual(answer.isError, true, `${name}: ${answer.content[0].text}`);
          return JSON.parse(answer.content[0].text);
        });

      const made = decodeMade(
        yield* call(MEMBER_MCP_TOOL.CREATE_TASK, {
          name: "Seat billing",
          plan: "## Problem\n\nSeats drift.",
        }),
      );
      const taskId = made.task.id;
      yield* call(MEMBER_MCP_TOOL.EDIT_PLAN, {
        taskId,
        notes: [{ kind: NOTE_KIND.ADD, section: "Problem", text: "Invoices lag too." }],
      });
      yield* call(MEMBER_MCP_TOOL.UPDATE_TASK, { taskId, status: TASK_STATUS.IN_PROGRESS });
      yield* call(MEMBER_MCP_TOOL.UPDATE_AGENT, { agentId, archived: true, reason: "Done." });
      yield* Effect.promise(() => client.close());
      const after = yield* Effect.gen(function* () {
        return {
          task: Option.getOrThrow(yield* readTask(member.userId, taskId)),
          revisions: yield* listRevisions(member.userId, taskId),
          agent: Option.getOrThrow(yield* readAgent(member.userId, agentId)),
        };
      }).pipe(Effect.provide(services));

      assert.equal(after.task.ownerId, member.userId);
      assert.equal(after.task.task.status, TASK_STATUS.IN_PROGRESS);
      assert.equal(after.task.text, "## Problem\n\nSeats drift.\n\nInvoices lag too.");
      // The plan's first text and the note are the member's own, as their window writes it, and no agent's.
      assert.deepEqual(
        [...new Set(after.revisions.revisions.map(({ lastEdit }) => lastEdit.actor))],
        [PLAN_ACTOR.DEVELOPER],
      );
      assert.deepEqual(after.agent.archivedBy, {
        by: AGENT_ARCHIVER.MEMBER,
        userId: member.userId,
        reason: "Done.",
      });
    }),
);

it.effect(
  "an outside agent marks the member's agent's draft ready and merges it against the head read_agent_changes answered, on the member's own GitHub sign-in as the Pull request tab does, and a teammate with no GitHub sign-in is told to sign in, with nothing made",
  () =>
    Effect.gen(function* () {
      const calls: GraphqlCall[] = [];
      const drafted = publishedPullRequestDrafted(() => true);
      const installation = freshInstallation();
      const github = githubReaching(
        [installation],
        undefined,
        undefined,
        graphqlAnswering(calls, undefined, (sent) =>
          new URL(sent.url).pathname === `/repos/${RELAY_FULL_NAME}/pulls/${PUBLISHED.number}/files`
            ? Response.json([])
            : drafted(sent),
        ),
      );
      const { auth, fetch, services } = yield* standingOver(github.layer);
      const member = yield* Effect.promise(() => signUp(auth));
      const teammate = yield* Effect.promise(() => signUp(auth));
      const agentId = yield* Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        yield* signInWithGitHub(member.userId, {
          ...standingGithubRow(now),
          accessToken: MEMBER_GITHUB_TOKEN,
        });
        const workspaceId = yield* openWorkspace(member.userId);
        yield* joinWorkspace(workspaceId, teammate.userId);
        yield* connectWorkspaceGitHub(workspaceId, installation);
        const task = yield* createTask(member.userId, {
          organizationId: workspaceId,
          name: "Teammate invitations",
        });
        const id = yield* openTaskAgent(member.userId, workspaceId, task.id);
        // The agent pushed its branch to the repository the installation reaches, from which its draft stands open.
        yield* Database.use((db) =>
          db
            .update(agentTable)
            .set({
              repository: RELAY_FULL_NAME,
              repositories: [RELAY_FULL_NAME],
              branch: PUBLISHED.branch,
            })
            .where(eq(agentTable.id, id)),
        );
        return id;
      }).pipe(Effect.provide(services));
      const clientOf = (cookie: string) =>
        Effect.flatMap(
          Effect.promise(() =>
            mintedToken(auth, cookie, {
              client: MCP_CLIENT,
              scope: [MEMBER_MCP_SCOPE.MCP],
              resource: RESOURCE,
            }),
          ),
          (token) => Effect.map(connected(fetch, token, REVISION.MODERN), ({ client }) => client),
        );
      const memberClient = yield* clientOf(member.cookie);
      const teammateClient = yield* clientOf(teammate.cookie);
      const act = (client: Client, change: Record<string, string>) =>
        Effect.promise(async () =>
          decodeAnswer(
            await client.callTool({
              name: MEMBER_MCP_TOOL.AGENT_PULL_REQUEST_ACTION,
              arguments: { agentId, change },
            }),
          ),
        );

      const unsigned = yield* act(teammateClient, { action: PULL_REQUEST_ACTION.READY_FOR_REVIEW });
      const ready = yield* act(memberClient, { action: PULL_REQUEST_ACTION.READY_FOR_REVIEW });
      const changes = yield* Effect.promise(async () =>
        decodeAnswer(
          await memberClient.callTool({
            name: MEMBER_MCP_TOOL.READ_AGENT_CHANGES,
            arguments: { agentId },
          }),
        ),
      );
      const { headSha } = decodeHead(JSON.parse(changes.content[0].text)).pullRequest;
      const merged = yield* act(memberClient, {
        action: PULL_REQUEST_ACTION.MERGE,
        method: "squash",
        headSha,
      });
      yield* Effect.promise(() => Promise.all([memberClient.close(), teammateClient.close()]));

      assert.equal(unsigned.isError, true);
      assert.match(unsigned.content[0].text, /sign in with GitHub/u);
      for (const answer of [ready, merged]) {
        assert.notEqual(answer.isError, true, answer.content[0].text);
        assert.deepEqual(JSON.parse(answer.content[0].text), { status: "accepted" });
      }
      assert.equal(headSha, PUBLISHED.headSha);
      const id = PULL_REQUEST_NODE_ID;
      assert.deepEqual(
        calls.flatMap((call) => {
          const mutation = mutationOf(call);
          return mutation === undefined ? [] : [[mutation, call.variables, call.authorization]];
        }),
        [
          ["markPullRequestReadyForReview", { id }, `Bearer ${MEMBER_GITHUB_TOKEN}`],
          [
            "mergePullRequest",
            { id, method: "SQUASH", head: PUBLISHED.headSha },
            `Bearer ${MEMBER_GITHUB_TOKEN}`,
          ],
        ],
      );
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

it.each(MEMBER_MCP_TOOLS.map((tool) => [tool.name, tool] as const))(
  "%s shows the model the recorded input",
  async (name, tool) => {
    await settleJsonSchemaGolden(GOLDEN_ROOT, goldenOf(name), tool.input);
  },
);
