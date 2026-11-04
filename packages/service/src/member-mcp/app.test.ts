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
import { writeAccountPreferences } from "@repo/database/models/account-store";
import { createAgent, readAgent } from "@repo/database/models/agent-store";
import { listMemories, rememberMemory } from "@repo/database/models/memory-store";
import {
  PLAN_COMMENT_OUTCOME,
  readPlanCommentThreads,
  startPlanCommentThread,
} from "@repo/database/models/plan-comments";
import { listRevisions } from "@repo/database/models/plan-revisions";
import { claimRuntimeSession } from "@repo/database/models/recorded-session";
import { listTaskSections, writeTaskSections } from "@repo/database/models/task-section-store";
import { createTask, readTask } from "@repo/database/models/task-store";
import { oauthClient, oauthClientResource, oauthResource } from "@repo/database/schemas/auth";
import { messages } from "@repo/database/schemas/storage";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import {
  getTestDB,
  openInboxItem,
  openMigratedPglite,
  openTaskAgent,
  openWorkspace,
  sqlClientOverPglite,
} from "@repo/database/testing";
import { AGENT_ARCHIVER, AGENT_PAYER } from "@repo/features/agent-wire";
import { INBOX_ANSWER_LEAD, INBOX_ASK, INBOX_REPLY, INBOX_STATUS } from "@repo/features/inbox-wire";
import {
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_ENTRY,
  PLAN_COMMENT_SCOPE,
  PLAN_COMMENT_STATUS,
} from "@repo/features/plan-comment-wire";
import { NOTE_KIND } from "@repo/features/plan-template";
import { TASK_SECTION_WRITE } from "@repo/features/task-section-wire";
import { PLAN_ACTOR, TASK_STATUS } from "@repo/features/task-wire";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { EXPERIMENT } from "@repo/settings";
import { settleJsonSchemaGolden } from "@repo/wire/testing";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { DateTime, Effect, Layer, Option, Result, Schema } from "effect";
import { HttpRouter } from "effect/http";
import { afterEach, vi } from "vitest";
import { readWorkspaceMemories, WORKSPACE_MEMORY } from "../accounts/workspace-memories.js";
import { recordMemberPlanNotes } from "../agents/coder-host/plan-edit.js";
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
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { postInboxThread, readInboxItem } from "../inbox/inbox-store.js";
import { modelCatalogOf } from "../providers/model-catalog.js";
import { connectAgentApiKeys } from "../testing/agent-credentials.js";
import { fakeEve, openAskOf, openTask, startedAgent } from "../testing/agents-app-support.js";
import { NO_GITHUB } from "../testing/github-app-fake.js";
import { harnessFor, recordingHarness } from "../testing/native-harness-fake.js";
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
 * call here, an agent's harness is a recording one that takes every
 * message, and the model catalog offers nothing. An answer's hand-off to
 * the agent that asked is driven apart, over the agents' own test world
 * (`../testing/agents-app-support.ts`): a started agent on a fake eve, its
 * server admitted on the world's bearers. Synthetic accounts.
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
/** The inbox read, each thread by its id, the ask it holds open, and its messages' asks by their options. */
const decodeInbox = Schema.decodeUnknownSync(
  Schema.Struct({
    threads: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        status: Schema.String,
        askId: Schema.optionalKey(Schema.String),
        waitsOnMember: Schema.Boolean,
        thread: Schema.Array(
          Schema.Struct({
            from: Schema.String,
            ask: Schema.optionalKey(
              Schema.Struct({
                options: Schema.optionalKey(Schema.Array(Schema.Struct({ label: Schema.String }))),
              }),
            ),
          }),
        ),
      }),
    ),
  }),
);
/** A write's answer: the thread as it then stands. */
const decodeWritten = Schema.decodeUnknownSync(
  Schema.Struct({ thread: Schema.Struct({ status: Schema.String }) }),
);
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

const decodeThread = Schema.decodeUnknownSync(
  Schema.Struct({ thread: Schema.String, state: Schema.String }),
);
const decodeThreads = Schema.decodeUnknownSync(
  Schema.Struct({
    threads: Schema.Array(
      Schema.Struct({
        thread: Schema.String,
        on: Schema.String,
        comments: Schema.Array(Schema.Struct({ words: Schema.String })),
      }),
    ),
  }),
);
const decodeKept = Schema.decodeUnknownSync(
  Schema.Struct({ memory: Schema.Struct({ id: Schema.String }) }),
);
const decodeFound = Schema.decodeUnknownSync(
  Schema.Struct({ memories: Schema.Array(Schema.Struct({ id: Schema.String })) }),
);

/** The plan a stranger's task and a member's both hold, and the words a thread stands on in it. */
const PLAN_NOTE = { kind: NOTE_KIND.ADD, section: "Problem", text: "Seats drift." } as const;

/** Memory turned on for the account, as Settings › Experimental turns it on. */
const memoryOn = (userId: string) =>
  writeAccountPreferences(userId, { experiments: { [EXPERIMENT.MEMORY]: true } });

/** An agent on the task, on Claude Code, its session standing, so a comment handed to it is taken by the recording harness. */
const standingAgent = (userId: string, taskId: string) =>
  Effect.gen(function* () {
    const { agent } = Option.getOrThrow(
      yield* createAgent(userId, {
        taskId,
        idempotencyKey: randomUUID(),
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        repository: null,
        planSnapshot: null,
        prompt: "Size the seats.",
        runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
        payer: AGENT_PAYER.API_KEY,
      }),
    );
    const claimed = yield* claimRuntimeSession(
      { userId, conversationId: agent.conversationId },
      `wrun_${randomUUID()}`,
      yield* DateTime.nowAsDate,
    );
    assert.ok(claimed, "the agent's session stands");
    return agent.id;
  });

/** The JSON Schema goldens of the server's tools, where a tool's input a model is shown is recorded. */
const GOLDEN_ROOT = path.join(
  fileURLToPath(import.meta.url),
  "../../../fixtures/json-schema/member-mcp",
);

/** The golden a tool's input is recorded under: its name, hyphenated, as the package's goldens are named. */
function goldenOf(toolName: string): string {
  return `${toolName.replaceAll("_", "-")}-input`;
}

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

/** The server's group over the test's database and auth service, as a fetch a client is handed, with the clients seeded and the key set reachable. */
const standing = Effect.gen(function* () {
  const client = yield* Effect.acquireRelease(Effect.promise(openMigratedPglite), (opened) =>
    Effect.promise(() => opened.close()),
  );
  const auth = testAuth(client);
  const harness = recordingHarness();
  const services = Layer.mergeAll(
    Layer.succeedContext(yield* Layer.build(sqlClientOverPglite(client))),
    NO_GITHUB,
    modelCatalogOf([]),
    Layer.succeed(HostedEnvironment, NO_ENVIRONMENT),
    harness.layer,
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
  return { auth, fetch, services, heard: harness.heard };
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
  "a member with several workspaces lists the one a list names, reads their own tasks, agents, and inbox, and reads or answers nothing of a workspace they are not in",
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
        const ownAgent = yield* openTaskAgent(member.userId, own, ownTask.id);
        const strangerAgent = yield* openTaskAgent(stranger.userId, elsewhere, strangerTask.id);
        return {
          own,
          second,
          elsewhere,
          ownTask: ownTask.id,
          strangerTask: strangerTask.id,
          ownAgent,
          strangerAgent,
          ownItem: yield* openInboxItem(member.userId, own, ownTask.id, ownAgent, true),
          strangerItem: yield* openInboxItem(
            stranger.userId,
            elsewhere,
            strangerTask.id,
            strangerAgent,
            true,
          ),
        };
      }).pipe(Effect.provide(services));
      const strangerAsk = yield* readInboxItem(stranger.userId, rows.strangerItem).pipe(
        Effect.map((stored) => Option.getOrThrow(stored).item),
        Effect.provide(services),
      );
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
      const inbox = yield* call(MEMBER_MCP_TOOL.READ_INBOX, { workspace: slugOf(rows.own) });
      const strangers = yield* Effect.forEach(
        [
          [MEMBER_MCP_TOOL.LIST_TASKS, { workspace: slugOf(rows.elsewhere) }],
          [MEMBER_MCP_TOOL.LIST_AGENTS, { workspace: slugOf(rows.elsewhere) }],
          [MEMBER_MCP_TOOL.READ_TASK, { taskId: rows.strangerTask }],
          [MEMBER_MCP_TOOL.READ_AGENT, { agentId: rows.strangerAgent }],
          [MEMBER_MCP_TOOL.READ_AGENT_CHANGES, { agentId: rows.strangerAgent }],
          [MEMBER_MCP_TOOL.READ_INBOX, { workspace: slugOf(rows.elsewhere) }],
          [
            MEMBER_MCP_TOOL.ANSWER_ASK,
            {
              threadId: rows.strangerItem,
              askId: openAskOf(strangerAsk),
              reply: INBOX_REPLY.CHOSE,
              choices: ["Approve"],
            },
          ],
          [MEMBER_MCP_TOOL.REPLY_TO_THREAD, { threadId: rows.strangerItem, text: "Approve it." }],
          [
            MEMBER_MCP_TOOL.CLOSE_THREAD,
            { threadId: rows.strangerItem, revision: strangerAsk.revision },
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
      assert.deepEqual(
        decodeInbox(JSON.parse(inbox.text)).threads.map(({ id }) => id),
        [rows.ownItem],
      );
      for (const refused of strangers) {
        assert.equal(refused.refused, true, refused.text);
        assert.ok(
          !refused.text.includes(rows.strangerTask) && !refused.text.includes(rows.elsewhere),
        );
      }
      for (const read of owns) assert.equal(read.refused, false, read.text);
      // The stranger's thread stands as it was, its ask open and its thread its agent's alone.
      const after = yield* readInboxItem(stranger.userId, rows.strangerItem).pipe(
        Effect.map((stored) => Option.getOrThrow(stored).item),
        Effect.provide(services),
      );
      assert.deepEqual(after, strangerAsk);
    }),
);

it.effect(
  "a member makes, starts, messages, stops, changes, plans, comments, and remembers nothing in a workspace they are not in",
  () =>
    Effect.gen(function* () {
      const { auth, fetch, services } = yield* standing;
      const member = yield* Effect.promise(() => signUp(auth));
      const stranger = yield* Effect.promise(() => signUp(auth));
      const rows = yield* Effect.gen(function* () {
        const own = yield* openWorkspace(member.userId);
        yield* memoryOn(member.userId);
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
        yield* recordMemberPlanNotes(
          { userId: stranger.userId, taskId: task.id },
          { notes: [PLAN_NOTE] },
        );
        const { text } = Option.getOrThrow(yield* readTask(stranger.userId, task.id));
        const from = text.indexOf(PLAN_NOTE.text);
        const started = yield* startPlanCommentThread(
          { actor: PLAN_COMMENT_ACTOR.MEMBER, userId: stranger.userId },
          task.id,
          {
            clientKey: randomUUID(),
            scope: PLAN_COMMENT_SCOPE.WORDS,
            quote: PLAN_NOTE.text,
            anchor: { from, to: from + PLAN_NOTE.text.length },
            text,
            words: "A stranger's comment.",
          },
        );
        assert.ok(started.status === PLAN_COMMENT_OUTCOME.DONE && "thread" in started.answer);
        const kept = yield* rememberMemory(
          elsewhere,
          stranger.userId,
          "A stranger's convention.",
          undefined,
        );
        assert.ok("memory" in kept);
        return {
          own,
          elsewhere,
          text,
          taskId: task.id,
          sectionId,
          threadId: started.answer.thread.id,
          memoryId: kept.memory.id,
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
      const { taskId, agentId, threadId, memoryId } = rows;

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
          [MEMBER_MCP_TOOL.READ_COMMENTS, { taskId }],
          [MEMBER_MCP_TOOL.COMMENT_ON_PLAN, { taskId, quote: PLAN_NOTE.text, words: "Planted." }],
          [MEMBER_MCP_TOOL.REPLY_TO_COMMENT, { taskId, thread: threadId, words: "Planted." }],
          [MEMBER_MCP_TOOL.UPDATE_COMMENT, { taskId, thread: threadId, resolved: true }],
          [MEMBER_MCP_TOOL.SEARCH_MEMORY, { workspace }],
          [MEMBER_MCP_TOOL.SAVE_MEMORY, { workspace, text: "Planted." }],
          // Note that the member's own workspace holds no memory of that id, so a correction of it is refused.
          [
            MEMBER_MCP_TOOL.SAVE_MEMORY,
            { workspace: `workspace-${rows.own}`, text: "Planted.", replaces: memoryId },
          ],
          [MEMBER_MCP_TOOL.FORGET_MEMORY, { workspace, memoryId }],
        ] as const,
        ([name, args]) =>
          Effect.promise(async () => {
            const answer = decodeAnswer(await client.callTool({ name, arguments: args }));
            return { name, refused: answer.isError === true, text: answer.content[0].text };
          }),
      );
      // A forget in the member's own workspace of a memory of another's forgets nothing there.
      yield* Effect.promise(() =>
        client.callTool({
          name: MEMBER_MCP_TOOL.FORGET_MEMORY,
          arguments: { workspace: `workspace-${rows.own}`, memoryId },
        }),
      );
      yield* Effect.promise(() => client.close());
      const after = yield* Effect.gen(function* () {
        return {
          task: yield* readTask(stranger.userId, taskId),
          sections: yield* listTaskSections(stranger.userId),
          agent: yield* readAgent(stranger.userId, agentId),
          threads: yield* readPlanCommentThreads(stranger.userId, taskId),
          memories: yield* listMemories(rows.elsewhere),
          ownMemories: yield* listMemories(rows.own),
        };
      }).pipe(Effect.provide(services));

      for (const answer of answers) {
        assert.equal(answer.refused, true, `${answer.name}: ${answer.text}`);
        assert.ok(
          !answer.text.includes(taskId) &&
            !answer.text.includes(rows.elsewhere) &&
            !answer.text.includes("A stranger's"),
        );
      }
      const task = Option.getOrThrow(after.task);
      assert.equal(task.task.name, "A stranger's task");
      assert.equal(task.text, rows.text);
      assert.deepEqual(
        Option.getOrThrow(after.threads).map((thread) => ({
          status: thread.status,
          comments: thread.entries.map(({ words }) => words),
        })),
        [{ status: PLAN_COMMENT_STATUS.OPEN, comments: ["A stranger's comment."] }],
      );
      assert.deepEqual(
        after.memories.map(({ text }) => text),
        ["A stranger's convention."],
      );
      assert.deepEqual(after.ownMemories, []);
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

it.layer(getTestDB())("the member's inbox over a started agent", (it) => {
  it.effect(
    "an outside agent reads the decide ask waiting on the member, answers it, and the agent that asked takes the answer up as the member's",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const { owner, task, ask, mcpFetch } = yield* openTask({ eve });
        const { agent, target } = yield* startedAgent(owner, task.id, ask);
        const sessionId = eve.opened[0]?.sessionId ?? "";
        assert.equal(
          yield* claimRuntimeSession(target, sessionId, yield* DateTime.nowAsDate),
          true,
        );
        const posted = yield* postInboxThread(
          { userId: owner, taskId: task.id, agentId: agent.id },
          {
            key: "invite-expiry",
            title: "How long should an invitation stand?",
            body: "An invitation nobody accepts expires after this.",
            ask: { type: INBOX_ASK.DECIDE, options: [{ label: "7 days" }, { label: "30 days" }] },
          },
        );
        assert.ok(Result.isSuccess(posted));
        const askId = openAskOf(posted.success);
        const before = eve.sent.length;
        const { client } = yield* connected(mcpFetch, owner, REVISION.MODERN);
        const call = (name: string, args: Record<string, unknown>) =>
          Effect.promise(async () =>
            decodeAnswer(await client.callTool({ name, arguments: args })),
          );

        const read = yield* call(MEMBER_MCP_TOOL.READ_INBOX, {});
        const answered = yield* call(MEMBER_MCP_TOOL.ANSWER_ASK, {
          threadId: posted.success.id,
          askId,
          reply: INBOX_REPLY.CHOSE,
          choices: ["30 days"],
        });
        yield* Effect.promise(() => client.close());

        assert.notEqual(read.isError, true, read.content[0].text);
        const [waiting] = decodeInbox(JSON.parse(read.content[0].text)).threads;
        assert.deepEqual(
          [
            waiting?.id,
            waiting?.askId,
            waiting?.waitsOnMember,
            waiting?.thread.at(-1)?.ask?.options?.map(({ label }) => label),
          ],
          [posted.success.id, askId, true, ["7 days", "30 days"]],
        );
        assert.notEqual(answered.isError, true, answered.content[0].text);
        assert.equal(
          decodeWritten(JSON.parse(answered.content[0].text)).thread.status,
          INBOX_STATUS.ANSWERED,
        );
        // The answer is handed to the session the agent runs in, as the member's message its next turn opens on.
        assert.deepEqual(
          eve.sent.slice(before).map((each) => [each.authorization, each.sessionId]),
          [[harnessFor(owner), sessionId]],
        );
        const handed = JSON.stringify(eve.sent.at(-1)?.message.message);
        assert.ok(handed.includes(INBOX_ANSWER_LEAD) && handed.includes("30 days"), handed);
      }),
  );
});

it.effect(
  "a member's thread and reply are their own and reach the agent in the thread as the window's do, and resolving settles it",
  () =>
    Effect.gen(function* () {
      const { auth, fetch, services, heard } = yield* standing;
      const member = yield* Effect.promise(() => signUp(auth));
      const { taskId, agentId } = yield* Effect.gen(function* () {
        const own = yield* openWorkspace(member.userId);
        yield* connectAgentApiKeys(member.userId);
        const task = yield* createTask(member.userId, { organizationId: own, name: "Seats" });
        yield* recordMemberPlanNotes(
          { userId: member.userId, taskId: task.id },
          { notes: [PLAN_NOTE] },
        );
        return { taskId: task.id, agentId: yield* standingAgent(member.userId, task.id) };
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
      const mention = `[@Seats](https://vespin.dev/acme/plan/${taskId}/agent/${agentId})`;

      const { thread } = decodeThread(
        yield* call(MEMBER_MCP_TOOL.COMMENT_ON_PLAN, {
          taskId,
          quote: PLAN_NOTE.text,
          words: `${mention} do seats still drift?`,
        }),
      );
      yield* call(MEMBER_MCP_TOOL.REPLY_TO_COMMENT, { taskId, thread, words: "Invoices too." });
      const open = decodeThreads(yield* call(MEMBER_MCP_TOOL.READ_COMMENTS, { taskId }));
      const resolved = decodeThread(
        yield* call(MEMBER_MCP_TOOL.UPDATE_COMMENT, { taskId, thread, resolved: true }),
      );
      yield* Effect.promise(() => client.close());
      const lines = yield* Effect.gen(function* () {
        const db = yield* Database;
        return yield* db
          .select({ words: sql<string>`${messages.metadata} ->> 'words'` })
          .from(messages)
          .where(sql`${messages.metadata} ->> 'thread_id' = ${thread}`);
      }).pipe(Effect.provide(services));
      const stored = yield* readPlanCommentThreads(member.userId, taskId).pipe(
        Effect.provide(services),
      );

      assert.deepEqual(
        open.threads.map((read) => ({
          thread: read.thread,
          on: read.on,
          comments: read.comments.map(({ words }) => words),
        })),
        [
          {
            thread,
            on: PLAN_NOTE.text,
            comments: [`${mention} do seats still drift?`, "Invoices too."],
          },
        ],
      );
      assert.equal(resolved.state, PLAN_COMMENT_STATUS.RESOLVED);
      // The thread was handed to the agent once for each comment, as the member's words, as a reply in the window hands it.
      assert.deepEqual(
        lines.map(({ words }) => words),
        [`${mention} do seats still drift?`, "Invoices too."],
      );
      assert.deepEqual(
        heard.map(({ account }) => account),
        [member.userId, member.userId],
      );
      const entries = Option.getOrThrow(stored)[0]?.entries ?? [];
      assert.deepEqual(
        entries
          .filter((entry) => entry.kind === PLAN_COMMENT_ENTRY.COMMENT)
          .map((entry) => [entry.writer.actor, entry.writer.by?.userId]),
        [
          [PLAN_COMMENT_ACTOR.MEMBER, member.userId],
          [PLAN_COMMENT_ACTOR.MEMBER, member.userId],
        ],
      );
    }),
);

it.effect(
  "a member with Memory on keeps a memory Settings › Memory lists as theirs, finds it, corrects it, and forgets it; with Memory off nothing runs",
  () =>
    Effect.gen(function* () {
      const { auth, fetch, services } = yield* standing;
      const member = yield* Effect.promise(() => signUp(auth));
      const workspaceId = yield* openWorkspace(member.userId).pipe(Effect.provide(services));
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
          return { refused: answer.isError === true, read: JSON.parse(answer.content[0].text) };
        });
      const settings = readWorkspaceMemories(member.userId, workspaceId).pipe(
        Effect.provide(services),
      );

      const off = yield* call(MEMBER_MCP_TOOL.SAVE_MEMORY, { text: "Tests run on PGlite." });
      yield* memoryOn(member.userId).pipe(Effect.provide(services));
      const kept = decodeKept(
        (yield* call(MEMBER_MCP_TOOL.SAVE_MEMORY, { text: "Tests run on PGlite." })).read,
      );
      const listed = yield* settings;
      const found = decodeFound(
        (yield* call(MEMBER_MCP_TOOL.SEARCH_MEMORY, { query: "pglite" })).read,
      );
      yield* call(MEMBER_MCP_TOOL.SAVE_MEMORY, {
        text: "Tests run on PGlite through test:store.",
        replaces: kept.memory.id,
      });
      const corrected = yield* settings;
      const forgot = yield* call(MEMBER_MCP_TOOL.FORGET_MEMORY, { memoryId: kept.memory.id });
      const forgotten = yield* settings;
      yield* Effect.promise(() => client.close());

      assert.equal(off.refused, true);
      assert.ok(listed.kind === WORKSPACE_MEMORY.READ);
      assert.deepEqual(
        listed.memories.map(({ id, text, keptBy }) => ({ id, text, keptBy: keptBy?.userId })),
        [{ id: kept.memory.id, text: "Tests run on PGlite.", keptBy: member.userId }],
      );
      assert.deepEqual(
        found.memories.map(({ id }) => id),
        [kept.memory.id],
      );
      assert.ok(corrected.kind === WORKSPACE_MEMORY.READ);
      assert.deepEqual(
        corrected.memories.map(({ id, text }) => ({ id, text })),
        [{ id: kept.memory.id, text: "Tests run on PGlite through test:store." }],
      );
      assert.equal(forgot.refused, false);
      assert.ok(forgotten.kind === WORKSPACE_MEMORY.READ);
      assert.deepEqual(forgotten.memories, []);
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
