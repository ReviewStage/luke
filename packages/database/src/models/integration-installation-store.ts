import { createHash, randomBytes } from "node:crypto";
import { TRIGGER_PROVIDER, type TriggerProvider } from "@luke/features/trigger-catalog";
import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import { DateTime, Duration, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { INTEGRATION_INSTALLATION_STATUS } from "../integration-vocabulary.js";
import {
  integrationInstallation,
  integrationInstallIntent,
} from "../schemas/integration-installation.js";
import { InstantColumnSchema } from "./columns.js";
import type { TaskStoreEffect } from "./task-store.js";

/**
 * integration-installation-store.ts -- which workspace each integration's installed app stands for, and the intents that carry an install there.
 *
 * An installation is linked to one workspace and never moved: linking it to
 * the workspace it stands for again, or after its provider said it was
 * uninstalled, takes it (active again, under whoever linked it last), and
 * linking one still active for another workspace is refused there and
 * leaves it. A delivery finds its workspace only through an active
 * installation, so an uninstalled one fires nothing. An install is an
 * intent first: a random state bound to the provider, the account, and the
 * workspace, stored only as its SHA-256, spent once when the provider sends
 * the browser back; whether the account may install on the workspace is the
 * caller's to check before minting and again before linking. Every function
 * is an effect over the ambient `SqlClient`.
 */

/** How long an install intent stands: room to choose an organization and approve the app at the provider. */
export const INTEGRATION_INSTALL_INTENT_LIFETIME = Duration.hours(1);

const ProviderSchema = Schema.Literals(Object.values(TRIGGER_PROVIDER));

/** The random bytes an intent's state is spelled from. */
const STATE_BYTES = 32;

/** What a link settles on: linked to the workspace, or refused because the installation stands, active, for another. */
export const INSTALLATION_LINK = {
  LINKED: "linked",
  ALREADY_CONNECTED: "already-connected",
} as const;

export type InstallationLink = (typeof INSTALLATION_LINK)[keyof typeof INSTALLATION_LINK];

/** What linking an installation names: the provider and its id for it, the workspace, and the member linking it. */
export interface InstallationToLink {
  readonly provider: TriggerProvider;
  readonly externalId: string;
  readonly organizationId: string;
  readonly userId: string;
  /** The account's name at the provider (a Sentry organization's slug); left out, the row's stands. */
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

/** One installation as a workspace's settings list it. */
export type IntegrationInstallation = typeof InstallationRowSchema.Type;

/** The account and workspace an install intent was minted for. */
export interface IntegrationInstallIntent {
  readonly userId: string;
  readonly organizationId: string;
}

/** A state's stored form. */
function stateHashOf(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

/**
 * The installation written to the workspace in one statement: a new one
 * inserted, or the standing row taken where it is this workspace's or was
 * uninstalled; nothing written where it stands, active, for another.
 */
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
            // A link that read no label keeps the one the row holds.
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
  Request: Schema.Struct({ provider: ProviderSchema, externalId: Schema.String, now: Schema.Date }),
  Result: Schema.Struct({ externalId: Schema.String }),
  execute: ({ provider, externalId, now }) =>
    Database.use((db) =>
      db
        .update(integrationInstallation)
        .set({ status: INTEGRATION_INSTALLATION_STATUS.DELETED, updatedAt: now })
        .where(
          and(
            eq(integrationInstallation.provider, provider),
            eq(integrationInstallation.externalId, externalId),
            eq(integrationInstallation.status, INTEGRATION_INSTALLATION_STATUS.ACTIVE),
          ),
        )
        .returning({ externalId: integrationInstallation.externalId }),
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

/** The account's intents already past their hour, which a new one sweeps so they do not pile up. */
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

/** Links the installation to the workspace, or answers that it stands, active, for another, which keeps it. */
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

/** Marks the installation uninstalled, as its provider said; false where no active installation stands under the id. */
export function markIntegrationInstallationDeleted(
  provider: TriggerProvider,
  externalId: string,
): TaskStoreEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(writeDeleted({ provider, externalId, now }), (rows) => rows.length > 0),
  );
}

/** The workspace an active installation stands for, which a delivery under it fires the automations of; nothing for one unknown or uninstalled. */
export function activeInstallationWorkspace(
  provider: TriggerProvider,
  externalId: string,
): TaskStoreEffect<Option.Option<string>> {
  return Effect.map(findActiveWorkspace({ provider, externalId }), (row) =>
    Option.map(row, (found) => found.organizationId),
  );
}

/** The workspace's installations, every provider's, active or uninstalled, the first linked first. */
export function workspaceIntegrationInstallations(
  organizationId: string,
): TaskStoreEffect<readonly IntegrationInstallation[]> {
  return findWorkspaceInstallations(organizationId);
}

/** A new install intent for the account and the workspace at the provider; answers the state the install address carries, which nothing stores. */
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

/** The intent a state stands for at the provider, spent so it never links twice; nothing for a state unknown, another provider's, spent, or expired. */
export function spendIntegrationInstallIntent(
  provider: TriggerProvider,
  state: string,
): TaskStoreEffect<Option.Option<IntegrationInstallIntent>> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    deleteIntent({ stateHash: stateHashOf(state), provider, now }),
  );
}
