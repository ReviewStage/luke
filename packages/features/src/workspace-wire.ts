import { Schema as EffectSchema, Result } from "effect";
import { Base64 } from "effect/encoding";
import { sniffImageType } from "./image-signature.js";
import { LINEAR_BOUNDS, linearIdentifierSchema } from "./linear-wire.js";
import { countedNumber } from "./service-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

/**
 * workspace-wire.ts -- the workspaces an account is a member of, a workspace it creates, renames, or gives a photo, and the GitHub organization an admin connects to one, as the desktop reads and asks for them.
 *
 * A workspace is a team in Luke: the first one, made for the account when it
 * first signs in, or one a member created; either way teammates join by
 * invitation. Membership has nothing
 * to do with GitHub. A workspace's repositories come from the installations
 * of the Luke GitHub App an owner or admin connects to it, one per GitHub
 * account: `POST /api/workspaces/github/connect` answers the App's install
 * address carrying a short-lived, single-use intent bound to the account
 * and the workspace, and GitHub's return through the Setup URL adds the
 * installation the account's own GitHub token can see to that workspace,
 * beside those it holds. An installation, and so its GitHub account or
 * organization, stands for exactly one workspace. Which installations and
 * repositories a workspace holds is managed on GitHub; nothing here removes
 * one. `GET /api/workspaces` answers every workspace the account is a
 * member of, its first one first and the rest by name, each with the
 * account's role in it and its connected GitHub accounts, the first linked
 * first: each one's login, and whether its installation is active, which a
 * suspended or removed one is not. `githubInstallations` is every one, and
 * absent from a service from before there could be several; `github` is
 * the first still active, else the first, or null, as a desktop from
 * before them reads it. A workspace's id is the one a plan's summary names, `task-wire.ts`'s
 * `workspaceIdSchema`.
 *
 * A member of a workspace reads its members; an owner or an admin renames
 * it, and anyone but an owner leaves. A workspace has one owner, its
 * creator, until the owner hands it to an admin and becomes an admin. The
 * owner alone makes a member an admin or an admin a member, and removes an
 * admin; an admin removes a member alone. Nobody changes or removes
 * themselves, whose way out is leaving, or the owner. A rename moves the
 * name alone: the slug stays the one the workspace was made under.
 *
 * A workspace's slug is the first step of a Luke link's path
 * (`https://tryluke.dev/<slug>/plan/<id>`, `mention-link.ts`), so no workspace
 * takes one Luke's own pages stand under: `RESERVED_WORKSPACE_SLUGS`. The
 * slug only reads well; a link is found by the plan's id alone, so a slug
 * spelled differently later breaks no link written under the old one.
 *
 * A workspace may show a photo an owner or admin uploaded, served to its
 * members alone at `GET /api/workspaces/<id>/photo` as its bytes; the list
 * says only which version of it stands. The account's own first workspace
 * with no photo shows the account's sign-in picture instead. An owner or an
 * admin sets the photo as a `data:` URL of one of `WORKSPACE_PHOTO_TYPE`, at
 * most `WORKSPACE_PHOTO_BOUNDS.MAX_BYTES` of bytes, or removes it.
 */

/** An account's role in a workspace, as the auth service's organization plugin names it. */
export const WORKSPACE_ROLE = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
} as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLE)[keyof typeof WORKSPACE_ROLE];

/**
 * The roles a member is given, by an invitation or by the owner: a
 * workspace has one owner, its creator, so nobody is made one but by the
 * owner handing it over.
 */
export const ASSIGNABLE_ROLE = {
  ADMIN: WORKSPACE_ROLE.ADMIN,
  MEMBER: WORKSPACE_ROLE.MEMBER,
} as const;

/**
 * The first steps of tryluke.dev's paths that are Luke's own, now or likely
 * soon, which no workspace's slug may be: every page the web app serves
 * under its own name (the root `vercel.json`, `apps/web/vite.config.ts`),
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

/**
 * The image types a workspace's photo may be: kept as a `data:` URL of one
 * of them, served as its bytes under it, and drawn by a window from a `data:`
 * URL of its own making.
 */
export const WORKSPACE_PHOTO_TYPE = {
  PNG: "image/png",
  JPEG: "image/jpeg",
  WEBP: "image/webp",
} as const;

export type WorkspacePhotoType = (typeof WORKSPACE_PHOTO_TYPE)[keyof typeof WORKSPACE_PHOTO_TYPE];

/** A workspace photo's media type as the wire carries it. */
export const workspacePhotoTypeSchema = EffectSchema.Literals(Object.values(WORKSPACE_PHOTO_TYPE));

export const WORKSPACE_PHOTO_BOUNDS = {
  /**
   * The most bytes a photo set on a workspace may hold, decoded. The desktop
   * sends a 256-pixel square WebP, a few kilobytes, so this holds the bound
   * well clear of any photo it makes while keeping the list's row small.
   */
  MAX_BYTES: 100_000,
} as const;

/** A photo as a `data:` URL spells it: its media type, then its bytes in base64. */
const PHOTO_DATA_URL = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/u;

const isPhotoType = EffectSchema.is(workspacePhotoTypeSchema);

/** A workspace's photo, as its bytes under its media type. */
export interface WorkspacePhoto {
  readonly contentType: WorkspacePhotoType;
  readonly bytes: Uint8Array;
}

/**
 * The photo a `data:` URL holds, where its type is one of
 * `WORKSPACE_PHOTO_TYPE` and its base64 reads; nothing for any other text.
 * The one reading of a photo's URL, for the photo set and the photo kept.
 */
export function workspacePhotoOfDataUrl(text: string): WorkspacePhoto | undefined {
  const [, contentType, base64] = PHOTO_DATA_URL.exec(text) ?? [];
  if (contentType === undefined || base64 === undefined || !isPhotoType(contentType)) {
    return undefined;
  }
  const bytes = Base64.decode(base64);
  // Note that the bytes must be the image the label names, because a tile draws them as one.
  if (Result.isFailure(bytes) || sniffImageType(bytes.success) !== contentType) return undefined;
  return { contentType, bytes: bytes.success };
}

/** A photo to set, as the `data:` URL it is kept as: one `workspacePhotoOfDataUrl` reads, within `WORKSPACE_PHOTO_BOUNDS.MAX_BYTES`. */
const workspacePhotoUrlSchema = EffectSchema.String.check(
  EffectSchema.makeFilter((text: string) => {
    const photo = workspacePhotoOfDataUrl(text);
    return photo !== undefined && photo.bytes.length <= WORKSPACE_PHOTO_BOUNDS.MAX_BYTES;
  }),
);

/** The GitHub account a workspace's connected installation is on: its login, and whether the installation is active. */
export const workspaceGithubSchema = EffectSchema.Struct({
  login: EffectSchema.String,
  /** False where the installation was suspended or removed on GitHub: the workspace's repository work is refused there. */
  active: EffectSchema.Boolean,
});

/** One installation connected to a workspace: GitHub's id for it, the login of the account it is on, and whether it is active. */
export const workspaceGithubInstallationSchema = EffectSchema.Struct({
  installationId: EffectSchema.Number,
  login: EffectSchema.String,
  /** False where the installation was suspended or removed on GitHub: its repositories are out of reach. */
  active: EffectSchema.Boolean,
});

export type WorkspaceGithubInstallation = typeof workspaceGithubInstallationSchema.Type;

/** A workspace's Linear connection: whether Connect still holds a grant for it; false once Linear refused it, which an owner or admin mends by connecting again. */
export const workspaceLinearSchema = EffectSchema.Struct({
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
  /** The GitHub account of its first-linked installation still active, else its first-linked, or null where none is connected: what a desktop from before several installations reads. */
  github: EffectSchema.NullOr(workspaceGithubSchema),
  /** Every installation connected to it, the first linked first; absent from a service from before several, where `github` is the whole of it. */
  githubInstallations: EffectSchema.optionalKey(
    EffectSchema.Array(workspaceGithubInstallationSchema),
  ),
  /**
   * The workspace's one Linear connection, which an owner or admin made for
   * every member (`linear-wire.ts`); absent where none is connected, and
   * from a service before it.
   */
  linear: EffectSchema.optionalKey(workspaceLinearSchema),
  /** How many members it has, the account among them, which the window says as who shares it; absent from a service before it. */
  memberCount: EffectSchema.optionalKey(countedNumber),
  /**
   * A short digest of the photo an owner or admin uploaded, present only
   * where the workspace holds one of `WORKSPACE_PHOTO_TYPE`; absent from a
   * service before photos. The photo's bytes never travel with the list,
   * which the desktop hands every window on every change: a window reads
   * them apart, at `workspacePhotoPath`, and reads them again only when the
   * digest changes.
   */
  photoVersion: EffectSchema.optionalKey(EffectSchema.String),
  /**
   * The owner's own sign-in picture, present only on the account's own first
   * workspace while it holds no uploaded photo, and only where the address is
   * one the renderer may draw (`account-picture.ts`); absent from a service
   * before it, and from every workspace a teammate shares.
   */
  pictureUrl: EffectSchema.optionalKey(EffectSchema.String),
  /**
   * True on a workspace that is the first one made for an account, to every
   * member of it: it is named by its owner's account name and is never
   * renamed. Absent from every other workspace, and from a service before it,
   * which the desktop reads as one it may offer to rename.
   */
  personal: EffectSchema.optionalKey(EffectSchema.Literal(true)),
});

export type Workspace = typeof workspaceSchema.Type;

/** The account's workspaces, its first one first and the rest by name (GET). */
export const workspacesAnswerSchema = EffectSchema.Struct({
  workspaces: EffectSchema.Array(workspaceSchema),
});

export type WorkspacesAnswer = typeof workspacesAnswerSchema.Type;

/** One workspace: the one created, renamed, or given a photo. */
export const workspaceAnswerSchema = EffectSchema.Struct({ workspace: workspaceSchema });

/** A workspace created (POST): its name, its ends trimmed; the account creating it is its owner. */
export const workspaceCreateRequestSchema = EffectSchema.Struct({
  name: EffectSchema.Trim.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(WORKSPACE_BOUNDS.MAX_NAME_CHARS),
  ),
});

/** A workspace renamed (POST) by an owner or admin of it, never an account's first workspace: the workspace, and its new name held as a created one's is; answered with the workspace. */
export const workspaceRenameRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  name: workspaceCreateRequestSchema.fields.name,
});

/** A workspace's photo set or removed (POST) by an owner or admin of it: the photo as a `data:` URL, or null to remove it; answered with the workspace. */
export const workspacePhotoSetRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  photo: EffectSchema.NullOr(workspacePhotoUrlSchema),
});

/** The workspace a GitHub account is connected to (POST), by an owner or admin of it. */
export const workspaceGithubRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
});

/** Where the browser goes to connect: the App's install address, carrying the single-use intent GitHub returns with. */
export const workspaceGithubConnectAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String.check(EffectSchema.isNonEmpty()),
});

/** The workspace whose Linear is connected or disconnected (POST), by an owner or admin of it (`linear-wire.ts`). */
export const workspaceLinearRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
});

/** Where the browser goes to connect Linear: Vercel Connect's sign-in address, for the workspace. */
export const workspaceLinearConnectAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String.check(EffectSchema.isNonEmpty()),
});

/**
 * The Linear issues a member asks for (POST): the workspace, and a search
 * where one is typed, or the one issue an identifier names, as a link to it
 * drawn in Luke's words asks for its title and state, answered alone or not
 * at all.
 */
export const linearIssuesRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  query: EffectSchema.optionalKey(
    EffectSchema.String.check(EffectSchema.isMaxLength(LINEAR_BOUNDS.MAX_QUERY_CHARS)),
  ),
  identifier: EffectSchema.optionalKey(linearIdentifierSchema),
});

export type LinearIssuesRequest = typeof linearIssuesRequestSchema.Type;

/** One member of a workspace: the account, its name and email, its role, and its sign-in picture. */
export const workspaceMemberSchema = EffectSchema.Struct({
  userId: EffectSchema.String,
  name: EffectSchema.String,
  email: EffectSchema.String,
  role: workspaceSchema.fields.role,
  /**
   * The member's sign-in picture, present only where it is an address the
   * renderer may draw (`account-picture.ts`); absent for a member with none,
   * and from a service before it.
   */
  pictureUrl: EffectSchema.optionalKey(EffectSchema.String),
});

export type WorkspaceMember = typeof workspaceMemberSchema.Type;

/**
 * Someone the workspace's work still names who is no longer a member of it:
 * their account, the name it holds now, and their sign-in picture on the
 * same terms as a member's.
 */
export const formerMemberSchema = EffectSchema.Struct({
  userId: EffectSchema.String,
  name: EffectSchema.String,
  pictureUrl: EffectSchema.optionalKey(EffectSchema.String),
});

export type FormerMember = typeof formerMemberSchema.Type;

/**
 * A workspace's members, owners first, then admins, then members, each by
 * name (GET, and after a removal, a role changed, or a handover); and on a
 * read, who the workspace's work still names but left, by name, absent where
 * nobody did and from a service before it.
 */
export const workspaceMembersAnswerSchema = EffectSchema.Struct({
  members: EffectSchema.Array(workspaceMemberSchema),
  former: EffectSchema.optionalKey(EffectSchema.Array(formerMemberSchema)),
});

/** The query a members read names its workspace under. */
export const WORKSPACE_MEMBERS_QUERY = { WORKSPACE_ID: "workspaceId" } as const;

/** Removing one member from a workspace (POST), answered with the members who remain. */
export const workspaceMemberRemovalSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  userId: EffectSchema.String.check(EffectSchema.isNonEmpty()),
});

/** The owner making another member an admin or an admin a member (POST), answered with the members as they then stand. */
export const workspaceMemberRoleSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  userId: workspaceMemberRemovalSchema.fields.userId,
  role: EffectSchema.Literals(Object.values(ASSIGNABLE_ROLE)),
});

/** The owner handing the workspace to one of its admins (POST), answered with the members as they then stand. */
export const workspaceTransferSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  userId: workspaceMemberRemovalSchema.fields.userId,
});

/** Leaving a workspace (POST), answered with the workspace left. */
export const workspaceLeaveRequestSchema = EffectSchema.Struct({ workspaceId: workspaceIdSchema });

/** The workspace the account left. */
export const workspaceLeaveAnswerSchema = workspaceLeaveRequestSchema;
