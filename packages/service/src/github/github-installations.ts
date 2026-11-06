import { createHash, randomBytes } from "node:crypto";
import { Database, type DatabaseServices } from "@repo/database/core/query";
import {
  GITHUB_ACCOUNT_TYPE,
  GITHUB_INSTALLATION_STATUS,
  type GitHubAccountType,
  type GitHubInstallationStatus,
} from "@repo/database/github-installation-vocabulary";
import { WORKSPACE_NAME } from "@repo/database/models/workspace-store";
import { member, organization } from "@repo/database/schemas/auth";
import { githubInstallIntent } from "@repo/database/schemas/github-install-intent";
import { githubInstallation } from "@repo/database/schemas/github-installation";
import { roleOf, WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { and, asc, eq, gt, ne, sql } from "drizzle-orm";
import { DateTime, Duration, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import type { StoreFailure } from "../http/store-failure.js";

export const GITHUB_CONNECT_ROLES: ReadonlySet<string> = new Set([
  WORKSPACE_ROLE.OWNER,
  WORKSPACE_ROLE.ADMIN,
]);

const INTENT_LIFETIME = Duration.hours(1);

const STATE_BYTES = 32;

export interface ConnectedInstallation {
  readonly installationId: number;
  readonly accountId: number;
  readonly accountLogin: string;
  readonly accountType: GitHubAccountType;
  readonly suspended: boolean;
}

export const LINK_OUTCOME = {
  LINKED: "linked",
  ALREADY_CONNECTED: "already-connected",
  NOT_PERMITTED: "not-permitted",
} as const;

export type LinkOutcome = (typeof LINK_OUTCOME)[keyof typeof LINK_OUTCOME];

export interface ConnectIntent {
  readonly userId: string;
  readonly organizationId: string;
  readonly installationId: number | null;
  readonly codeVerifier: string | null;
}

const InstallationStatusSchema = Schema.Literals(Object.values(GITHUB_INSTALLATION_STATUS));

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
  execute: (row) => {
    const sameWorkspace = eq(githubInstallation.organizationId, row.organizationId);
    return Database.use((db) =>
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
            organizationId: row.organizationId,
            installationId: row.installationId,
            accountLogin: row.accountLogin,
            accountType: row.accountType,
            status: sql`case when ${sameWorkspace} and ${githubInstallation.installationId} = ${row.installationId} then ${githubInstallation.status} else ${row.status} end`,
            createdAt: sql`case when ${sameWorkspace} then ${githubInstallation.createdAt} else ${row.now} end`,
            updatedAt: row.now,
          },
          setWhere: sql`${sameWorkspace} or ${eq(githubInstallation.status, GITHUB_INSTALLATION_STATUS.DELETED)}`,
        })
        .returning({ installationId: githubInstallation.installationId }),
    );
  },
});

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

export function spendConnectIntent(
  state: string,
): Effect.Effect<Option.Option<ConnectIntent>, StoreFailure, DatabaseServices> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    deleteIntent({ stateHash: stateHashOf(state), now }),
  );
}

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

export function setInstallationStatus(
  installationId: number,
  status: GitHubInstallationStatus,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    updateInstallationStatus({ installationId, status, now }),
  );
}

export function mendInstallationStatus(
  read: WorkspaceInstallation,
  status: GitHubInstallationStatus,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    mendStatus({ installationId: read.installationId, status, readAt: read.updatedAt, now }),
  );
}

export interface WorkspaceInstallation {
  readonly installationId: number;
  readonly accountLogin: string;
  readonly status: GitHubInstallationStatus;
  readonly updatedAt: Date;
}

export function installationsOfWorkspace(
  organizationId: string,
): Effect.Effect<readonly WorkspaceInstallation[], StoreFailure, DatabaseServices> {
  return findInstallationsOfWorkspace(organizationId);
}

export function memberWorkspaceOnOwner(
  userId: string,
  owner: string,
  excludingOrganizationId: string,
): Effect.Effect<Option.Option<{ id: string; name: string }>, StoreFailure, DatabaseServices> {
  return findMemberWorkspaceOnOwner({ userId, owner, excludingOrganizationId });
}
