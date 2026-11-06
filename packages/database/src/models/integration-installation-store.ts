import { createHash, randomBytes } from "node:crypto";
import { TRIGGER_PROVIDER, type TriggerProvider } from "@repo/features/trigger-catalog";
import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import { DateTime, Duration, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { type LiveStatement, liveSelection, liveStatementOf } from "../core/live-statement.js";
import { Database, queryBuilder } from "../core/query.js";
import { INTEGRATION_INSTALLATION_STATUS } from "../integration-vocabulary.js";
import {
  integrationInstallation,
  integrationInstallIntent,
} from "../schemas/integration-installation.js";
import { InstantColumnSchema } from "./columns.js";
import type { TaskStoreEffect } from "./task-store.js";
import { workspaceReachableBy } from "./workspace-store.js";

export const INTEGRATION_INSTALL_INTENT_LIFETIME = Duration.hours(1);

const ProviderSchema = Schema.Literals(Object.values(TRIGGER_PROVIDER));

const STATE_BYTES = 32;

export const INSTALLATION_LINK = {
  LINKED: "linked",
  ALREADY_CONNECTED: "already-connected",
} as const;

export type InstallationLink = (typeof INSTALLATION_LINK)[keyof typeof INSTALLATION_LINK];

export interface InstallationToLink {
  readonly provider: TriggerProvider;
  readonly externalId: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly accountLabel?: string | undefined;
}

const InstallationRowSchema = Schema.Struct({
  provider: ProviderSchema,
  externalId: Schema.String,
  status: Schema.Literals(Object.values(INTEGRATION_INSTALLATION_STATUS)),
  accountLabel: Schema.NullOr(Schema.String),
  linkedByUserId: Schema.NullOr(Schema.String),
  createdAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
});

export type IntegrationInstallation = typeof InstallationRowSchema.Type;

export interface IntegrationInstallIntent {
  readonly userId: string;
  readonly organizationId: string;
}

function stateHashOf(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

const upsertInstallation = SqlSchema.findAll({
  Request: Schema.Struct({
    provider: ProviderSchema,
    externalId: Schema.String,
    organizationId: Schema.String,
    userId: Schema.String,
    accountLabel: Schema.NullOr(Schema.String),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ externalId: Schema.String }),
  execute: (row) =>
    Database.use((db) =>
      db
        .insert(integrationInstallation)
        .values({
          provider: row.provider,
          externalId: row.externalId,
          organizationId: row.organizationId,
          status: INTEGRATION_INSTALLATION_STATUS.ACTIVE,
          accountLabel: row.accountLabel,
          linkedByUserId: row.userId,
          createdAt: row.now,
          updatedAt: row.now,
        })
        .onConflictDoUpdate({
          target: [integrationInstallation.provider, integrationInstallation.externalId],
          set: {
            organizationId: sql`excluded.organization_id`,
            status: INTEGRATION_INSTALLATION_STATUS.ACTIVE,
            accountLabel: sql`coalesce(excluded.account_label, ${integrationInstallation.accountLabel})`,
            linkedByUserId: sql`excluded.linked_by_user_id`,
            updatedAt: sql`excluded.updated_at`,
          },
          setWhere: sql`${integrationInstallation.organizationId} = ${row.organizationId} or ${integrationInstallation.status} = ${INTEGRATION_INSTALLATION_STATUS.DELETED}`,
        })
        .returning({ externalId: integrationInstallation.externalId }),
    ),
});

const writeDeleted = SqlSchema.findAll({
  Request: Schema.Struct({
    provider: ProviderSchema,
    externalId: Schema.String,
    organizationId: Schema.optionalKey(Schema.String),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ txid: Schema.String }),
  execute: ({ provider, externalId, organizationId, now }) =>
    Database.use((db) =>
      db
        .update(integrationInstallation)
        .set({ status: INTEGRATION_INSTALLATION_STATUS.DELETED, updatedAt: now })
        .where(
          and(
            eq(integrationInstallation.provider, provider),
            eq(integrationInstallation.externalId, externalId),
            eq(integrationInstallation.status, INTEGRATION_INSTALLATION_STATUS.ACTIVE),
            organizationId === undefined
              ? undefined
              : eq(integrationInstallation.organizationId, organizationId),
          ),
        )
        .returning({ txid: sql<string>`pg_current_xact_id()::text` }),
    ),
});

const findActiveWorkspace = SqlSchema.findOneOption({
  Request: Schema.Struct({ provider: ProviderSchema, externalId: Schema.String }),
  Result: Schema.Struct({ organizationId: Schema.String }),
  execute: ({ provider, externalId }) =>
    Database.use((db) =>
      db
        .select({ organizationId: integrationInstallation.organizationId })
        .from(integrationInstallation)
        .where(
          and(
            eq(integrationInstallation.provider, provider),
            eq(integrationInstallation.externalId, externalId),
            eq(integrationInstallation.status, INTEGRATION_INSTALLATION_STATUS.ACTIVE),
          ),
        ),
    ),
});

const findWorkspaceInstallations = SqlSchema.findAll({
  Request: Schema.String,
  Result: InstallationRowSchema,
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({
          provider: integrationInstallation.provider,
          externalId: integrationInstallation.externalId,
          status: integrationInstallation.status,
          accountLabel: integrationInstallation.accountLabel,
          linkedByUserId: integrationInstallation.linkedByUserId,
          createdAt: integrationInstallation.createdAt,
          updatedAt: integrationInstallation.updatedAt,
        })
        .from(integrationInstallation)
        .where(eq(integrationInstallation.organizationId, organizationId))
        .orderBy(asc(integrationInstallation.createdAt), asc(integrationInstallation.externalId)),
    ),
});

const insertIntent = SqlSchema.void({
  Request: Schema.Struct({
    stateHash: Schema.String,
    provider: ProviderSchema,
    userId: Schema.String,
    organizationId: Schema.String,
    expiresAt: Schema.Date,
    now: Schema.Date,
  }),
  execute: (row) =>
    Database.use((db) =>
      db.insert(integrationInstallIntent).values({
        stateHash: row.stateHash,
        provider: row.provider,
        userId: row.userId,
        organizationId: row.organizationId,
        expiresAt: row.expiresAt,
        createdAt: row.now,
      }),
    ),
});

const deleteExpiredIntents = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, now: Schema.Date }),
  execute: ({ userId, now }) =>
    Database.use((db) =>
      db
        .delete(integrationInstallIntent)
        .where(
          and(
            eq(integrationInstallIntent.userId, userId),
            lte(integrationInstallIntent.expiresAt, now),
          ),
        ),
    ),
});

const deleteIntent = SqlSchema.findOneOption({
  Request: Schema.Struct({ stateHash: Schema.String, provider: ProviderSchema, now: Schema.Date }),
  Result: Schema.Struct({ userId: Schema.String, organizationId: Schema.String }),
  execute: ({ stateHash, provider, now }) =>
    Database.use((db) =>
      db
        .delete(integrationInstallIntent)
        .where(
          and(
            eq(integrationInstallIntent.stateHash, stateHash),
            eq(integrationInstallIntent.provider, provider),
            gt(integrationInstallIntent.expiresAt, now),
          ),
        )
        .returning({
          userId: integrationInstallIntent.userId,
          organizationId: integrationInstallIntent.organizationId,
        }),
    ),
});

export function linkIntegrationInstallation(
  link: InstallationToLink,
): TaskStoreEffect<InstallationLink> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(
      upsertInstallation({ ...link, accountLabel: link.accountLabel ?? null, now }),
      (rows) => (rows.length > 0 ? INSTALLATION_LINK.LINKED : INSTALLATION_LINK.ALREADY_CONNECTED),
    ),
  );
}

export function markIntegrationInstallationDeleted(
  provider: TriggerProvider,
  externalId: string,
  organizationId?: string,
): TaskStoreEffect<Option.Option<string>> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(
      writeDeleted({
        provider,
        externalId,
        now,
        ...(organizationId === undefined ? undefined : { organizationId }),
      }),
      (rows) => Option.map(Option.fromNullishOr(rows[0]), (row) => row.txid),
    ),
  );
}

export function activeInstallationWorkspace(
  provider: TriggerProvider,
  externalId: string,
): TaskStoreEffect<Option.Option<string>> {
  return Effect.map(findActiveWorkspace({ provider, externalId }), (row) =>
    Option.map(row, (found) => found.organizationId),
  );
}

export function sentryInstallationsLiveStatement(
  readerId: string,
  organizationId: string,
): Option.Option<LiveStatement> {
  return liveStatementOf(
    queryBuilder
      .select(
        liveSelection(
          {
            installationId: integrationInstallation.externalId,
            account: integrationInstallation.accountLabel,
          },
          { createdAt: integrationInstallation.createdAt },
        ),
      )
      .from(integrationInstallation)
      .where(
        and(
          eq(integrationInstallation.organizationId, organizationId),
          eq(integrationInstallation.provider, TRIGGER_PROVIDER.SENTRY),
          eq(integrationInstallation.status, INTEGRATION_INSTALLATION_STATUS.ACTIVE),
          workspaceReachableBy(readerId, organizationId),
        ),
      ),
  );
}

export function workspaceIntegrationInstallations(
  organizationId: string,
): TaskStoreEffect<readonly IntegrationInstallation[]> {
  return findWorkspaceInstallations(organizationId);
}

export function openIntegrationInstallIntent(
  provider: TriggerProvider,
  userId: string,
  organizationId: string,
): TaskStoreEffect<string> {
  return Effect.gen(function* () {
    const state = randomBytes(STATE_BYTES).toString("base64url");
    const now = yield* DateTime.now;
    yield* deleteExpiredIntents({ userId, now: DateTime.toDateUtc(now) });
    yield* insertIntent({
      stateHash: stateHashOf(state),
      provider,
      userId,
      organizationId,
      expiresAt: DateTime.toDateUtc(DateTime.addDuration(now, INTEGRATION_INSTALL_INTENT_LIFETIME)),
      now: DateTime.toDateUtc(now),
    });
    return state;
  });
}

export function spendIntegrationInstallIntent(
  provider: TriggerProvider,
  state: string,
): TaskStoreEffect<Option.Option<IntegrationInstallIntent>> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    deleteIntent({ stateHash: stateHashOf(state), provider, now }),
  );
}
