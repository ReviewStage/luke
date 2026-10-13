import { Schema as EffectSchema } from "effect";
import { workspaceIdSchema } from "./plan-wire.js";

/**
 * workspace-wire.ts -- the workspaces an account is a member of, a workspace it creates, and the GitHub organization an admin connects to one, as the desktop reads and asks for them.
 *
 * A workspace is a team in Luke: the account's own personal one, or one a
 * member created, whose teammates join by invitation. Membership has nothing
 * to do with GitHub. A workspace's repositories come from at most one
 * installation of the Luke GitHub App, which an owner or admin connects:
 * `POST /api/workspaces/github/connect` answers the App's install address
 * carrying a short-lived, single-use intent bound to the account and the
 * workspace, and GitHub's return through the Setup URL links the
 * installation the account's own GitHub token can see to that workspace.
 * One installation, and so one GitHub account or organization, stands for
 * one workspace. `GET /api/workspaces` answers every workspace the account
 * is a member of, its personal one first and the rest by name, each with the
 * account's role in it and its connected GitHub account, if any: its login,
 * and whether the installation is active, which a suspended or removed one
 * is not. A workspace's id is the one a plan's summary names, `plan-wire.ts`'s
 * `workspaceIdSchema`.
 */

/** An account's role in a workspace, as the auth service's organization plugin names it. */
export const WORKSPACE_ROLE = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
} as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLE)[keyof typeof WORKSPACE_ROLE];

const WORKSPACE_BOUNDS = {
  /** The most characters a workspace's name may spell, after its ends are trimmed. */
  MAX_NAME_CHARS: 64,
} as const;

/** The GitHub account a workspace's connected installation is on: its login, and whether the installation is active. */
export const workspaceGithubSchema = EffectSchema.Struct({
  login: EffectSchema.String,
  /** False where the installation was suspended or removed on GitHub: the workspace's repository work is refused there. */
  active: EffectSchema.Boolean,
});

/**
 * One workspace the account is a member of. The name is held to no bound
 * here, because a name the service already holds must not make the whole
 * list unreadable; a new name is bounded where it is asked for.
 */
export const workspaceSchema = EffectSchema.Struct({
  id: workspaceIdSchema,
  name: EffectSchema.String,
  /** The account's own personal workspace, which no teammate's answer marks. */
  personal: EffectSchema.Boolean,
  role: EffectSchema.Literals(Object.values(WORKSPACE_ROLE)),
  /** The GitHub account its connected installation is on, or null where none is connected. */
  github: EffectSchema.NullOr(workspaceGithubSchema),
});

export type Workspace = typeof workspaceSchema.Type;

/** The account's workspaces, its personal one first and the rest by name (GET). */
export const workspacesAnswerSchema = EffectSchema.Struct({
  workspaces: EffectSchema.Array(workspaceSchema),
});

export type WorkspacesAnswer = typeof workspacesAnswerSchema.Type;

/** One workspace: the one created, or the one whose GitHub organization was disconnected. */
export const workspaceAnswerSchema = EffectSchema.Struct({ workspace: workspaceSchema });

/** A workspace created (POST): its name, its ends trimmed; the account creating it is its owner. */
export const workspaceCreateRequestSchema = EffectSchema.Struct({
  name: EffectSchema.Trim.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(WORKSPACE_BOUNDS.MAX_NAME_CHARS),
  ),
});

/** The workspace a GitHub organization is connected to or disconnected from (POST), by an owner or admin of it. */
export const workspaceGithubRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
});

/** Where the browser goes to connect: the App's install address, carrying the single-use intent GitHub returns with. */
export const workspaceGithubConnectAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String.check(EffectSchema.isNonEmpty()),
});
