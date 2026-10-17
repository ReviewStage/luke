/**
 * workspace-integration-store.ts -- the reads and writes of a workspace's integration rows.
 *
 * A workspace's row (`schemas/workspace-integration.ts`) is the account
 * row's counterpart (`integration-store.ts`), and moves through the same
 * steps: a sign-in begins by writing its one-time state beside whatever the
 * row already said, completes by setting the row connected and clearing the
 * state, or ends without a grant by clearing the state alone (a first
 * sign-in's row with it); Connect refusing a grant marks a connected row
 * expired; a Disconnect deletes the row. Every function here is an effect
 * over the ambient `SqlClient`.
 */

import { Database } from "@luke/database/core/query";
import {
  INTEGRATION_ROW_STATUS,
  type IntegrationRowStatus,
} from "@luke/database/integration-vocabulary";
import { InstantColumnSchema } from "@luke/database/models/columns";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { task } from "@luke/database/schemas/task";
import { workspaceIntegrationConnection } from "@luke/database/schemas/workspace-integration";
import {
  type IntegrationProvider,
  integrationProviderSchema,
} from "@luke/features/integration-wire";
import { and, eq } from "drizzle-orm";
import { DateTime, Effect, Option, Redacted, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import type { IntegrationStoreEffect } from "./integration-store.js";

/** One workspace's row at one provider. */
export interface WorkspaceIntegrationRow {
  readonly organizationId: string;
  readonly provider: IntegrationProvider;
  readonly status: IntegrationRowStatus;
  /** The sign-in under way's own state; nothing when none is. */
  readonly state: string | undefined;
  /** When the sign-in under way began; nothing when none is. */
  readonly stateIssuedAt: Date | undefined;
  /** Connect's handle on the sign-in under way; nothing when none is. */
  readonly verifier: Redacted.Redacted | undefined;
}

const RowSchema = Schema.Struct({
  organizationId: Schema.String,
  provider: integrationProviderSchema,
  status: Schema.Literals(Object.values(INTEGRATION_ROW_STATUS)),
  state: Schema.NullOr(Schema.String),
  stateIssuedAt: Schema.NullOr(InstantColumnSchema),
  connectVerifier: Schema.NullOr(Schema.String),
});

const ROW_COLUMNS = {
  organizationId: workspaceIntegrationConnection.organizationId,
  provider: workspaceIntegrationConnection.provider,
  status: workspaceIntegrationConnection.status,
  state: workspaceIntegrationConnection.state,
  stateIssuedAt: workspaceIntegrationConnection.stateIssuedAt,
  connectVerifier: workspaceIntegrationConnection.connectVerifier,
};

function rowOf(row: typeof RowSchema.Type): WorkspaceIntegrationRow {
  return {
    organizationId: row.organizationId,
    provider: row.provider,
    status: row.status,
    state: row.state ?? undefined,
    stateIssuedAt: row.stateIssuedAt ?? undefined,
    verifier: row.connectVerifier === null ? undefined : Redacted.make(row.connectVerifier),
  };
}

const KeySchema = Schema.Struct({
  organizationId: Schema.String,
  provider: integrationProviderSchema,
});

/** The row one workspace holds at one provider. */
function ofWorkspace({ organizationId, provider }: typeof KeySchema.Type) {
  return and(
    eq(workspaceIntegrationConnection.organizationId, organizationId),
    eq(workspaceIntegrationConnection.provider, provider),
  );
}

const findByWorkspace = SqlSchema.findOneOption({
  Request: KeySchema,
  Result: RowSchema,
  execute: (key) =>
    Database.use((db) =>
      db.select(ROW_COLUMNS).from(workspaceIntegrationConnection).where(ofWorkspace(key)),
    ),
});

const findByState = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: RowSchema,
  execute: (state) =>
    Database.use((db) =>
      db
        .select(ROW_COLUMNS)
        .from(workspaceIntegrationConnection)
        .where(eq(workspaceIntegrationConnection.state, state)),
    ),
});

const orUndefined = Option.match({
  onNone: () => undefined,
  onSome: rowOf,
});

/** The workspace's row at one provider, or nothing where it is not connected and is not signing in. */
export function readWorkspaceIntegration(
  organizationId: string,
  provider: IntegrationProvider,
): IntegrationStoreEffect<WorkspaceIntegrationRow | undefined> {
  return Effect.map(findByWorkspace({ organizationId, provider }), orUndefined);
}

/** The row whose sign-in under way carries this state, or nothing where none does. */
export function readWorkspaceIntegrationSignIn(
  state: string,
): IntegrationStoreEffect<WorkspaceIntegrationRow | undefined> {
  return Effect.map(findByState(state), orUndefined);
}

const BeginSchema = Schema.Struct({
  organizationId: Schema.String,
  provider: integrationProviderSchema,
  userId: Schema.String,
  state: Schema.String,
  verifier: Schema.String,
  at: Schema.Date,
});

/**
 * Note that the conflicting update leaves the status alone, because a
 * workspace connecting again stays as connected, or as expired, as it was
 * until the new sign-in completes.
 */
const upsertSignIn = SqlSchema.void({
  Request: BeginSchema,
  execute: ({ organizationId, provider, userId, state, verifier, at }) =>
    Database.use((db) =>
      db
        .insert(workspaceIntegrationConnection)
        .values({
          organizationId,
          provider,
          status: INTEGRATION_ROW_STATUS.PENDING,
          state,
          stateIssuedAt: at,
          connectVerifier: verifier,
          connectedByUserId: userId,
          updatedAt: at,
        })
        .onConflictDoUpdate({
          target: [
            workspaceIntegrationConnection.organizationId,
            workspaceIntegrationConnection.provider,
          ],
          set: {
            state,
            stateIssuedAt: at,
            connectVerifier: verifier,
            connectedByUserId: userId,
            updatedAt: at,
          },
        }),
    ),
});

/** Records a sign-in under way for the workspace, begun by the owner or admin named, under the state only its callback carries back. */
export function beginWorkspaceIntegrationSignIn(
  organizationId: string,
  provider: IntegrationProvider,
  userId: string,
  state: string,
  verifier: Redacted.Redacted,
): IntegrationStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (at) =>
    upsertSignIn({
      organizationId,
      provider,
      userId,
      state,
      verifier: Redacted.value(verifier),
      at,
    }),
  );
}

const StateSchema = Schema.Struct({
  organizationId: Schema.String,
  provider: integrationProviderSchema,
  state: Schema.String,
  at: Schema.Date,
});

const updateConnected = SqlSchema.findAll({
  Request: StateSchema,
  Result: Schema.Struct({ organizationId: Schema.String }),
  execute: ({ at, state, ...key }) =>
    Database.use((db) =>
      db
        .update(workspaceIntegrationConnection)
        .set({
          status: INTEGRATION_ROW_STATUS.CONNECTED,
          state: null,
          stateIssuedAt: null,
          connectVerifier: null,
          connectedAt: at,
          updatedAt: at,
        })
        .where(and(ofWorkspace(key), eq(workspaceIntegrationConnection.state, state)))
        .returning({ organizationId: workspaceIntegrationConnection.organizationId }),
    ),
});

/**
 * Sets the workspace connected and ends the sign-in begun under `state`;
 * answers whether that sign-in still stood to complete, so a Disconnect, or
 * a sign-in begun again, wins over a callback that answered late.
 */
export function completeWorkspaceIntegrationSignIn(
  organizationId: string,
  provider: IntegrationProvider,
  state: string,
): IntegrationStoreEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (at) =>
    Effect.map(updateConnected({ organizationId, provider, state, at }), (rows) => rows.length > 0),
  );
}

const deleteUnfinished = SqlSchema.void({
  Request: StateSchema,
  execute: ({ state, ...key }) =>
    Database.use((db) =>
      db
        .delete(workspaceIntegrationConnection)
        .where(
          and(
            ofWorkspace(key),
            eq(workspaceIntegrationConnection.state, state),
            eq(workspaceIntegrationConnection.status, INTEGRATION_ROW_STATUS.PENDING),
          ),
        ),
    ),
});

const clearState = SqlSchema.void({
  Request: StateSchema,
  execute: ({ at, state, ...key }) =>
    Database.use((db) =>
      db
        .update(workspaceIntegrationConnection)
        .set({ state: null, stateIssuedAt: null, connectVerifier: null, updatedAt: at })
        .where(and(ofWorkspace(key), eq(workspaceIntegrationConnection.state, state))),
    ),
});

/** Ends the sign-in begun under `state` without a grant: a first sign-in's row goes, and one that stood before keeps its status. */
export function endWorkspaceIntegrationSignIn(
  organizationId: string,
  provider: IntegrationProvider,
  state: string,
): IntegrationStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (at) =>
    Effect.andThen(
      deleteUnfinished({ organizationId, provider, state, at }),
      clearState({ organizationId, provider, state, at }),
    ),
  );
}

const updateExpired = SqlSchema.void({
  Request: Schema.Struct({ ...KeySchema.fields, at: Schema.Date }),
  execute: ({ at, ...key }) =>
    Database.use((db) =>
      db
        .update(workspaceIntegrationConnection)
        .set({ status: INTEGRATION_ROW_STATUS.EXPIRED, updatedAt: at })
        .where(
          and(
            ofWorkspace(key),
            eq(workspaceIntegrationConnection.status, INTEGRATION_ROW_STATUS.CONNECTED),
          ),
        ),
    ),
});

/** Marks a connected workspace expired, once Connect answered it holds no grant it can use. */
export function expireWorkspaceIntegration(
  organizationId: string,
  provider: IntegrationProvider,
): IntegrationStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (at) =>
    updateExpired({ organizationId, provider, at }),
  );
}

const deleteRow = SqlSchema.void({
  Request: KeySchema,
  execute: (key) =>
    Database.use((db) => db.delete(workspaceIntegrationConnection).where(ofWorkspace(key))),
});

/** Disconnects the workspace from one provider: its row is gone, so nobody reads through its grant from the next ask on. */
export function deleteWorkspaceIntegration(
  organizationId: string,
  provider: IntegrationProvider,
): IntegrationStoreEffect<void> {
  return deleteRow({ organizationId, provider });
}

const OrganizationSchema = Schema.Struct({ organizationId: Schema.String });

const findTaskWorkspace = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: OrganizationSchema,
  execute: (conversationId) =>
    Database.use((db) =>
      db
        .select({ organizationId: task.organizationId })
        .from(task)
        .where(eq(task.conversationId, conversationId))
        .limit(1),
    ),
});

const findAgentWorkspace = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: OrganizationSchema,
  execute: (conversationId) =>
    Database.use((db) =>
      db
        .select({ organizationId: codingAgent.organizationId })
        .from(codingAgent)
        .where(eq(codingAgent.conversationId, conversationId))
        .limit(1),
    ),
});

/**
 * The workspace a conversation's work belongs to: its plan's, or its
 * coding agent's; nothing for a conversation that is neither's.
 */
export function readConversationWorkspace(
  conversationId: string,
): IntegrationStoreEffect<string | undefined> {
  return Effect.gen(function* () {
    const planned = yield* findTaskWorkspace(conversationId);
    if (Option.isSome(planned)) return planned.value.organizationId;
    const agent = yield* findAgentWorkspace(conversationId);
    return Option.isSome(agent) ? agent.value.organizationId : undefined;
  });
}
