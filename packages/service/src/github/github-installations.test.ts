import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  GITHUB_ACCOUNT_TYPE,
  GITHUB_INSTALLATION_STATUS,
} from "@luke/database/github-installation-vocabulary";
import { listWorkspaces, workspaceOf } from "@luke/database/models/workspace-store";
import { member } from "@luke/database/schemas/auth";
import { githubInstallation } from "@luke/database/schemas/github-installation";
import { getTestDB, joinWorkspace, openWorkspace, WORKSPACE_ROLE } from "@luke/database/testing";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { openGithubUser } from "../testing/github-app-fake.js";
import {
  type ConnectedInstallation,
  installationsOfWorkspace,
  LINK_OUTCOME,
  linkInstallation,
  linkInstallationAs,
  setInstallationStatus,
} from "./github-installations.js";

/**
 * The installations connected to a workspace, as the store writes and reads
 * them on a real dialect: a workspace holds several, linked at once or one
 * after another, and is listed once with all of them; a link is keyed on the installation's GitHub
 * account, so a retry of the same installation changes nothing but its
 * names, a reinstall on the account moves the account's own row onto the new
 * installation within its workspace, and an account that stands for one
 * workspace is never taken by another, however the two race; the callback's
 * link reads the account's role again before it writes; a webhook's status
 * reaches its own installation alone; and a workspace's GitHub accounts are
 * read by its members and nobody else.
 *
 * The suite's tests share a database, so every installation and account is
 * one of its own. Synthetic ids and logins throughout.
 */

/** An installation on a GitHub account of its own, running. */
function freshInstallation(login = "octo-org"): ConnectedInstallation {
  return {
    installationId: randomInt(1, 2 ** 40),
    accountId: randomInt(1, 2 ** 40),
    accountLogin: login,
    accountType: GITHUB_ACCOUNT_TYPE.ORGANIZATION,
    suspended: false,
  };
}

/** The rows standing for the installations given, as the table holds them. */
const rowsOf = (...installationIds: readonly number[]) =>
  Database.use((db) =>
    db
      .select({
        organizationId: githubInstallation.organizationId,
        installationId: githubInstallation.installationId,
        accountLogin: githubInstallation.accountLogin,
        status: githubInstallation.status,
        createdAt: githubInstallation.createdAt,
      })
      .from(githubInstallation)
      .where(inArray(githubInstallation.installationId, [...installationIds]))
      .orderBy(asc(githubInstallation.installationId)),
  );

/** The rows standing for one GitHub account, however many installations it moved through. */
const rowsOfAccount = (accountId: number) =>
  Database.use((db) =>
    db
      .select({
        organizationId: githubInstallation.organizationId,
        installationId: githubInstallation.installationId,
        status: githubInstallation.status,
        createdAt: githubInstallation.createdAt,
      })
      .from(githubInstallation)
      .where(eq(githubInstallation.accountId, accountId)),
  );

it.layer(getTestDB())("a workspace's GitHub installations in the store", (it) => {
  it.effect(
    "a retried link of the same installation is linked again, keeps its first moment, and does not bring back one the webhook suspended",
    () =>
      Effect.gen(function* () {
        const workspace = yield* openWorkspace(yield* openGithubUser());
        const installation = freshInstallation();

        const first = yield* linkInstallation(workspace, installation);
        const [linked] = yield* rowsOf(installation.installationId);
        yield* setInstallationStatus(
          installation.installationId,
          GITHUB_INSTALLATION_STATUS.SUSPENDED,
        );
        yield* TestClock.adjust("1 hour");
        const again = yield* linkInstallation(workspace, {
          ...installation,
          accountLogin: "octo-renamed",
        });

        assert.deepEqual([first, again], [LINK_OUTCOME.LINKED, LINK_OUTCOME.LINKED]);
        assert.deepEqual(yield* rowsOf(installation.installationId), [
          {
            organizationId: workspace,
            installationId: installation.installationId,
            accountLogin: "octo-renamed",
            status: GITHUB_INSTALLATION_STATUS.SUSPENDED,
            createdAt: linked?.createdAt,
          },
        ]);
      }),
  );

  it.effect(
    "two workspaces linking the same installation at once leave it with exactly one of them",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const workspaces = [yield* openWorkspace(owner), yield* openWorkspace(owner)];
        const installation = freshInstallation();

        const outcomes = yield* Effect.forEach(
          workspaces,
          (workspace) => linkInstallation(workspace, installation),
          { concurrency: "unbounded" },
        );

        assert.deepEqual(
          [...outcomes].sort(),
          [LINK_OUTCOME.ALREADY_CONNECTED, LINK_OUTCOME.LINKED].sort(),
        );
        const winner = workspaces[outcomes.indexOf(LINK_OUTCOME.LINKED)];
        assert.deepEqual(
          (yield* rowsOfAccount(installation.accountId)).map((row) => row.organizationId),
          [winner],
        );
      }),
  );

  it.effect(
    "two installations on different accounts linked to one workspace at once both stand, and the workspace is listed once with both, the first linked first",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const workspace = yield* openWorkspace(owner);
        const first = freshInstallation("acme-org");
        yield* linkInstallation(workspace, first);
        yield* TestClock.adjust("1 minute");
        const racing = [freshInstallation("acme-labs"), freshInstallation("acme-tools")] as const;

        const outcomes = yield* Effect.forEach(
          racing,
          (installation) => linkInstallation(workspace, installation),
          { concurrency: "unbounded" },
        );

        assert.deepEqual(outcomes, [LINK_OUTCOME.LINKED, LINK_OUTCOME.LINKED]);
        const listed = (yield* listWorkspaces(owner)).filter((one) => one.id === workspace);
        assert.equal(listed.length, 1, "the workspace is listed once");
        const [shown] = listed;
        assert.deepEqual(shown?.github, { login: "acme-org", active: true });
        assert.deepEqual(
          shown?.githubInstallations?.map((one) => one.installationId),
          [
            first.installationId,
            ...racing.map((one) => one.installationId).sort((left, right) => left - right),
          ],
        );
        const read = yield* workspaceOf(owner, workspace);
        assert.deepEqual(
          Option.map(read, (one) => one.githubInstallations),
          Option.some(shown?.githubInstallations),
        );
      }),
  );

  it.effect(
    "a webhook suspending or removing one of a workspace's installations leaves the others active",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const workspace = yield* openWorkspace(owner);
        const kept = freshInstallation("acme-org");
        yield* linkInstallation(workspace, kept);
        yield* TestClock.adjust("1 minute");
        const suspended = freshInstallation("acme-labs");
        yield* linkInstallation(workspace, suspended);
        yield* TestClock.adjust("1 minute");
        const removed = freshInstallation("acme-tools");
        yield* linkInstallation(workspace, removed);

        yield* setInstallationStatus(
          suspended.installationId,
          GITHUB_INSTALLATION_STATUS.SUSPENDED,
        );
        yield* setInstallationStatus(removed.installationId, GITHUB_INSTALLATION_STATUS.DELETED);

        const read = yield* workspaceOf(owner, workspace);
        assert.deepEqual(
          Option.map(read, (one) =>
            one.githubInstallations?.map(({ login, active }) => [login, active]),
          ),
          Option.some([
            ["acme-org", true],
            ["acme-labs", false],
            ["acme-tools", false],
          ]),
        );
      }),
  );

  it.effect(
    "the one GitHub account a desktop from before several reads is the first linked still active, and the first linked where none is",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const workspace = yield* openWorkspace(owner);
        const lapsed = freshInstallation("acme-org");
        yield* linkInstallation(workspace, lapsed);
        yield* TestClock.adjust("1 minute");
        const running = freshInstallation("acme-labs");
        yield* linkInstallation(workspace, running);
        const legacy = () =>
          Effect.map(
            workspaceOf(owner, workspace),
            Option.map((one) => one.github),
          );

        yield* setInstallationStatus(lapsed.installationId, GITHUB_INSTALLATION_STATUS.SUSPENDED);
        const oneRunning = yield* legacy();
        yield* setInstallationStatus(running.installationId, GITHUB_INSTALLATION_STATUS.DELETED);
        const noneRunning = yield* legacy();

        assert.deepEqual(oneRunning, Option.some({ login: "acme-labs", active: true }));
        assert.deepEqual(noneRunning, Option.some({ login: "acme-org", active: false }));
      }),
  );

  it.effect(
    "a reinstall on the account moves its row onto the new installation within its workspace, keeping its first moment, and another workspace cannot take it",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const workspace = yield* openWorkspace(owner);
        const elsewhere = yield* openWorkspace(owner);
        const installation = freshInstallation();
        yield* linkInstallation(workspace, installation);
        yield* setInstallationStatus(
          installation.installationId,
          GITHUB_INSTALLATION_STATUS.DELETED,
        );
        const [before] = yield* rowsOfAccount(installation.accountId);
        yield* TestClock.adjust("1 hour");
        const reinstalled = { ...installation, installationId: installation.installationId + 1 };
        const stolen = { ...installation, installationId: installation.installationId + 2 };

        const moved = yield* linkInstallation(workspace, reinstalled);
        const refused = yield* linkInstallation(elsewhere, stolen);

        assert.deepEqual([moved, refused], [LINK_OUTCOME.LINKED, LINK_OUTCOME.ALREADY_CONNECTED]);
        assert.deepEqual(yield* rowsOfAccount(installation.accountId), [
          {
            organizationId: workspace,
            installationId: reinstalled.installationId,
            status: GITHUB_INSTALLATION_STATUS.ACTIVE,
            createdAt: before?.createdAt,
          },
        ]);
      }),
  );

  it.effect("an installation its account suspended is linked suspended, and listed inactive", () =>
    Effect.gen(function* () {
      const owner = yield* openGithubUser();
      const workspace = yield* openWorkspace(owner);
      const installation = { ...freshInstallation(), suspended: true };

      assert.equal(yield* linkInstallation(workspace, installation), LINK_OUTCOME.LINKED);

      assert.deepEqual(
        (yield* installationsOfWorkspace(workspace)).map(
          ({ installationId, accountLogin, status }) => ({ installationId, accountLogin, status }),
        ),
        [
          {
            installationId: installation.installationId,
            accountLogin: installation.accountLogin,
            status: GITHUB_INSTALLATION_STATUS.SUSPENDED,
          },
        ],
      );
    }),
  );

  it.effect(
    "the callback's link writes for an owner or an admin as their role stands at the write, and for a member or a stranger writes nothing",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const admin = yield* openGithubUser();
        const demoted = yield* openGithubUser();
        const teammate = yield* openGithubUser();
        const stranger = yield* openGithubUser();
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, admin, WORKSPACE_ROLE.ADMIN);
        yield* joinWorkspace(workspace, demoted, WORKSPACE_ROLE.ADMIN);
        yield* joinWorkspace(workspace, teammate, WORKSPACE_ROLE.MEMBER);
        yield* Database.use((db) =>
          db
            .update(member)
            .set({ role: WORKSPACE_ROLE.MEMBER })
            .where(and(eq(member.organizationId, workspace), eq(member.userId, demoted))),
        );
        const [asOwner, asAdmin, asDemoted, asTeammate, asStranger] = [
          freshInstallation(),
          freshInstallation(),
          freshInstallation(),
          freshInstallation(),
          freshInstallation(),
        ] as const;

        const outcomes = [
          yield* linkInstallationAs(owner, workspace, asOwner),
          yield* linkInstallationAs(admin, workspace, asAdmin),
          yield* linkInstallationAs(demoted, workspace, asDemoted),
          yield* linkInstallationAs(teammate, workspace, asTeammate),
          yield* linkInstallationAs(stranger, workspace, asStranger),
        ];

        assert.deepEqual(outcomes, [
          LINK_OUTCOME.LINKED,
          LINK_OUTCOME.LINKED,
          LINK_OUTCOME.NOT_PERMITTED,
          LINK_OUTCOME.NOT_PERMITTED,
          LINK_OUTCOME.NOT_PERMITTED,
        ]);
        assert.deepEqual(
          (yield* rowsOf(
            asDemoted.installationId,
            asTeammate.installationId,
            asStranger.installationId,
          )).length,
          0,
        );
      }),
  );

  it.effect("a webhook's status reaches the installation it names and no other workspace's", () =>
    Effect.gen(function* () {
      const owner = yield* openGithubUser();
      const first = freshInstallation();
      const second = freshInstallation();
      const firstWorkspace = yield* openWorkspace(owner);
      const secondWorkspace = yield* openWorkspace(owner);
      yield* linkInstallation(firstWorkspace, first);
      yield* linkInstallation(secondWorkspace, second);

      yield* setInstallationStatus(first.installationId, GITHUB_INSTALLATION_STATUS.DELETED);

      assert.deepEqual(
        (yield* rowsOf(first.installationId, second.installationId)).map((row) => [
          row.installationId,
          row.status,
        ]),
        [
          [first.installationId, GITHUB_INSTALLATION_STATUS.DELETED],
          [second.installationId, GITHUB_INSTALLATION_STATUS.ACTIVE],
        ].sort(([left], [right]) => Number(left) - Number(right)),
      );
    }),
  );

  it.effect(
    "a workspace's GitHub accounts are read by its members, and an account outside it reads no workspace at all",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const teammate = yield* openGithubUser();
        const stranger = yield* openGithubUser();
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate, WORKSPACE_ROLE.MEMBER);
        const installation = freshInstallation();
        yield* linkInstallation(workspace, installation);
        const connected = {
          github: { login: installation.accountLogin, active: true },
          githubInstallations: [
            {
              installationId: installation.installationId,
              login: installation.accountLogin,
              active: true,
            },
          ],
        };

        const asTeammate = yield* workspaceOf(teammate, workspace);
        const listed = (yield* listWorkspaces(teammate)).filter((one) => one.id === workspace);

        assert.ok(Option.isSome(asTeammate));
        assert.deepEqual(
          {
            github: asTeammate.value.github,
            githubInstallations: asTeammate.value.githubInstallations,
          },
          connected,
        );
        assert.deepEqual(
          listed.map(({ github, githubInstallations }) => ({ github, githubInstallations })),
          [connected],
        );
        assert.deepEqual(yield* workspaceOf(stranger, workspace), Option.none());
        assert.deepEqual(yield* listWorkspaces(stranger), []);
      }),
  );
});
