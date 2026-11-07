import { Schema as EffectSchema } from "effect";
import { countedNumber } from "./service-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

/**
 * workspace-environment-wire.ts -- a workspace's shared environment variables, as Settings lists, sets, and removes them.
 *
 * Every member's cloud agents are handed the variables of their workspace.
 * `GET /api/workspaces/environment` answers their names to any member;
 * `PUT` sets one, and `POST /api/workspaces/environment/delete` removes
 * one, each to an owner or admin. A value travels once, in the body of the
 * `PUT` that sets it, and never again: every answer is the variables' names
 * as they then stand, each with when it was last set, and never a value.
 */

/** The query the list names its workspace by. */
export const WORKSPACE_ENVIRONMENT_QUERY = { WORKSPACE_ID: "workspaceId" } as const;

export const WORKSPACE_ENVIRONMENT_BOUNDS = {
  /** The longest name taken. */
  MAX_NAME_CHARS: 256,
  /** The longest value taken: 32 KB of characters. */
  MAX_VALUE_CHARS: 32 * 1024,
} as const;

/** A POSIX environment name: a letter or underscore, then letters, digits, and underscores. */
export const workspaceVariableNameSchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(WORKSPACE_ENVIRONMENT_BOUNDS.MAX_NAME_CHARS),
  EffectSchema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/u),
);

const workspaceVariableSchema = EffectSchema.Struct({
  name: EffectSchema.String,
  /** When the variable was last set, in epoch milliseconds. */
  updatedAt: countedNumber,
});

export type WorkspaceVariable = typeof workspaceVariableSchema.Type;

/** The workspace's variables in name order (GET, and every write's answer), names alone. */
export const workspaceEnvironmentAnswerSchema = EffectSchema.Struct({
  variables: EffectSchema.Array(workspaceVariableSchema),
});

export type WorkspaceEnvironmentAnswer = typeof workspaceEnvironmentAnswerSchema.Type;

/** Setting a variable (PUT), replacing the value of one of that name. */
export const workspaceVariablePutRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  name: workspaceVariableNameSchema,
  value: EffectSchema.String.check(
    EffectSchema.isMaxLength(WORKSPACE_ENVIRONMENT_BOUNDS.MAX_VALUE_CHARS),
  ),
});

/** Removing a variable (POST to `/delete`). */
export const workspaceVariableDeleteRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  name: workspaceVariableNameSchema,
});
