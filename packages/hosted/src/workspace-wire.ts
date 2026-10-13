import { Schema as EffectSchema } from "effect";
import { workspaceIdSchema } from "./plan-wire.js";

/**
 * workspace-wire.ts -- the workspaces an account is a member of, and the ones it may join, as the desktop reads them.
 *
 * A workspace is the account's own personal one, or one per installation of
 * the Luke GitHub App. `GET /api/workspaces` first reads which installations
 * the account's GitHub reaches: an installation nobody made a workspace for
 * yet becomes one, owned by the account that reached it first. The answer
 * is every workspace the account is a member of, its personal one first and
 * the rest by name, each with the account's role in it, and then every
 * workspace of an installation the account reaches but is not a member of,
 * which it may join. A workspace whose installation was suspended or
 * removed is in neither list. A workspace's id is the one a plan's summary
 * names, `plan-wire.ts`'s `workspaceIdSchema`.
 *
 * An account joins the workspace of an installation it may join by the
 * installation's id, once GitHub confirms it still reaches it. A member of a
 * workspace reads its members; an owner or an admin removes one who is not
 * an owner, and anyone but an owner leaves. A personal workspace is joined,
 * managed, and left by nobody.
 */

/** An account's role in a workspace, as the auth service's organization plugin names it. */
export const WORKSPACE_ROLE = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
} as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLE)[keyof typeof WORKSPACE_ROLE];

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
  role: EffectSchema.Literals(Object.values(WORKSPACE_ROLE)),
});

export type Workspace = typeof workspaceSchema.Type;

/** A workspace the account may join: the GitHub App installation it stands for, by GitHub's id, and its name, the account's login. */
export const availableWorkspaceSchema = EffectSchema.Struct({
  installationId: EffectSchema.Int.check(EffectSchema.isGreaterThan(0)),
  name: EffectSchema.String,
});

export type AvailableWorkspace = typeof availableWorkspaceSchema.Type;

/** The account's workspaces, its personal one first and the rest by name, and the ones it may join, by name (GET). */
export const workspacesAnswerSchema = EffectSchema.Struct({
  workspaces: EffectSchema.Array(workspaceSchema),
  available: EffectSchema.Array(availableWorkspaceSchema),
});

export type WorkspacesAnswer = typeof workspacesAnswerSchema.Type;

/** Joining the workspace of a GitHub App installation (POST), by GitHub's id for the installation. */
export const workspaceJoinRequestSchema = EffectSchema.Struct({
  installationId: availableWorkspaceSchema.fields.installationId,
});

/** The workspace joined, with the account's role in it: a member's, or the one it already held. */
export const workspaceJoinAnswerSchema = EffectSchema.Struct({ workspace: workspaceSchema });

/** One member of a workspace: the account, its name and email, and its role. */
export const workspaceMemberSchema = EffectSchema.Struct({
  userId: EffectSchema.String,
  name: EffectSchema.String,
  email: EffectSchema.String,
  role: workspaceSchema.fields.role,
});

export type WorkspaceMember = typeof workspaceMemberSchema.Type;

/** A workspace's members, owners first, then admins, then members, each by name (GET, and after a removal). */
export const workspaceMembersAnswerSchema = EffectSchema.Struct({
  members: EffectSchema.Array(workspaceMemberSchema),
});

/** The query a members read names its workspace under. */
export const WORKSPACE_MEMBERS_QUERY = { WORKSPACE_ID: "workspaceId" } as const;

/** Removing one member from a workspace (POST), answered with the members who remain. */
export const workspaceMemberRemovalSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  userId: EffectSchema.String.check(EffectSchema.isNonEmpty()),
});

/** Leaving a workspace (POST), answered with the workspace left. */
export const workspaceLeaveRequestSchema = EffectSchema.Struct({ workspaceId: workspaceIdSchema });

/** The workspace the account left. */
export const workspaceLeaveAnswerSchema = workspaceLeaveRequestSchema;
