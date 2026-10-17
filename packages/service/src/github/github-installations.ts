import { createHash, randomBytes } from "node:crypto";
import { Database, type DatabaseServices } from "@luke/database/core/query";
import {
  GITHUB_ACCOUNT_TYPE,
  GITHUB_INSTALLATION_STATUS,
  type GitHubAccountType,
  type GitHubInstallationStatus,
} from "@luke/database/github-installation-vocabulary";
import { roleOf, WORKSPACE_NAME } from "@luke/database/models/workspace-store";
import { member, organization } from "@luke/database/schemas/auth";
import { githubInstallIntent } from "@luke/database/schemas/github-install-intent";
import { githubInstallation } from "@luke/database/schemas/github-installation";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { and, asc, eq, gt, ne, sql } from "drizzle-orm";
import { DateTime, Duration, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import type { StoreFailure } from "../http/store-failure.js";

/**
 * github-installations.ts -- the GitHub App installations connected to a workspace.
 *
 * A workspace's repositories come from the installations of the Luke GitHub
 * App connected to it and from nothing else; an owner or admin connects
 * each, tied to it by a `github_installation` row keyed on GitHub's own ids.
 * A workspace may hold several, one per GitHub account, and an
 * installation, and so its GitHub account, stands for exactly one
 * workspace: connecting another adds it beside those standing, and an
 * installation already standing for another workspace is refused there
 * rather than moved. A connect is an intent first: a random state bound to
 * the account and the workspace, stored only as its SHA-256, carried to
 * GitHub on the install address. At the Setup URL the installation GitHub
 * named and a PKCE code verifier are written on it, and it is spent once
 * GitHub returns the browser from a one-time authorization of the App, where
 * the installation is linked only after the user who authorized shows they
 * can see it (`github-install-app.ts`) and only while they are still an
 * owner or admin of the workspace. The installation webhook keeps each
 * row's status, by installation, and any read of an installation from
 * GitHub mends a status the webhook missed (`github-app.ts`). Which
 * installations and repositories a workspace holds is managed on GitHub,
 * and Luke deletes no row of its own accord: a row leaves with its
 * workspace.
 */

/** The roles that connect GitHub to a workspace: an owner or an admin. */
export const GITHUB_CONNECT_ROLES: ReadonlySet<string> = new Set([
  WORKSPACE_ROLE.OWNER,
  WORKSPACE_ROLE.ADMIN,
]);

/** How long a connect intent stands: room to choose an organization and its repositories on GitHub. */
const INTENT_LIFETIME = Duration.hours(1);

/** The random bytes a connect intent's state is spelled from. */
const STATE_BYTES = 32;

/** The installation a connect links: GitHub's ids for it and its account, as the account's token read them, and whether its account suspended it. */
export interface ConnectedInstallation {
  readonly installationId: number;
  readonly accountId: number;
  readonly accountLogin: string;
  readonly accountType: GitHubAccountType;
  readonly suspended: boolean;
}

/**
 * What a link settles on: linked; refused because the installation's
 * GitHub account already stands for another workspace; or refused because
 * the account linking is no longer an owner or admin of the workspace.
 */
export const LINK_OUTCOME = {
  LINKED: "linked",
  ALREADY_CONNECTED: "already-connected",
  NOT_PERMITTED: "not-permitted",
} as const;

export type LinkOutcome = (typeof LINK_OUTCOME)[keyof typeof LINK_OUTCOME];

/** The intent a state stands for, once spent: the account that asked, the workspace it asked for, and what the Setup URL wrote on it. */
export interface ConnectIntent {
  readonly userId: string;
  readonly organizationId: string;
  readonly installationId: number | null;
  readonly codeVerifier: string | null;
}

const InstallationStatusSchema = Schema.Literals(Object.values(GITHUB_INSTALLATION_STATUS));

/** A state's stored form. */
function stateHashOf(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

const insertIntent = SqlSchema.void({
  Request: Schema.Struct({
    stateHash: Schema.String,
    userId: Schema.String,
    organizationId: Schema.String,
    expiresAt: Schema.Date,
    now: Schema.Date,
  }),
  execute: (row) =>
    Database.use((db) =>
      db.insert(githubInstallIntent).values({
        stateHash: row.stateHash,
        userId: row.userId,
        organizationId: row.organizationId,
        expiresAt: row.expiresAt,
        createdAt: row.now,
      }),
    ),
});

const recordAuthorization = SqlSchema.findOneOption({
  Request: Schema.Struct({
    stateHash: Schema.String,
    installationId: Schema.Number,
    codeVerifier: Schema.String,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ stateHash: Schema.String }),
  execute: ({ stateHash, installationId, codeVerifier, now }) =>
    Database.use((db) =>
      db
        .update(githubInstallIntent)
        .set({ installationId, codeVerifier })
        .where(
          and(eq(githubInstallIntent.stateHash, stateHash), gt(githubInstallIntent.expiresAt, now)),
        )
        .returning({ stateHash: githubInstallIntent.stateHash }),
    ),
});

const deleteIntent = SqlSchema.findOneOption({
  Request: Schema.Struct({ stateHash: Schema.String, now: Schema.Date }),
  Result: Schema.Struct({
    userId: Schema.String,
    organizationId: Schema.String,
    installationId: Schema.NullOr(Schema.Number),
    codeVerifier: Schema.NullOr(Schema.String),
  }),
  execute: ({ stateHash, now }) =>
    Database.use((db) =>
      db
        .delete(githubInstallIntent)
        .where(
          and(eq(githubInstallIntent.stateHash, stateHash), gt(githubInstallIntent.expiresAt, now)),
        )
        .returning({
          userId: githubInstallIntent.userId,
          organizationId: githubInstallIntent.organizationId,
          installationId: githubInstallIntent.installationId,
          codeVerifier: githubInstallIntent.codeVerifier,
        }),
    ),
});

/**
 * The installation written to the workspace in one statement, keyed on its
 * GitHub account: a new account's row is added beside the workspace's
 * others; the account's own row, where it stands for this workspace, takes
 * the installation's id, which a reinstall on the account changes, and its
 * login and kind; and a row standing for any other workspace is left as it
 * is and answers nothing. The row keeps the moment it was first linked, and
 * a relink of the installation it already holds keeps the status last
 * written, so a callback's read of an installation since suspended does not
 * bring it back.
 */
const upsertInstallation = SqlSchema.findOneOption({
  Request: Schema.Struct({
    organizationId: Schema.String,
    installationId: Schema.Number,
    accountId: Schema.Number,
    accountLogin: Schema.String,
    accountType: Schema.Literals(Object.values(GITHUB_ACCOUNT_TYPE)),
    status: InstallationStatusSchema,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ installationId: Schema.Number }),
  execute: (row) =>
    Database.use((db) =>
      db
        .insert(githubInstallation)
        .values({
          organizationId: row.organizationId,
          installationId: row.installationId,
          accountId: row.accountId,
          accountLogin: row.accountLogin,
          accountType: row.accountType,
          status: row.status,
          createdAt: row.now,
          updatedAt: row.now,
        })
        .onConflictDoUpdate({
          target: githubInstallation.accountId,
          set: {
            installationId: row.installationId,
            accountLogin: row.accountLogin,
            accountType: row.accountType,
            status: sql`case when ${githubInstallation.installationId} = ${row.installationId} then ${githubInstallation.status} else ${row.status} end`,
            updatedAt: row.now,
          },
          setWhere: eq(githubInstallation.organizationId, row.organizationId),
        })
        .returning({ installationId: githubInstallation.installationId }),
    ),
});

/** The account's role text in the workspace, its member row held against a change until the transaction ends. */
const lockMemberRole = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, organizationId: Schema.String }),
  Result: Schema.Struct({ role: Schema.String }),
  execute: ({ userId, organizationId }) =>
    Database.use((db) =>
      db
        .select({ role: member.role })
        .from(member)
        .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
        .limit(1)
        .for("share"),
    ),
});

const findMemberWorkspaceOnOwner = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    owner: Schema.String,
    excludingOrganizationId: Schema.String,
  }),
  Result: Schema.Struct({ id: Schema.String, name: Schema.String }),
  execute: ({ userId, owner, excludingOrganizationId }) =>
    Database.use((db) =>
      db
        .select({ id: organization.id, name: WORKSPACE_NAME })
        .from(githubInstallation)
        .innerJoin(organization, eq(organization.id, githubInstallation.organizationId))
        .innerJoin(member, eq(member.organizationId, githubInstallation.organizationId))
        .where(
          and(
            eq(member.userId, userId),
            ne(githubInstallation.organizationId, excludingOrganizationId),
            eq(githubInstallation.status, GITHUB_INSTALLATION_STATUS.ACTIVE),
            sql`lower(${githubInstallation.accountLogin}) = lower(${owner})`,
          ),
        )
        .limit(1),
    ),
});

const findInstallationsOfWorkspace = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({
    installationId: Schema.Number,
    accountLogin: Schema.String,
    status: InstallationStatusSchema,
    updatedAt: Schema.Date,
  }),
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({
          installationId: githubInstallation.installationId,
          accountLogin: githubInstallation.accountLogin,
          status: githubInstallation.status,
          updatedAt: githubInstallation.updatedAt,
        })
        .from(githubInstallation)
        .where(eq(githubInstallation.organizationId, organizationId))
        .orderBy(asc(githubInstallation.createdAt), asc(githubInstallation.installationId)),
    ),
});

const updateInstallationStatus = SqlSchema.void({
  Request: Schema.Struct({
    installationId: Schema.Number,
    status: Schema.Literals(Object.values(GITHUB_INSTALLATION_STATUS)),
    now: Schema.Date,
  }),
  execute: (row) =>
    Database.use((db) =>
      db
        .update(githubInstallation)
        .set({ status: row.status, updatedAt: row.now })
        .where(eq(githubInstallation.installationId, row.installationId)),
    ),
});

const mendStatus = SqlSchema.void({
  Request: Schema.Struct({
    installationId: Schema.Number,
    status: Schema.Literals(Object.values(GITHUB_INSTALLATION_STATUS)),
    readAt: Schema.Date,
    now: Schema.Date,
  }),
  execute: (row) =>
    Database.use((db) =>
      db
        .update(githubInstallation)
        .set({ status: row.status, updatedAt: row.now })
        .where(
          and(
            eq(githubInstallation.installationId, row.installationId),
            eq(githubInstallation.updatedAt, row.readAt),
          ),
        ),
    ),
});

/** A new connect intent for the account and the workspace; answers the state the install address carries, which nothing stores. */
export function createConnectIntent(
  userId: string,
  organizationId: string,
): Effect.Effect<string, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const state = randomBytes(STATE_BYTES).toString("base64url");
    const now = yield* DateTime.now;
    yield* insertIntent({
      stateHash: stateHashOf(state),
      userId,
      organizationId,
      expiresAt: DateTime.toDateUtc(DateTime.addDuration(now, INTENT_LIFETIME)),
      now: DateTime.toDateUtc(now),
    });
    return state;
  });
}

/**
 * Writes on the intent a state stands for the installation GitHub named and
 * the PKCE code verifier of the authorization that confirms it; false for a
 * state unknown, spent, or expired.
 */
export function recordConnectAuthorization(
  state: string,
  installationId: number,
  codeVerifier: string,
): Effect.Effect<boolean, StoreFailure, DatabaseServices> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(
      recordAuthorization({ stateHash: stateHashOf(state), installationId, codeVerifier, now }),
      Option.isSome,
    ),
  );
}

/** The intent a state stands for, spent so it never links twice; nothing for a state unknown, already spent, or expired. */
export function spendConnectIntent(
  state: string,
): Effect.Effect<Option.Option<ConnectIntent>, StoreFailure, DatabaseServices> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    deleteIntent({ stateHash: stateHashOf(state), now }),
  );
}

/**
 * The installation linked to the workspace beside any it holds, or the
 * workspace's row for the same GitHub account moved onto it; refused where
 * that account already stands for another workspace, which keeps it.
 */
export function linkInstallation(
  organizationId: string,
  installation: ConnectedInstallation,
): Effect.Effect<LinkOutcome, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const { suspended, ...ids } = installation;
    const status = suspended
      ? GITHUB_INSTALLATION_STATUS.SUSPENDED
      : GITHUB_INSTALLATION_STATUS.ACTIVE;
    const written = yield* upsertInstallation({ organizationId, ...ids, status, now });
    return Option.isSome(written) ? LINK_OUTCOME.LINKED : LINK_OUTCOME.ALREADY_CONNECTED;
  });
}

/**
 * The link a connect's callback makes for the account that asked: the
 * account's role read again, its member row held until the write commits,
 * because GitHub's authorization ran in between, and the installation
 * linked only where the account is still an owner or admin.
 */
export function linkInstallationAs(
  userId: string,
  organizationId: string,
  installation: ConnectedInstallation,
): Effect.Effect<LinkOutcome, StoreFailure, DatabaseServices> {
  const checked = Effect.gen(function* () {
    const standing = yield* lockMemberRole({ userId, organizationId });
    if (Option.isNone(standing) || !GITHUB_CONNECT_ROLES.has(roleOf(standing.value.role))) {
      return LINK_OUTCOME.NOT_PERMITTED;
    }
    return yield* linkInstallation(organizationId, installation);
  });
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(checked));
}

/** Where the installation now stands, as its webhook said; an installation no workspace is connected to moves nothing. */
export function setInstallationStatus(
  installationId: number,
  status: GitHubInstallationStatus,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    updateInstallationStatus({ installationId, status, now }),
  );
}

/**
 * Where the installation stands as a read from GitHub found it, written
 * only where its row has not moved since it was read: a webhook or a connect
 * that landed while GitHub was being asked is newer than the read, so the
 * read leaves it be.
 */
export function mendInstallationStatus(
  read: WorkspaceInstallation,
  status: GitHubInstallationStatus,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    mendStatus({ installationId: read.installationId, status, readAt: read.updatedAt, now }),
  );
}

/** One installation connected to the workspace as Luke last stored it: its account's login, its status, and when the row last moved. */
export interface WorkspaceInstallation {
  readonly installationId: number;
  readonly accountLogin: string;
  readonly status: GitHubInstallationStatus;
  readonly updatedAt: Date;
}

/** Every installation connected to the workspace, whatever its status, the first linked first; none for a workspace with none connected. */
export function installationsOfWorkspace(
  organizationId: string,
): Effect.Effect<readonly WorkspaceInstallation[], StoreFailure, DatabaseServices> {
  return findInstallationsOfWorkspace(organizationId);
}

/**
 * The workspace, other than the one given, whose active installation is on
 * the GitHub account given, where the account asking is a member of it:
 * where a task of the one given could move to reach that account's
 * repositories. A GitHub account's installation stands for one workspace,
 * so there is at most one.
 */
export function memberWorkspaceOnOwner(
  userId: string,
  owner: string,
  excludingOrganizationId: string,
): Effect.Effect<Option.Option<{ id: string; name: string }>, StoreFailure, DatabaseServices> {
  return findMemberWorkspaceOnOwner({ userId, owner, excludingOrganizationId });
}
