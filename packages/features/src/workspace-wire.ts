import { Schema as EffectSchema } from "effect";
import { workspaceIdSchema } from "./plan-wire.js";
import { countedNumber } from "./service-wire.js";

/**
 * workspace-wire.ts -- the workspaces an account is a member of, a workspace it creates or renames, and the GitHub organization an admin connects to one, as the desktop reads and asks for them.
 *
 * A workspace is a team in Luke: the first one, made for the account when it
 * first signs in, or one a member created; either way teammates join by
 * invitation. Membership has nothing
 * to do with GitHub. A workspace's repositories come from at most one
 * installation of the Luke GitHub App, which an owner or admin connects:
 * `POST /api/workspaces/github/connect` answers the App's install address
 * carrying a short-lived, single-use intent bound to the account and the
 * workspace, and GitHub's return through the Setup URL links the
 * installation the account's own GitHub token can see to that workspace.
 * One installation, and so one GitHub account or organization, stands for
 * one workspace. `GET /api/workspaces` answers every workspace the account
 * is a member of, its first one first and the rest by name, each with the
 * account's role in it and its connected GitHub account, if any: its login,
 * and whether the installation is active, which a suspended or removed one
 * is not. A workspace's id is the one a plan's summary names, `plan-wire.ts`'s
 * `workspaceIdSchema`.
 *
 * A member of a workspace reads its members; an owner or an admin renames
 * it and removes a member who is not an owner, and anyone but an owner
 * leaves. A rename moves the name alone: the slug stays the one the
 * workspace was made under.
 *
 * A workspace's slug is the first step of a Luke link's path
 * (`https://tryluke.dev/<slug>/plan/<id>`, `mention-link.ts`), so no workspace
 * takes one Luke's own pages stand under: `RESERVED_WORKSPACE_SLUGS`. The
 * slug only reads well; a link is found by the plan's id alone, so a slug
 * spelled differently later breaks no link written under the old one.
 */

/** An account's role in a workspace, as the auth service's organization plugin names it. */
export const WORKSPACE_ROLE = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
} as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLE)[keyof typeof WORKSPACE_ROLE];

/**
 * The first steps of tryluke.dev's paths that are Luke's own, now or likely
 * soon, which no workspace's slug may be: every page the web app serves
 * under its own name (`apps/web/vercel.json`, `apps/web/vite.config.ts`),
 * and the words a later page is likeliest to want.
 */
export const RESERVED_WORKSPACE_SLUGS: ReadonlySet<string> = new Set([
  "about",
  "accept-invitation",
  "account",
  "admin",
  "agents",
  "api",
  "app",
  "assets",
  "auth",
  "blog",
  "changelog",
  "connect-github",
  "consent",
  "desktop-session",
  "docs",
  "download",
  "eve",
  "github-installed",
  "help",
  "inbox",
  "integration-connected",
  "integrations",
  "invite",
  "login",
  "logout",
  "new",
  "oauth",
  "open",
  "plan",
  "plans",
  "pricing",
  "privacy",
  "security",
  "settings",
  "sign-in",
  "sign-out",
  "sign-up",
  "status",
  "support",
  "terms",
]);

export const WORKSPACE_BOUNDS = {
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
  /**
   * The first step of the workspace's links' paths, unique among workspaces;
   * absent from a service before slugs travelled, which the desktop reads
   * past, since a link is found by its plan's id alone.
   */
  slug: EffectSchema.optionalKey(EffectSchema.String),
  role: EffectSchema.Literals(Object.values(WORKSPACE_ROLE)),
  /** The GitHub account its connected installation is on, or null where none is connected. */
  github: EffectSchema.NullOr(workspaceGithubSchema),
  /** How many members it has, the account among them, which the window says as who shares it; absent from a service before it. */
  memberCount: EffectSchema.optionalKey(countedNumber),
});

export type Workspace = typeof workspaceSchema.Type;

/** The account's workspaces, its first one first and the rest by name (GET). */
export const workspacesAnswerSchema = EffectSchema.Struct({
  workspaces: EffectSchema.Array(workspaceSchema),
});

export type WorkspacesAnswer = typeof workspacesAnswerSchema.Type;

/** One workspace: the one created or renamed, or the one whose GitHub organization was disconnected. */
export const workspaceAnswerSchema = EffectSchema.Struct({ workspace: workspaceSchema });

/** A workspace created (POST): its name, its ends trimmed; the account creating it is its owner. */
export const workspaceCreateRequestSchema = EffectSchema.Struct({
  name: EffectSchema.Trim.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(WORKSPACE_BOUNDS.MAX_NAME_CHARS),
  ),
});

/** A workspace renamed (POST) by an owner or admin of it: the workspace, and its new name held as a created one's is; answered with the workspace. */
export const workspaceRenameRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  name: workspaceCreateRequestSchema.fields.name,
});

/** The workspace a GitHub organization is connected to or disconnected from (POST), by an owner or admin of it. */
export const workspaceGithubRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
});

/** Where the browser goes to connect: the App's install address, carrying the single-use intent GitHub returns with. */
export const workspaceGithubConnectAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String.check(EffectSchema.isNonEmpty()),
});

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
