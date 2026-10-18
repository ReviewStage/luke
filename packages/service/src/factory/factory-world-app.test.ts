import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { INTEGRATION_ROW_STATUS } from "@luke/database/integration-vocabulary";
import { createTask } from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import { codingAgent, type StoredPullRequest } from "@luke/database/schemas/coding-agent";
import { conversations } from "@luke/database/schemas/storage";
import { workspaceIntegrationConnection } from "@luke/database/schemas/workspace-integration";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { getTestDB, joinWorkspace, openWorkspace } from "@luke/database/testing";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import { factoryWorldAnswerSchema } from "@luke/features/factory-world-wire";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Clock, Duration, Effect, Layer, Option, Result } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  connectWorkspaceGitHub,
  type FakeGitHub,
  githubReaching,
  type InstallationFixture,
  type SentToGitHub,
} from "../testing/github-app-fake.js";
import { integrationConnectOver } from "../testing/integration-connect.js";
import { factoryWorldApp } from "./factory-world-app.js";

/**
 * A workspace's Factory world, as the world route answers it to a member:
 * the store is the real one over the migrations on PGlite, the Luke GitHub
 * App is the real one over a GitHub the test scripts (one repository's
 * tree and its manifests), Vercel Connect is the production read of a
 * deployment naming the workspace Linear connector over a Connect that
 * grants every subject, and Linear's GraphQL API answers from the same
 * script. Every request either service was asked is written down.
 *
 * Synthetic accounts, repositories, issues, and tokens throughout.
 */

const ORIGIN = "https://luke.test";

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

const LINEAR_CONNECTORS = {
  LINEAR_CONNECTOR_UID: "mcp.linear.app/linear",
  LINEAR_WORKSPACE_CONNECTOR_UID: "linear/luke-workspaces",
} as const;

/**
 * The instant the world is read at, on a clock of the route's own set there,
 * so a week's window opens well after the epoch; the store's clock stays
 * where it stands, since a pool under a moved clock waits on its own timers.
 */
const NOW = Duration.toMillis(Duration.days(30));
const DAY = Duration.toMillis(Duration.days(1));
const MINUTE = Duration.toMillis(Duration.minutes(1));

/**
 * An installation on `acme`, reaching `acme/relay` and `acme/other`; each
 * test connects one of its own, since an installation stands for one
 * workspace alone.
 */
const acmeInstallation = (id: number): InstallationFixture => ({
  id,
  login: "acme",
  repositories: [
    { owner: "acme", name: "relay", updatedAt: "2026-09-01T00:00:00Z" },
    { owner: "acme", name: "other", updatedAt: "2026-10-01T00:00:00Z" },
  ],
});

/** One entry of a tree as GitHub lists it: a blob carries its bytes, a folder none. */
interface TreeEntryFixture {
  readonly path: string;
  readonly mode: string;
  readonly type: "blob" | "tree";
  readonly sha: string;
  readonly size?: number;
}

/** A manifest as a fixture package declares it. */
interface ManifestFixture {
  readonly name: string;
  readonly private?: boolean;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

/** One file of a tree as GitHub lists it, with its bytes. */
const blob = (path: string, size: number): TreeEntryFixture => ({
  path,
  mode: "100644",
  type: "blob",
  sha: path,
  size,
});

/** The manifests of `acme/relay`, by path: the root's, three packages', and one nested too deep to name a zone. */
const RELAY_MANIFESTS = new Map<string, ManifestFixture>([
  ["package.json", { name: "relay-monorepo", private: true }],
  ["packages/core/package.json", { name: "@relay/core" }],
  [
    "packages/api/package.json",
    { name: "@relay/api", dependencies: { "@relay/core": "workspace:*", effect: "4.0.4" } },
  ],
  [
    "apps/web/package.json",
    { name: "@relay/web", devDependencies: { "@relay/api": "workspace:*" } },
  ],
  ["packages/api/src/routes/deep/package.json", { name: "@relay/deep" }],
]);

/** `acme/relay`'s default branch, listed recursively: its files with their bytes, and its folders, which carry none. */
const RELAY_TREE: readonly TreeEntryFixture[] = [
  blob("package.json", 100),
  blob("README.md", 50),
  { path: "packages", mode: "040000", type: "tree", sha: "packages" },
  blob("packages/core/package.json", 40),
  blob("packages/core/src/index.ts", 400),
  blob("packages/api/package.json", 60),
  blob("packages/api/src/routes/invite.ts", 300),
  blob("packages/api/src/routes/deep/more.ts", 200),
  blob("packages/api/src/routes/deep/package.json", 20),
  blob("apps/web/package.json", 30),
  blob("apps/web/src/main.tsx", 500),
];

/** One issue still to do as Linear's GraphQL API lists it. */
const linearNode = (
  identifier: string,
  priority: number,
  state: { readonly name: string } | null,
) => ({
  identifier,
  title: `Issue ${identifier}`,
  url: `https://linear.app/acme/issue/${identifier}`,
  priority,
  state,
});

/** The issues the workspace's grant reaches still to do, newest changed first as Linear orders them. */
const LINEAR_PLANNED = [
  linearNode("ENG-9", 3, { name: "Todo" }),
  linearNode("ENG-7", 1, { name: "In Progress" }),
  linearNode("ENG-8", 0, null),
];

/** A file's contents as GitHub's contents API answers one. */
function contentsOf(content: ManifestFixture) {
  const text = JSON.stringify(content);
  return {
    type: "file",
    size: text.length,
    encoding: "base64",
    content: Buffer.from(text).toString("base64"),
  };
}

/**
 * A GitHub on which the App reaches `acme`'s repositories, answering each
 * repository's tree and manifests from the maps given, and Linear's GraphQL
 * API answering the planned issues; anything else is not found.
 */
function githubAndLinear(
  installation: InstallationFixture,
  trees: ReadonlyMap<string, readonly TreeEntryFixture[]>,
): FakeGitHub {
  return githubReaching([installation], undefined, {}, (sent: SentToGitHub) => {
    if (sent.url === LINEAR_GRAPHQL_URL) {
      return Response.json({ data: { issues: { nodes: LINEAR_PLANNED } } });
    }
    const { pathname } = new URL(sent.url);
    const tree = /^\/repos\/acme\/([^/]+)\/git\/trees\//u.exec(pathname);
    if (tree !== null) {
      const listed = trees.get(tree[1] ?? "");
      return listed === undefined
        ? Response.json({ message: "Not Found" }, { status: 404 })
        : Response.json({ sha: "head", tree: listed, truncated: false });
    }
    const file = /^\/repos\/acme\/relay\/contents\/(.+)$/u.exec(pathname);
    if (file !== null) {
      const manifest = RELAY_MANIFESTS.get(decodeURIComponent(file[1] ?? ""));
      return manifest === undefined
        ? Response.json({ message: "Not Found" }, { status: 404 })
        : Response.json(contentsOf(manifest));
    }
    return undefined;
  });
}

/** An account with a user row; its id. */
const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Sam Okafor", email: `${userId}@luke.test` });
  return userId;
});

/** One coding agent in the workspace, on the repository and task given, started at the instant given, keeping the pull request given; its id. */
const openAgent = (
  userId: string,
  organizationId: string,
  agent: {
    readonly repository: string;
    readonly createdAt: number;
    readonly taskId?: string;
    readonly archived?: boolean;
    readonly published?: StoredPullRequest;
  },
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    const conversationId = randomUUID();
    yield* db
      .insert(conversations)
      .values({ id: conversationId, userId, kind: CONVERSATION_KIND.CODING_AGENT });
    yield* db.insert(codingAgent).values({
      id,
      organizationId,
      userId,
      conversationId,
      ...(agent.taskId === undefined ? undefined : { taskId: agent.taskId }),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      prompt: "Expire teammate invitations.",
      title: `Agent on ${agent.repository}`,
      repository: agent.repository,
      repositories: [agent.repository],
      idempotencyKey: randomUUID(),
      createdAt: new Date(agent.createdAt),
      ...(agent.archived === true ? { archivedAt: new Date(agent.createdAt) } : undefined),
      ...(agent.published === undefined ? undefined : { published: agent.published }),
    });
    return id;
  });

/** A pull request of `acme/relay` as an agent's row keeps it. */
const relayPull = (
  number: number,
  state: (typeof PULL_REQUEST_STATE)[keyof typeof PULL_REQUEST_STATE],
  areas: NonNullable<StoredPullRequest["areas"]>,
  mergedAt?: number,
): StoredPullRequest => ({
  number,
  title: `Change ${number}`,
  url: `https://github.com/acme/relay/pull/${number}`,
  state,
  checks: CHECK_SUMMARY.PASSING,
  additions: 25,
  deletions: 2,
  changedFiles: 3,
  headSha: `sha-${number}`,
  areas,
  ...(mergedAt === undefined ? undefined : { mergedAt }),
});

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** The route over the test's own database, the GitHub and Linear given, and the Linear connectors, answering one ask of the account's. */
const ask = (github: FakeGitHub, userId: string, body: WireBoundaryInput) =>
  Effect.gen(function* () {
    const clock = yield* TestClock.make();
    yield* clock.setTime(NOW);
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, clock),
      integrationConnectOver(LINEAR_CONNECTORS),
      github.layer,
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      factoryWorldApp({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(incoming.headers.get("authorization")?.replace("Bearer ", "")),
          ),
      }).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const response = yield* Effect.promise(() =>
      handler(
        new Request(new URL(HOSTED_SERVICE_PATH.FACTORY_WORLD, ORIGIN), {
          method: "POST",
          headers: { authorization: `Bearer ${userId}` },
          body: JSON.stringify(body),
        }),
      ),
    );
    // SAFETY: the route answers JSON; the test compares it as the wire value it is.
    const answered = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
    yield* Effect.promise(() => dispose());
    return { status: response.status, body: answered } satisfies Answer;
  });

/** The answer read as the wire declares it, which is what proves the world valid. */
function worldOf(answer: Answer) {
  assert.equal(answer.status, HOSTED_HTTP_STATUS.OK);
  const read = readEither(factoryWorldAnswerSchema)(unparsedWire(answer.body));
  if (Result.isFailure(read)) return assert.fail(`not the wire's world: ${read.failure.refusal}`);
  return read.success.world;
}

/** The paths of the requests GitHub was asked about a repository, in the order sent. */
const repositoryReads = (github: FakeGitHub) =>
  github.sent
    .map((sent) => new URL(sent.url))
    .filter((url) => url.pathname.startsWith("/repos/"))
    .map((url) => decodeURIComponent(url.pathname));

it.layer(getTestDB())("a workspace's Factory world", (it) => {
  it.effect(
    "a member reads the repository most of the workspace's agents work in, its zones and their edges from one tree read and its packages' manifests, the agents at work, the pull requests merged within the week, and the Linear issues still to do placed where their plan's agents worked",
    () =>
      Effect.gen(function* () {
        const acme = acmeInstallation(7301);
        const github = githubAndLinear(acme, new Map([["relay", RELAY_TREE]]));
        const owner = yield* openAccount;
        const teammate = yield* openAccount;
        const workspaceId = yield* openWorkspace(owner);
        yield* joinWorkspace(workspaceId, teammate);
        yield* connectWorkspaceGitHub(workspaceId, acme);
        yield* Database.use((db) =>
          db.insert(workspaceIntegrationConnection).values({
            organizationId: workspaceId,
            provider: INTEGRATION_PROVIDER.LINEAR,
            status: INTEGRATION_ROW_STATUS.CONNECTED,
          }),
        );
        const plan = yield* createTask(owner, {
          organizationId: workspaceId,
          name: "Invite expiry",
          repository: "acme/relay",
          linearIssue: {
            identifier: "ENG-7",
            title: "Issue ENG-7",
            url: "https://linear.app/acme/issue/ENG-7",
            description: "",
          },
        });
        const openPull = relayPull(11, PULL_REQUEST_STATE.OPEN, [
          { path: "packages/api/src/routes", additions: 20, deletions: 2 },
          { path: "apps/web/src", additions: 5, deletions: 0 },
        ]);
        const working = yield* openAgent(owner, workspaceId, {
          repository: "acme/relay",
          createdAt: NOW - MINUTE,
          taskId: plan.id,
          published: openPull,
        });
        const mergedPull = relayPull(
          12,
          PULL_REQUEST_STATE.MERGED,
          [{ path: "packages/core/src", additions: 25, deletions: 2 }],
          NOW - DAY,
        );
        const merged = yield* openAgent(teammate, workspaceId, {
          repository: "acme/relay",
          createdAt: NOW - 3 * DAY,
          archived: true,
          published: mergedPull,
        });
        // Merged before the week opened, so neither drawn nor counted.
        yield* openAgent(owner, workspaceId, {
          repository: "acme/relay",
          createdAt: NOW - 12 * DAY,
          archived: true,
          published: relayPull(13, PULL_REQUEST_STATE.MERGED, [], NOW - 10 * DAY),
        });
        // On the workspace's other repository, which fewer agents work in.
        yield* openAgent(owner, workspaceId, {
          repository: "acme/other",
          createdAt: NOW - 2 * MINUTE,
        });

        const world = worldOf(yield* ask(github, teammate, { workspaceId }));

        assert.deepEqual(world, {
          snapshotAt: NOW,
          shippedSince: NOW - 7 * DAY,
          repository: { fullName: "acme/relay", defaultBranch: "main" },
          zones: [
            {
              path: "packages/api/src/routes",
              label: "routes",
              files: 3,
              bytes: 520,
              dependsOn: ["packages/api"],
            },
            {
              path: "apps/web/src",
              label: "src",
              files: 1,
              bytes: 500,
              dependsOn: ["apps/web"],
            },
            {
              path: "packages/core/src",
              label: "src",
              files: 1,
              bytes: 400,
              dependsOn: ["packages/core"],
            },
            { path: ".", label: "relay-monorepo", files: 2, bytes: 150, dependsOn: [] },
            {
              path: "packages/api",
              label: "@relay/api",
              files: 1,
              bytes: 60,
              dependsOn: [".", "packages/core"],
            },
            {
              path: "packages/core",
              label: "@relay/core",
              files: 1,
              bytes: 40,
              dependsOn: ["."],
            },
            {
              path: "apps/web",
              label: "@relay/web",
              files: 1,
              bytes: 30,
              dependsOn: [".", "packages/api"],
            },
          ],
          agents: [
            {
              id: working,
              title: "Agent on acme/relay",
              status: CODING_AGENT_STATUS.STARTING,
              startedBy: { userId: owner, name: "Sam Okafor" },
              taskId: plan.id,
              activityAt: NOW - MINUTE,
              pullRequest: {
                number: 11,
                title: "Change 11",
                url: "https://github.com/acme/relay/pull/11",
                state: PULL_REQUEST_STATE.OPEN,
                checks: CHECK_SUMMARY.PASSING,
                additions: 25,
                deletions: 2,
                changedFiles: 3,
                areas: [
                  { path: "packages/api/src/routes", additions: 20, deletions: 2 },
                  { path: "apps/web/src", additions: 5, deletions: 0 },
                ],
              },
            },
          ],
          shipped: [
            {
              number: 12,
              title: "Change 12",
              url: "https://github.com/acme/relay/pull/12",
              mergedAt: NOW - DAY,
              additions: 25,
              deletions: 2,
              areas: [{ path: "packages/core/src", additions: 25, deletions: 2 }],
              agentId: merged,
            },
          ],
          planned: [
            {
              identifier: "ENG-7",
              title: "Issue ENG-7",
              url: "https://linear.app/acme/issue/ENG-7",
              state: "In Progress",
              priority: 1,
              zonePaths: ["packages/api/src/routes", "apps/web/src"],
            },
            {
              identifier: "ENG-9",
              title: "Issue ENG-9",
              url: "https://linear.app/acme/issue/ENG-9",
              state: "Todo",
              priority: 3,
              zonePaths: [],
            },
            {
              identifier: "ENG-8",
              title: "Issue ENG-8",
              url: "https://linear.app/acme/issue/ENG-8",
              priority: 0,
              zonePaths: [],
            },
          ],
          defects: [],
        });
        // One tree read and the four manifests that name a zone, and nothing of any pull request.
        assert.deepEqual(repositoryReads(github).sort(), [
          "/repos/acme/relay/contents/apps/web/package.json",
          "/repos/acme/relay/contents/package.json",
          "/repos/acme/relay/contents/packages/api/package.json",
          "/repos/acme/relay/contents/packages/core/package.json",
          "/repos/acme/relay/git/trees/main:",
        ]);
      }),
  );

  it.effect(
    "a workspace with no agent and no Linear draws the repository its installation reaches that changed last, empty but for its zones",
    () =>
      Effect.gen(function* () {
        const acme = acmeInstallation(7302);
        const github = githubAndLinear(acme, new Map([["other", [blob("README.md", 10)]]]));
        const owner = yield* openAccount;
        const workspaceId = yield* openWorkspace(owner);
        yield* connectWorkspaceGitHub(workspaceId, acme);

        const world = worldOf(yield* ask(github, owner, { workspaceId }));

        assert.deepEqual(world, {
          snapshotAt: NOW,
          shippedSince: NOW - 7 * DAY,
          repository: { fullName: "acme/other", defaultBranch: "main" },
          zones: [{ path: ".", label: "acme/other", files: 1, bytes: 10, dependsOn: [] }],
          agents: [],
          shipped: [],
          planned: [],
          defects: [],
        });
        assert.equal(
          github.sent.filter((sent) => sent.url === LINEAR_GRAPHQL_URL).length,
          0,
          "a workspace with no Linear asks Linear nothing",
        );
      }),
  );

  it.effect(
    "a workspace with no repository has no world, and an account outside a workspace is answered as though there were no such workspace",
    () =>
      Effect.gen(function* () {
        const acme = acmeInstallation(7303);
        const github = githubAndLinear(acme, new Map());
        const owner = yield* openAccount;
        const outsider = yield* openAccount;
        const bare = yield* openWorkspace(owner);
        const connected = yield* openWorkspace(owner);
        yield* connectWorkspaceGitHub(connected, acme);
        yield* openAgent(owner, connected, { repository: "acme/relay", createdAt: NOW });

        assert.deepEqual(worldOf(yield* ask(github, owner, { workspaceId: bare })), null);
        assert.deepEqual(yield* ask(github, outsider, { workspaceId: connected }), {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          body: { error: HOSTED_API_ERROR.NOT_FOUND },
        });
        assert.deepEqual(repositoryReads(github), []);
      }),
  );
});
