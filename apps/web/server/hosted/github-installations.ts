import { db } from "@sidecar/database/core/query";
import {
  GITHUB_ACCOUNT_TYPE,
  GITHUB_INSTALLATION_STATUS,
  type GitHubAccountType,
  type GitHubInstallationStatus,
} from "@sidecar/database/github-installation-vocabulary";
import type { WorkspaceSeams } from "@sidecar/database/models/workspace-seams";
import {
  createLinkedOrganization,
  memberOfWorkspace,
} from "@sidecar/database/models/workspace-store";
import { organization } from "@sidecar/database/schemas/auth";
import { githubInstallation } from "@sidecar/database/schemas/github-installation";
import type { AvailableWorkspace } from "@sidecar/hosted/workspace-wire";
import { and, asc, eq, inArray, ne, not, or } from "drizzle-orm";
import { type Cause, DateTime, Effect, Option, Schema } from "effect";
import type { HttpClient } from "effect/unstable/http";
import { type SqlClient, SqlSchema } from "effect/unstable/sql";
import { GitHubApp, type GitHubUserReadFailure } from "../github/github-app.js";
import type { StoreFailure } from "./store-failure.js";

/**
 * github-installations.ts -- the workspaces that stand for installations of the Luke GitHub App.
 *
 * A workspace beside an account's personal one is an installation of the
 * App, one `organization` per installation named and slugged for the account
 * it is on, and tied to it by a `github_installation` row keyed on GitHub's
 * own ids. A sync reads the installations the account's own GitHub token
 * reaches: one nobody made a workspace for yet becomes one, created through
 * the plugin's server-only write so the account that reached it first is its
 * owner, one that has a workspace has its login and kind refreshed, and a
 * new installation on an account an earlier one stood for takes over that
 * workspace, since GitHub gives a reinstall a new id. A
 * sync never adds or removes a member, since it would put back a member an
 * admin removed; a workspace of an installation the account reaches but is
 * not in is offered to it instead. The installation webhook keeps each
 * row's status: a workspace of an installation not active is listed as
 * inactive and offered to nobody.
 */

/** What an installation reached on the account's token is, as far as a workspace is made of it. */
interface ReachedInstallation {
  readonly installationId: number;
  readonly accountId: number;
  readonly accountLogin: string;
  readonly accountType: GitHubAccountType;
}

/** What a sync answers with: the installations the account's token reached that a workspace stands for, by GitHub's id. */
export type SyncedInstallations = readonly number[];

const findInstallation = SqlSchema.findOneOption({
  Request: Schema.Number,
  Result: Schema.Struct({ organizationId: Schema.String }),
  execute: (installationId) =>
    db
      .select({ organizationId: githubInstallation.organizationId })
      .from(githubInstallation)
      .where(eq(githubInstallation.installationId, installationId)),
});

const findInstallationOfAccount = SqlSchema.findOneOption({
  Request: Schema.Number,
  Result: Schema.Struct({ organizationId: Schema.String }),
  execute: (accountId) =>
    db
      .select({ organizationId: githubInstallation.organizationId })
      .from(githubInstallation)
      .where(eq(githubInstallation.accountId, accountId)),
});

const findLinkedInstallation = SqlSchema.findOneOption({
  Request: Schema.Struct({ organizationId: Schema.String, accountId: Schema.Number }),
  Result: Schema.Struct({ organizationId: Schema.String }),
  execute: ({ organizationId, accountId }) =>
    db
      .select({ organizationId: githubInstallation.organizationId })
      .from(githubInstallation)
      .where(
        and(
          eq(githubInstallation.organizationId, organizationId),
          eq(githubInstallation.accountId, accountId),
        ),
      ),
});

const moveInstallation = SqlSchema.void({
  Request: Schema.Struct({
    installationId: Schema.Number,
    accountId: Schema.Number,
    accountLogin: Schema.String,
    accountType: Schema.Literals(Object.values(GITHUB_ACCOUNT_TYPE)),
    now: Schema.Date,
  }),
  execute: (row) =>
    db
      .update(githubInstallation)
      .set({
        installationId: row.installationId,
        accountLogin: row.accountLogin,
        accountType: row.accountType,
        status: GITHUB_INSTALLATION_STATUS.ACTIVE,
        updatedAt: row.now,
      })
      .where(eq(githubInstallation.accountId, row.accountId)),
});

const refreshInstallationAccount = SqlSchema.void({
  Request: Schema.Struct({
    installationId: Schema.Number,
    accountLogin: Schema.String,
    accountType: Schema.Literals(Object.values(GITHUB_ACCOUNT_TYPE)),
    now: Schema.Date,
  }),
  execute: (row) =>
    db
      .update(githubInstallation)
      .set({ accountLogin: row.accountLogin, accountType: row.accountType, updatedAt: row.now })
      .where(
        and(
          eq(githubInstallation.installationId, row.installationId),
          // Note that a row already saying what GitHub says is left unwritten, so a sync that changes nothing writes nothing.
          or(
            ne(githubInstallation.accountLogin, row.accountLogin),
            ne(githubInstallation.accountType, row.accountType),
          ),
        ),
      ),
});

const insertInstallation = SqlSchema.void({
  Request: Schema.Struct({
    organizationId: Schema.String,
    installationId: Schema.Number,
    accountId: Schema.Number,
    accountLogin: Schema.String,
    accountType: Schema.Literals(Object.values(GITHUB_ACCOUNT_TYPE)),
    now: Schema.Date,
  }),
  execute: (row) =>
    db
      .insert(githubInstallation)
      .values({
        organizationId: row.organizationId,
        installationId: row.installationId,
        accountId: row.accountId,
        accountLogin: row.accountLogin,
        accountType: row.accountType,
        status: GITHUB_INSTALLATION_STATUS.ACTIVE,
        createdAt: row.now,
        updatedAt: row.now,
      })
      .onConflictDoNothing(),
});

const updateInstallationStatus = SqlSchema.void({
  Request: Schema.Struct({
    installationId: Schema.Number,
    status: Schema.Literals(Object.values(GITHUB_INSTALLATION_STATUS)),
    now: Schema.Date,
  }),
  execute: (row) =>
    db
      .update(githubInstallation)
      .set({ status: row.status, updatedAt: row.now })
      .where(eq(githubInstallation.installationId, row.installationId)),
});

const findAvailable = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, installationIds: Schema.Array(Schema.Number) }),
  Result: Schema.Struct({ installationId: Schema.Number, name: Schema.String }),
  execute: ({ userId, installationIds }) =>
    db
      .select({ installationId: githubInstallation.installationId, name: organization.name })
      .from(githubInstallation)
      .innerJoin(organization, eq(organization.id, githubInstallation.organizationId))
      .where(
        and(
          inArray(githubInstallation.installationId, [...installationIds]),
          eq(githubInstallation.status, GITHUB_INSTALLATION_STATUS.ACTIVE),
          not(memberOfWorkspace(userId, githubInstallation.organizationId)),
        ),
      )
      .orderBy(asc(organization.name), asc(githubInstallation.installationId)),
});

/**
 * The workspace one reached installation stands for: the one standing, its
 * login and kind refreshed; the one of an earlier installation on the same
 * GitHub account, which an uninstall and a reinstall leave behind, moved to
 * this installation and shown again with its members and its plans; or one
 * made now with the account as its owner, slugged with the login. Where
 * another account's sync made it first, the plugin refuses the slug and the
 * workspace under it is adopted without the account joining it; where an
 * organization of anyone else's holds the login as its slug, it is never
 * adopted, and the workspace is slugged with the login and the account's id.
 */
function syncInstallation(
  userId: string,
  reached: ReachedInstallation,
  seams: WorkspaceSeams,
): Effect.Effect<void, StoreFailure | Cause.UnknownError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const standing = yield* findInstallation(reached.installationId);
    if (Option.isSome(standing)) {
      return yield* refreshInstallationAccount({ ...reached, now });
    }
    const earlier = yield* findInstallationOfAccount(reached.accountId);
    if (Option.isSome(earlier)) return yield* moveInstallation({ ...reached, now });
    const organizationId = yield* createLinkedOrganization(
      { name: reached.accountLogin, userId, metadata: {} },
      [reached.accountLogin, `${reached.accountLogin}-${reached.accountId}`],
      (candidate) =>
        Effect.map(
          findLinkedInstallation({ organizationId: candidate, accountId: reached.accountId }),
          Option.isSome,
        ),
      seams,
    );
    yield* insertInstallation({ ...reached, organizationId, now });
  });
}

/**
 * Every installation of the App the account's GitHub token reaches made a
 * workspace or refreshed, in turn; an installation on an account of no
 * login or no known kind, an enterprise's, is passed over. Answers the
 * installations reached, which `listAvailableWorkspaces` reads against.
 */
export function syncInstallations(
  userId: string,
  seams: WorkspaceSeams,
): Effect.Effect<
  SyncedInstallations,
  GitHubUserReadFailure | Cause.UnknownError,
  SqlClient.SqlClient | HttpClient.HttpClient | GitHubApp
> {
  return Effect.gen(function* () {
    const app = yield* GitHubApp;
    const installations = yield* app.userInstallations(userId);
    const synced: number[] = [];
    for (const installation of installations) {
      const { accountLogin, accountId, accountType } = installation;
      if (accountLogin === undefined || accountId === undefined || accountType === undefined) {
        continue;
      }
      const reached = { installationId: installation.id, accountId, accountLogin, accountType };
      yield* syncInstallation(userId, reached, seams);
      synced.push(installation.id);
    }
    return synced;
  });
}

/** Where the installation now stands, as its webhook said; an installation no workspace stands for moves nothing. */
export function setInstallationStatus(
  installationId: number,
  status: GitHubInstallationStatus,
): Effect.Effect<void, StoreFailure, SqlClient.SqlClient> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    updateInstallationStatus({ installationId, status, now }),
  );
}

/** The workspaces of the installations given that the account may join: active, and not one it is a member of, by name. */
export function listAvailableWorkspaces(
  userId: string,
  installationIds: SyncedInstallations,
): Effect.Effect<readonly AvailableWorkspace[], StoreFailure, SqlClient.SqlClient> {
  if (installationIds.length === 0) return Effect.succeed([]);
  return findAvailable({ userId, installationIds });
}
