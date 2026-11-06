import { Database } from "@repo/database/core/query";
import { INTEGRATION_ROW_STATUS } from "@repo/database/integration-vocabulary";
import { InstantColumnSchema } from "@repo/database/models/columns";
import { integrationConnection } from "@repo/database/schemas/integration";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import type { IntegrationStoreEffect } from "./integration-store.js";
import { INTEGRATION_GRANT_HOLDER, type IntegrationGrantRef } from "./integration-token.js";
import { type McpToolSchema, McpToolSchemaSchema } from "./mcp-tools.js";

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

const updateAccountTools = SqlSchema.void({
  Request: Schema.Struct({ ...AccountGrantSchema.fields, tools: ToolsSchema, from: Schema.Date }),
  execute: ({ tools, from, ...grant }) =>
    Database.use((db) =>
      db
        .update(integrationConnection)
        .set({ tools: keptOf(tools), toolsListedAt: from })
        .where(
          and(
            ofAccountGrant(grant),
            lte(integrationConnection.connectedAt, from),
            or(
              isNull(integrationConnection.toolsListedAt),
              lte(integrationConnection.toolsListedAt, from),
            ),
          ),
        ),
    ),
});

function keptOf(tools: readonly McpToolSchema[]): readonly McpToolSchema[] | null {
  return tools.length === 0 ? null : tools;
}

const storedOf = Option.match({
  onNone: (): StoredTools | undefined => undefined,
  onSome: ({ tools, toolsListedAt }: typeof StoredRowSchema.Type): StoredTools | undefined => {
    const read = Option.getOrUndefined(decodeTools(tools));
    return read === undefined || toolsListedAt === null
      ? undefined
      : { tools: read, listedAt: toolsListedAt };
  },
});

export function readStoredTools(
  grant: IntegrationGrantRef,
): IntegrationStoreEffect<StoredTools | undefined> {
  switch (grant.holder) {
    case INTEGRATION_GRANT_HOLDER.ACCOUNT:
      return Effect.map(findAccountTools(grant), storedOf);
    case INTEGRATION_GRANT_HOLDER.SIGN_IN:
      return Effect.succeed(undefined);
  }
}

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
    case INTEGRATION_GRANT_HOLDER.SIGN_IN:
      return Effect.void;
  }
}
