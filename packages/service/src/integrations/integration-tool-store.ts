/**
 * integration-tool-store.ts -- the tools a provider's MCP server last listed on one grant, kept beside the grant's row so a native agent's launch lists them without a token.
 *
 * A native agent's harness lists every integration server's tools at each
 * launch (`connection-door.ts`), and a live list needs the grant's token
 * from Vercel Connect, which bills each ask. So the list is kept on the row
 * that stands for the grant it was read on: the account's own
 * (`schemas/integration.ts`), or the workspace's Linear
 * (`schemas/workspace-integration.ts`). A grant from the account's GitHub
 * sign-in has no row and keeps nothing, since reading its token asks Connect
 * nothing. What is kept is each tool's name, words, and schemas as the server
 * sent them, never a credential, and it is read back only for the grant it
 * was listed on, so one account's list never reaches another.
 *
 * A list is kept only while its row stands connected under the grant it was
 * read on, and only where that grant was completed before the read began,
 * so a list read on a grant a sign-in has since replaced is dropped rather
 * than kept over the new one; a completed sign-in clears the row's list
 * (`integration-store.ts`, `workspace-integration-store.ts`), and a
 * Disconnect deletes the row and the list with it.
 */

import { Database } from "@luke/database/core/query";
import { INTEGRATION_ROW_STATUS } from "@luke/database/integration-vocabulary";
import { InstantColumnSchema } from "@luke/database/models/columns";
import { integrationConnection } from "@luke/database/schemas/integration";
import { workspaceIntegrationConnection } from "@luke/database/schemas/workspace-integration";
import { integrationProviderSchema } from "@luke/features/integration-wire";
import { and, eq, lte } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import type { IntegrationStoreEffect } from "./integration-store.js";
import { INTEGRATION_GRANT_HOLDER, type IntegrationGrantRef } from "./integration-token.js";
import { type McpToolSchema, McpToolSchemaSchema } from "./mcp-tools.js";

/** A grant's kept list: its tools, and when the read that listed them began. */
export interface StoredTools {
  readonly tools: readonly McpToolSchema[];
  readonly listedAt: Date;
}

const ToolsSchema = Schema.Array(McpToolSchemaSchema);

const decodeTools = Schema.decodeUnknownOption(ToolsSchema);

const StoredRowSchema = Schema.Struct({
  tools: Schema.Unknown,
  toolsListedAt: Schema.NullOr(InstantColumnSchema),
});

const AccountGrantSchema = Schema.Struct({
  userId: Schema.String,
  connectionName: Schema.String,
  connectSubject: Schema.String,
});

const WorkspaceGrantSchema = Schema.Struct({
  organizationId: Schema.String,
  provider: integrationProviderSchema,
});

/** The account's connected row under the connection name, while it stands for the grant under this subject. */
function ofAccountGrant({
  userId,
  connectionName,
  connectSubject,
}: typeof AccountGrantSchema.Type) {
  return and(
    eq(integrationConnection.userId, userId),
    eq(integrationConnection.connectionName, connectionName),
    eq(integrationConnection.connectSubject, connectSubject),
    eq(integrationConnection.status, INTEGRATION_ROW_STATUS.CONNECTED),
  );
}

/** The workspace's connected row at the provider. */
function ofWorkspaceGrant({ organizationId, provider }: typeof WorkspaceGrantSchema.Type) {
  return and(
    eq(workspaceIntegrationConnection.organizationId, organizationId),
    eq(workspaceIntegrationConnection.provider, provider),
    eq(workspaceIntegrationConnection.status, INTEGRATION_ROW_STATUS.CONNECTED),
  );
}

const findAccountTools = SqlSchema.findOneOption({
  Request: AccountGrantSchema,
  Result: StoredRowSchema,
  execute: (grant) =>
    Database.use((db) =>
      db
        .select({
          tools: integrationConnection.tools,
          toolsListedAt: integrationConnection.toolsListedAt,
        })
        .from(integrationConnection)
        .where(ofAccountGrant(grant)),
    ),
});

const findWorkspaceTools = SqlSchema.findOneOption({
  Request: WorkspaceGrantSchema,
  Result: StoredRowSchema,
  execute: (grant) =>
    Database.use((db) =>
      db
        .select({
          tools: workspaceIntegrationConnection.tools,
          toolsListedAt: workspaceIntegrationConnection.toolsListedAt,
        })
        .from(workspaceIntegrationConnection)
        .where(ofWorkspaceGrant(grant)),
    ),
});

const updateAccountTools = SqlSchema.void({
  Request: Schema.Struct({ ...AccountGrantSchema.fields, tools: ToolsSchema, from: Schema.Date }),
  execute: ({ tools, from, ...grant }) =>
    Database.use((db) =>
      db
        .update(integrationConnection)
        .set({ tools, toolsListedAt: from })
        .where(and(ofAccountGrant(grant), lte(integrationConnection.connectedAt, from))),
    ),
});

const updateWorkspaceTools = SqlSchema.void({
  Request: Schema.Struct({ ...WorkspaceGrantSchema.fields, tools: ToolsSchema, from: Schema.Date }),
  execute: ({ tools, from, ...grant }) =>
    Database.use((db) =>
      db
        .update(workspaceIntegrationConnection)
        .set({ tools, toolsListedAt: from })
        .where(and(ofWorkspaceGrant(grant), lte(workspaceIntegrationConnection.connectedAt, from))),
    ),
});

/** A row's kept list, where it holds one that still reads as tools. */
const storedOf = Option.match({
  onNone: (): StoredTools | undefined => undefined,
  onSome: ({ tools, toolsListedAt }: typeof StoredRowSchema.Type): StoredTools | undefined => {
    const read = Option.getOrUndefined(decodeTools(tools));
    return read === undefined || toolsListedAt === null
      ? undefined
      : { tools: read, listedAt: toolsListedAt };
  },
});

/** The list kept for the grant, or nothing where none is kept, the grant keeps none, or its row no longer stands for it. */
export function readStoredTools(
  grant: IntegrationGrantRef,
): IntegrationStoreEffect<StoredTools | undefined> {
  switch (grant.holder) {
    case INTEGRATION_GRANT_HOLDER.ACCOUNT:
      return Effect.map(findAccountTools(grant), storedOf);
    case INTEGRATION_GRANT_HOLDER.WORKSPACE:
      return Effect.map(findWorkspaceTools(grant), storedOf);
    case INTEGRATION_GRANT_HOLDER.SIGN_IN:
      return Effect.succeed(undefined);
  }
}

/**
 * Keeps the tools a read begun at `from` listed on the grant, where its row
 * still stands for that grant and the grant was completed by then; nothing
 * is kept otherwise, nor for a grant that keeps none.
 */
export function storeTools(
  grant: IntegrationGrantRef,
  tools: readonly McpToolSchema[],
  from: Date,
): IntegrationStoreEffect<void> {
  switch (grant.holder) {
    case INTEGRATION_GRANT_HOLDER.ACCOUNT:
      return updateAccountTools({
        userId: grant.userId,
        connectionName: grant.connectionName,
        connectSubject: grant.connectSubject,
        tools,
        from,
      });
    case INTEGRATION_GRANT_HOLDER.WORKSPACE:
      return updateWorkspaceTools({
        organizationId: grant.organizationId,
        provider: grant.provider,
        tools,
        from,
      });
    case INTEGRATION_GRANT_HOLDER.SIGN_IN:
      return Effect.void;
  }
}
