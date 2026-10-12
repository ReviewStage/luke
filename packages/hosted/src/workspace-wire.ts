import { Schema as EffectSchema } from "effect";
import { workspaceIdSchema } from "./plan-wire.js";

/**
 * workspace-wire.ts -- the workspaces an account is a member of, as the desktop reads them.
 *
 * `GET /api/workspaces` answers every workspace the bearer's account is a
 * member of, its personal one first and the rest by name, each with its id,
 * its name, and whether it is the account's own personal one. The service
 * makes the personal workspace the first time it is asked for, so a
 * signed-in account's answer is never empty. A workspace's id is the one a
 * plan's summary names, `plan-wire.ts`'s `workspaceIdSchema`.
 */

/**
 * One workspace the account is a member of. The name is held to no bound,
 * because the auth service holds it to none, and one long name must not
 * make the whole list unreadable.
 */
export const workspaceSchema = EffectSchema.Struct({
  id: workspaceIdSchema,
  name: EffectSchema.String,
  /** The account's own personal workspace, which no teammate's answer marks. */
  personal: EffectSchema.Boolean,
});

export type Workspace = typeof workspaceSchema.Type;

/** The account's workspaces, its personal one first and the rest by name (GET). */
export const workspacesAnswerSchema = EffectSchema.Struct({
  workspaces: EffectSchema.Array(workspaceSchema),
});
