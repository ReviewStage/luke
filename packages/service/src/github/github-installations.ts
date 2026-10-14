import { createHash, randomBytes } from "node:crypto";
import { Database, type DatabaseServices } from "@luke/database/core/query";
import {
  GITHUB_ACCOUNT_TYPE,
  GITHUB_INSTALLATION_STATUS,
  type GitHubAccountType,
  type GitHubInstallationStatus,
} from "@luke/database/github-installation-vocabulary";
import { member, organization } from "@luke/database/schemas/auth";
import { githubInstallIntent } from "@luke/database/schemas/github-install-intent";
import { githubInstallation } from "@luke/database/schemas/github-installation";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { and, eq, gt, ne, or, sql } from "drizzle-orm";
import { DateTime, Duration, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import type { StoreFailure } from "../http/store-failure.js";

/**
 * github-installations.ts -- the GitHub App installation connected to a workspace.
 *
 * A workspace's repositories come from the one installation of the Luke
 * GitHub App connected to it and from nothing else; an owner or admin
 * connects it, tied to it by a
 * `github_installation` row keyed on GitHub's own ids. One installation, and
 * so one GitHub account, stands for one workspace. A connect is an intent
 * first: a random state bound to the account and the workspace, stored only
 * as its SHA-256, carried to GitHub on the install address. At the Setup URL
 * the installation GitHub named and a PKCE code verifier are written on it,
 * and it is spent once GitHub returns the browser from a one-time
 * authorization of the App, where the installation is linked only after the
 * user who authorized shows they can see it (`github-install-app.ts`). The installation webhook keeps each row's
 * status, and a disconnect deletes the row, which is Luke's own, and the
 * workspace's outstanding intents with it.
 */

/** The roles that connect and disconnect a workspace's GitHub organization: an owner or an admin. */
export const GITHUB_CONNECT_ROLES: ReadonlySet<string> = new Set([
  WORKSPACE_ROLE.OWNER,
  WORKSPACE_ROLE.ADMIN,
]);

/** How long a connect intent stands: room to choose an organization and its repositories on GitHub. */
const INTENT_LIFETIME = Duration.hours(1);

/** The random bytes a connect intent's state is spelled from. */
const STATE_BYTES = 32;

/** The installation a connect links: GitHub's ids for it and its account, as the account's token read them. */
export interface ConnectedInstallation {
  readonly installationId: number;
  readonly accountId: number;
  readonly accountLogin: string;
  readonly accountType: GitHubAccountType;
}

/** What a link settles on: linked, or refused because the installation already stands for another workspace. */
export const LINK_OUTCOME = {
  LINKED: "linked",
  ALREADY_CONNECTED: "already-connected",
} as const;

export type LinkOutcome = (typeof LINK_OUTCOME)[keyof typeof LINK_OUTCOME];

/** The intent a state stands for, once spent: the account that asked, the workspace it asked for, and what the Setup URL wrote on it. */
export interface ConnectIntent {
  readonly userId: string;
  readonly organizationId: string;
  readonly installationId: number | null;
  readonly codeVerifier: string | null;
}

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

const findLinkedElsewhere = SqlSchema.findOneOption({
  Request: Schema.Struct({
    organizationId: Schema.String,
    installationId: Schema.Number,
    accountId: Schema.Number,
  }),
  Result: Schema.Struct({ organizationId: Schema.String }),
  execute: ({ organizationId, installationId, accountId }) =>
    Database.use((db) =>
      db
        .select({ organizationId: githubInstallation.organizationId })
        .from(githubInstallation)
        .where(
          and(
            ne(githubInstallation.organizationId, organizationId),
            or(
              eq(githubInstallation.installationId, installationId),
              eq(githubInstallation.accountId, accountId),
            ),
          ),
        )
        .limit(1),
    ),
});

const upsertInstallation = SqlSchema.void({
  Request: Schema.Struct({
    organizationId: Schema.String,
    installationId: Schema.Number,
    accountId: Schema.Number,
    accountLogin: Schema.String,
    accountType: Schema.Literals(Object.values(GITHUB_ACCOUNT_TYPE)),
    now: Schema.Date,
  }),
  execute: (row) => {
    const linked = {
      installationId: row.installationId,
      accountId: row.accountId,
      accountLogin: row.accountLogin,
      accountType: row.accountType,
      status: GITHUB_INSTALLATION_STATUS.ACTIVE,
      updatedAt: row.now,
    };
    return Database.use((db) =>
      db
        .insert(githubInstallation)
        .values({ organizationId: row.organizationId, ...linked, createdAt: row.now })
        .onConflictDoUpdate({ target: githubInstallation.organizationId, set: linked }),
    );
  },
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
        .select({ id: organization.id, name: organization.name })
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

const findInstallationOfWorkspace = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ installationId: Schema.Number }),
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({ installationId: githubInstallation.installationId })
        .from(githubInstallation)
        .where(eq(githubInstallation.organizationId, organizationId)),
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

const deleteInstallation = SqlSchema.void({
  Request: Schema.String,
  execute: (organizationId) =>
    Database.use((db) =>
      db.delete(githubInstallation).where(eq(githubInstallation.organizationId, organizationId)),
    ),
});

const deleteWorkspaceIntents = SqlSchema.void({
  Request: Schema.String,
  execute: (organizationId) =>
    Database.use((db) =>
      db.delete(githubInstallIntent).where(eq(githubInstallIntent.organizationId, organizationId)),
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
 * The installation linked to the workspace, replacing one it had; refused
 * where the installation, or another installation on the same GitHub
 * account, already stands for another workspace.
 */
export function linkInstallation(
  organizationId: string,
  installation: ConnectedInstallation,
): Effect.Effect<LinkOutcome, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const elsewhere = yield* findLinkedElsewhere({ organizationId, ...installation });
    if (Option.isSome(elsewhere)) return LINK_OUTCOME.ALREADY_CONNECTED;
    const now = yield* DateTime.nowAsDate;
    yield* upsertInstallation({ organizationId, ...installation, now });
    return LINK_OUTCOME.LINKED;
  });
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
 * The workspace's installation disconnected, and every connect intent still
 * outstanding for it spent with it, so a return through the Setup URL begun
 * before the disconnect cannot link it again; a workspace with none
 * connected moves nothing.
 */
export function disconnectInstallation(
  organizationId: string,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.andThen(deleteWorkspaceIntents(organizationId), deleteInstallation(organizationId));
}

/** GitHub's id for the installation connected to the workspace, whatever its status; none for a workspace with none connected. */
export function installationOfWorkspace(
  organizationId: string,
): Effect.Effect<Option.Option<number>, StoreFailure, DatabaseServices> {
  return Effect.map(
    findInstallationOfWorkspace(organizationId),
    Option.map((row) => row.installationId),
  );
}

/**
 * The workspace, other than the one given, whose active installation is on
 * the GitHub account given, where the account asking is a member of it:
 * where a plan of the one given could move to reach that account's
 * repositories. One installation stands for one workspace, so there is at
 * most one.
 */
export function memberWorkspaceOnOwner(
  userId: string,
  owner: string,
  excludingOrganizationId: string,
): Effect.Effect<Option.Option<{ id: string; name: string }>, StoreFailure, DatabaseServices> {
  return findMemberWorkspaceOnOwner({ userId, owner, excludingOrganizationId });
}
