// admin-workspaces.test.ts -- the Workspaces tab's read: shared workspaces counted, listed by the week's activity, under the scope, kind, and search asked for.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database, type DatabaseServices } from "@luke/database/core/query";
import {
  GITHUB_ACCOUNT_TYPE,
  GITHUB_INSTALLATION_STATUS,
  type GitHubInstallationStatus,
} from "@luke/database/github-installation-vocabulary";
import {
  INTEGRATION_ROW_STATUS,
  type IntegrationRowStatus,
} from "@luke/database/integration-vocabulary";
import { invitation, member, organization, user } from "@luke/database/schemas/auth";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { githubInstallation } from "@luke/database/schemas/github-installation";
import { personalWorkspace } from "@luke/database/schemas/personal-workspace";
import { planRevision } from "@luke/database/schemas/plan-revision";
import { conversations } from "@luke/database/schemas/storage";
import { task } from "@luke/database/schemas/task";
import { workspaceIntegrationConnection } from "@luke/database/schemas/workspace-integration";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { getTestDB } from "@luke/database/testing";
import { INTEGRATION_PROVIDER, type IntegrationProvider } from "@luke/features/integration-wire";
import { PLAN_ACTOR } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type WorkspaceRole } from "@luke/features/workspace-wire";
import { Effect } from "effect";
import { describe, test } from "vitest";
import { USER_ROLE } from "./admin-access.js";
import {
  type AdminWorkspaceListSource,
  buildAdminWorkspaceList,
  INVITATION_STATUS,
} from "./admin-workspaces.js";
import { readAdminWorkspacesSource } from "./admin-workspaces-queries.js";
import {
  ADMIN_METRICS_SCOPE,
  ADMIN_WORKSPACES_KIND,
  type AdminMetricsScope,
  type AdminWorkspacesKind,
} from "./http.js";

/**
 * The read's builder over hand-made sources, its handler's refusal, and its
 * queries over a real dialect with a small world of synthetic accounts and
 * workspaces written straight over the plugin's tables. Every instant is
 * fixed against `NOW`, so the week the counts cover is the same on every run.
 */

const NOW = Date.UTC(2026, 9, 14, 12);

const DAY_MS = 86_400_000;

/** An instant `days` whole days before `NOW`; inside the week up to six. */
const daysAgo = (days: number) => new Date(NOW - days * DAY_MS);

const EMPTY_SUMMARY: AdminWorkspaceListSource["summary"] = {
  shared: 0,
  sharedActiveWeek: 0,
  sharedWithActive: 0,
  sharedWithSuspended: 0,
  invitations: [],
};

const OWNER = {
  id: "account-grace",
  name: "Grace Hopper",
  email: "grace@example.test",
  image: null,
  admin: false,
};

function source(overrides: Partial<AdminWorkspaceListSource> = {}): AdminWorkspaceListSource {
  return {
    total: 0,
    rows: [],
    owners: [],
    installations: [],
    integrations: [],
    summary: EMPTY_SUMMARY,
    ...overrides,
  };
}

describe("the workspaces builder", () => {
  test("an invitation settles once accepted or past its expiry, and the rate reads accepted over settled", () => {
    const list = buildAdminWorkspaceList(
      source({
        summary: {
          ...EMPTY_SUMMARY,
          invitations: [
            { status: INVITATION_STATUS.ACCEPTED, count: 6, pastExpiry: 2 },
            { status: INVITATION_STATUS.PENDING, count: 5, pastExpiry: 2 },
            { status: "canceled", count: 1, pastExpiry: 0 },
          ],
        },
      }),
      NOW,
      ADMIN_WORKSPACES_KIND.SHARED,
      undefined,
    );
    assert.deepEqual(list.summary.invitations, {
      accepted: 6,
      pending: 3,
      expired: 2,
      settled: 9,
      acceptanceRate: 6 / 9,
    });
  });

  test("a rate with nothing to share out is no rate rather than a zero", () => {
    const list = buildAdminWorkspaceList(
      source({
        summary: {
          ...EMPTY_SUMMARY,
          invitations: [{ status: INVITATION_STATUS.PENDING, count: 4, pastExpiry: 0 }],
        },
      }),
      NOW,
      ADMIN_WORKSPACES_KIND.SHARED,
      undefined,
    );
    assert.equal(list.summary.invitations.acceptanceRate, null);
    assert.equal(list.summary.invitations.pending, 4);
    assert.equal(list.summary.github.activeShare, null);
  });

  test("each row carries its first owner, its installations, and its integrations, and no other row's", () => {
    const row = {
      id: "workspace-a",
      name: "Northwind",
      personal: false,
      members: 3,
      tasksWeek: 1,
      agentsWeek: 2,
      prsMergedWeek: 0,
      createdAt: NOW,
    };
    const list = buildAdminWorkspaceList(
      source({
        total: 2,
        rows: [row, { ...row, id: "workspace-b", name: "Feldspar" }],
        owners: [
          { organizationId: "workspace-a", owner: OWNER },
          { organizationId: "workspace-a", owner: { ...OWNER, id: "account-later" } },
        ],
        installations: [
          {
            organizationId: "workspace-a",
            installation: { login: "northwind", status: GITHUB_INSTALLATION_STATUS.ACTIVE },
          },
        ],
        integrations: [
          {
            organizationId: "workspace-a",
            integration: {
              provider: INTEGRATION_PROVIDER.LINEAR,
              status: INTEGRATION_ROW_STATUS.CONNECTED,
            },
          },
        ],
        summary: { ...EMPTY_SUMMARY, shared: 4, sharedWithActive: 3 },
      }),
      NOW,
      ADMIN_WORKSPACES_KIND.SHARED,
      "north",
    );
    assert.equal(list.rows[0]?.owner?.id, OWNER.id);
    assert.deepEqual(list.rows[0]?.installations, [
      { login: "northwind", status: GITHUB_INSTALLATION_STATUS.ACTIVE },
    ]);
    assert.equal(list.rows[0]?.integrations.length, 1);
    assert.equal(list.rows[1]?.owner, null);
    assert.deepEqual(list.rows[1]?.installations, []);
    assert.deepEqual(list.rows[1]?.integrations, []);
    assert.equal(list.summary.github.activeShare, 3 / 4);
    assert.equal(list.search, "north");
  });
});

/* ----- The queries, over a real dialect ----- */

const insertAccount = (id: string, name: string, role: string = USER_ROLE.USER) =>
  Database.use((db) => db.insert(user).values({ id, name, email: `${id}@example.test`, role }));

/** A workspace with its members, the first its owner; answers its id. */
const insertWorkspace = (
  name: string,
  members: readonly string[],
  options: { personalOf?: string; createdAt?: Date } = {},
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    const createdAt = options.createdAt ?? daysAgo(60);
    yield* db.insert(organization).values({ id, name, slug: `workspace-${id}`, createdAt });
    for (const [index, userId] of members.entries()) {
      const role: WorkspaceRole = index === 0 ? WORKSPACE_ROLE.OWNER : WORKSPACE_ROLE.MEMBER;
      yield* db.insert(member).values({
        id: randomUUID(),
        organizationId: id,
        userId,
        role,
        createdAt: new Date(createdAt.getTime() + index),
      });
    }
    if (options.personalOf !== undefined) {
      yield* db
        .insert(personalWorkspace)
        .values({ userId: options.personalOf, organizationId: id, createdAt });
    }
    return id;
  });

/** The numbers the tasks below take, each its own whatever its workspace. */
let taskNumbers = 0;

/** A task in the workspace, its name and plan words no admin read may carry; answers its id. */
const insertTask = (organizationId: string, userId: string, createdAt: Date) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    taskNumbers += 1;
    yield* db.insert(task).values({
      id,
      organizationId,
      userId,
      number: taskNumbers,
      name: "Secret launch plan",
      document: "Confidential plan text.",
      createdAt,
      updatedAt: createdAt,
    });
    return id;
  });

const insertRevision = (taskId: string, userId: string, at: Date) =>
  Database.use((db) =>
    db.insert(planRevision).values({
      taskId,
      seq: 1,
      actor: PLAN_ACTOR.DEVELOPER,
      userId,
      document: "Confidential plan text, revised.",
      changes: 1,
      startedAt: at,
      at,
    }),
  );

/** A coding agent in the workspace, started at the instant, with the pull request it merged where one is given. */
const insertAgent = (
  organizationId: string,
  userId: string,
  createdAt: Date,
  merged?: { number: number; at: Date },
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const conversationId = randomUUID();
    yield* db
      .insert(conversations)
      .values({ id: conversationId, userId, kind: CONVERSATION_KIND.CODING_AGENT });
    yield* db.insert(codingAgent).values({
      organizationId,
      userId,
      conversationId,
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      prompt: "A prompt no admin read may carry.",
      title: "An agent title no admin read may carry",
      repository: "northwind/web",
      repositories: ["northwind/web"],
      idempotencyKey: randomUUID(),
      createdAt,
      ...(merged === undefined
        ? undefined
        : {
            published: {
              number: merged.number,
              title: "A pull request title",
              url: `https://github.com/northwind/web/pull/${merged.number}`,
              state: "merged",
              checks: "passing",
              additions: 1,
              deletions: 1,
              changedFiles: 1,
              mergedAt: merged.at.getTime(),
            },
          }),
    });
  });

const insertInstallation = (
  organizationId: string,
  login: string,
  status: GitHubInstallationStatus,
) =>
  Database.use((db) =>
    db.insert(githubInstallation).values({
      installationId: Math.floor(Math.random() * 1_000_000_000),
      organizationId,
      accountId: Math.floor(Math.random() * 1_000_000_000),
      accountLogin: login,
      accountType: GITHUB_ACCOUNT_TYPE.ORGANIZATION,
      status,
      createdAt: daysAgo(30),
      updatedAt: daysAgo(30),
    }),
  );

const insertIntegration = (
  organizationId: string,
  provider: IntegrationProvider,
  status: IntegrationRowStatus,
) =>
  Database.use((db) =>
    db.insert(workspaceIntegrationConnection).values({
      organizationId,
      provider,
      status,
      updatedAt: daysAgo(10),
    }),
  );

const insertInvitation = (
  organizationId: string,
  inviterId: string,
  status: string,
  expiresAt: Date,
) =>
  Database.use((db) =>
    db.insert(invitation).values({
      id: randomUUID(),
      organizationId,
      email: `${randomUUID()}@example.test`,
      status,
      expiresAt,
      createdAt: daysAgo(20),
      inviterId,
    }),
  );

/**
 * Three shared workspaces of ordinary accounts, busiest to idle; one only
 * admins share; and the workspaces that are not shared: a personal one with
 * a guest in it, an admin's personal one, and a team of one.
 */
const seedWorld = Effect.gen(function* () {
  yield* insertAccount("grace", "Grace Hopper");
  yield* insertAccount("linus", "Linus Torvalds");
  yield* insertAccount("margaret", "Margaret Hamilton");
  yield* insertAccount("ada", "Ada Lovelace", USER_ROLE.ADMIN);
  yield* insertAccount("alan", "Alan Turing", USER_ROLE.ADMIN);

  const northwind = yield* insertWorkspace("Northwind", ["grace", "linus", "margaret"]);
  yield* insertTask(northwind, "grace", daysAgo(1));
  yield* insertTask(northwind, "linus", daysAgo(6));
  yield* insertTask(northwind, "grace", daysAgo(40));
  yield* insertAgent(northwind, "grace", daysAgo(1), { number: 7, at: daysAgo(1) });
  // A continued agent publishes the same pull request, which counts once.
  yield* insertAgent(northwind, "grace", daysAgo(1), { number: 7, at: daysAgo(1) });
  yield* insertAgent(northwind, "linus", daysAgo(2), { number: 8, at: daysAgo(0) });
  yield* insertAgent(northwind, "linus", daysAgo(30), { number: 3, at: daysAgo(29) });
  yield* insertInstallation(northwind, "northwind", GITHUB_INSTALLATION_STATUS.ACTIVE);
  yield* insertIntegration(northwind, INTEGRATION_PROVIDER.NOTION, INTEGRATION_ROW_STATUS.EXPIRED);
  yield* insertIntegration(
    northwind,
    INTEGRATION_PROVIDER.LINEAR,
    INTEGRATION_ROW_STATUS.CONNECTED,
  );
  yield* insertIntegration(northwind, INTEGRATION_PROVIDER.SLACK, INTEGRATION_ROW_STATUS.PENDING);
  yield* insertInvitation(northwind, "grace", INVITATION_STATUS.ACCEPTED, daysAgo(10));
  yield* insertInvitation(northwind, "grace", INVITATION_STATUS.ACCEPTED, daysAgo(-5));
  yield* insertInvitation(northwind, "grace", INVITATION_STATUS.PENDING, daysAgo(-3));
  yield* insertInvitation(northwind, "grace", INVITATION_STATUS.PENDING, daysAgo(2));

  // Only a plan revised this week, on a task from long ago.
  const feldspar = yield* insertWorkspace("Feldspar", ["linus", "grace"]);
  const oldTask = yield* insertTask(feldspar, "linus", daysAgo(50));
  yield* insertRevision(oldTask, "linus", daysAgo(3));
  yield* insertInstallation(feldspar, "feldspar-io", GITHUB_INSTALLATION_STATUS.SUSPENDED);

  yield* insertWorkspace("Quiet Co", ["margaret", "grace"], { createdAt: daysAgo(5) });

  const maintainers = yield* insertWorkspace("Maintainers", ["ada", "alan"]);
  for (const day of [0, 1, 2, 3, 4]) yield* insertTask(maintainers, "ada", daysAgo(day));
  yield* insertInstallation(maintainers, "luke-maintainers", GITHUB_INSTALLATION_STATUS.ACTIVE);
  yield* insertInvitation(maintainers, "ada", INVITATION_STATUS.ACCEPTED, daysAgo(10));

  const gracePersonal = yield* insertWorkspace("grace-personal", ["grace", "linus"], {
    personalOf: "grace",
  });
  yield* insertTask(gracePersonal, "grace", daysAgo(0));
  yield* insertWorkspace("ada-personal", ["ada"], { personalOf: "ada" });
  yield* insertWorkspace("Solo", ["margaret"]);
});

const read = (
  scope: AdminMetricsScope,
  kind: AdminWorkspacesKind = ADMIN_WORKSPACES_KIND.SHARED,
  search?: string,
) =>
  Effect.map(readAdminWorkspacesSource({ now: NOW, scope, kind, search }), (listed) =>
    buildAdminWorkspaceList(listed, NOW, kind, search),
  );

/**
 * One test against a world of its own: each opens its own database, so it
 * passes alone and in any order.
 */
function inSeededWorld(name: string, check: Effect.Effect<void, unknown, DatabaseServices>): void {
  it.layer(getTestDB())(name, (it) => {
    it.effect("reads the seeded world", () => Effect.andThen(seedWorld, check));
  });
}

inSeededWorld(
  "counts and lists shared workspaces by the week's activity, hiding admins' own",
  Effect.gen(function* () {
    const list = yield* read(ADMIN_METRICS_SCOPE.NON_ADMINS);

    assert.deepEqual(
      list.rows.map((row) => row.name),
      ["Northwind", "Feldspar", "Quiet Co"],
    );
    assert.equal(list.total, 3);
    const northwind = list.rows[0];
    assert.equal(northwind?.owner?.name, "Grace Hopper");
    assert.equal(northwind?.members, 3);
    assert.equal(northwind?.tasksWeek, 2);
    assert.equal(northwind?.agentsWeek, 3);
    assert.equal(northwind?.prsMergedWeek, 2);
    assert.deepEqual(northwind?.installations, [
      { login: "northwind", status: GITHUB_INSTALLATION_STATUS.ACTIVE },
    ]);
    assert.deepEqual(northwind?.integrations, [
      { provider: INTEGRATION_PROVIDER.LINEAR, status: INTEGRATION_ROW_STATUS.CONNECTED },
      { provider: INTEGRATION_PROVIDER.NOTION, status: INTEGRATION_ROW_STATUS.EXPIRED },
    ]);

    assert.deepEqual(list.summary, {
      shared: 3,
      sharedActiveWeek: 2,
      invitations: { accepted: 2, pending: 1, expired: 1, settled: 3, acceptanceRate: 2 / 3 },
      github: { sharedWithActive: 1, sharedWithSuspended: 1, activeShare: 1 / 3 },
    });

    // Names of workspaces and accounts are the read's; what members wrote never is.
    const answered = JSON.stringify(list);
    for (const written of ["Secret launch plan", "Confidential", "prompt", "title"]) {
      assert.equal(answered.includes(written), false, written);
    }
  }),
);

inSeededWorld(
  "every account's scope counts the admins' workspace too",
  Effect.gen(function* () {
    const list = yield* read(ADMIN_METRICS_SCOPE.ALL);
    assert.deepEqual(
      list.rows.map((row) => row.name),
      ["Northwind", "Maintainers", "Feldspar", "Quiet Co"],
    );
    assert.equal(list.rows[1]?.owner?.admin, true);
    assert.equal(list.summary.shared, 4);
    assert.equal(list.summary.github.sharedWithActive, 2);
    assert.equal(list.summary.invitations.accepted, 3);
  }),
);

inSeededWorld(
  "every workspace lists the personal ones under their owner's name, and the team of one",
  Effect.gen(function* () {
    const all = yield* read(ADMIN_METRICS_SCOPE.NON_ADMINS, ADMIN_WORKSPACES_KIND.ALL);
    assert.equal(all.total, 5);
    const personal = all.rows.find((row) => row.personal);
    assert.equal(personal?.name, "Grace Hopper");
    assert.ok(all.rows.some((row) => row.name === "Solo"));
    // The headline counts read shared workspaces whatever the table lists.
    assert.equal(all.summary.shared, 3);
  }),
);

inSeededWorld(
  "a search narrows the rows and the total by the name members read",
  Effect.gen(function* () {
    const shared = yield* read(
      ADMIN_METRICS_SCOPE.NON_ADMINS,
      ADMIN_WORKSPACES_KIND.SHARED,
      "NORTH",
    );
    assert.deepEqual(
      shared.rows.map((row) => row.name),
      ["Northwind"],
    );
    assert.equal(shared.total, 1);

    const personal = yield* read(
      ADMIN_METRICS_SCOPE.NON_ADMINS,
      ADMIN_WORKSPACES_KIND.ALL,
      "hopper",
    );
    assert.deepEqual(
      personal.rows.map((row) => row.name),
      ["Grace Hopper"],
    );

    const wildcard = yield* read(ADMIN_METRICS_SCOPE.NON_ADMINS, ADMIN_WORKSPACES_KIND.ALL, "%");
    assert.equal(wildcard.total, 0);
  }),
);
