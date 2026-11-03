import { Schema as EffectSchema } from "effect";
import { githubRepositoryFullNameSchema } from "./github-repositories-wire.js";
import { RESERVED_WORKSPACE_SLUGS } from "./link-home.js";
import {
  PICTURE_TYPE,
  type Picture,
  type PictureType,
  pictureOfDataUrl,
  pictureTypeSchema,
} from "./picture-wire.js";
import { countedNumber } from "./service-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

/**
 * workspace-wire.ts -- the workspaces an account is a member of, a workspace it creates, renames, or gives a photo, and the GitHub organization an admin connects to one, as the desktop reads and asks for them.
 *
 * A workspace is a team in the app: the first one, made for the account when it
 * first signs in, or one a member created; either way teammates join by
 * invitation. Membership has nothing
 * to do with GitHub. A workspace's repositories come from the installations
 * of our GitHub App an owner or admin connects to it, one per GitHub
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
 * before them reads it. A workspace's id is the one a task's summary names, `task-wire.ts`'s
 * `workspaceIdSchema`.
 *
 * A member of a workspace reads its members; an owner or an admin renames
 * it, and anyone but an owner leaves. A workspace has one owner, its
 * creator, until the owner hands it to an admin and becomes an admin. The
 * owner alone makes a member an admin or an admin a member, and removes an
 * admin; an admin removes a member alone. Nobody changes or removes
 * themselves, whose way out is leaving, or the owner. A rename moves the
 * name alone: the slug stays the one the workspace was made under, until the
 * owner, and the owner alone, changes it.
 *
 * A workspace's slug is the first step of our links' paths
 * (`https://vespin.dev/<slug>/task/<id>`, `mention-link.ts`), so no workspace
 * takes one our own pages stand under: `RESERVED_WORKSPACE_SLUGS`. The
 * slug only reads well; a link is found by the task's id alone, so a slug
 * the owner changes breaks no link written under the old one, and links
 * written after it are written under the new. A slug the owner chooses is
 * held to the rules a slug spelled from a name keeps
 * (`workspaceSlugProblemOf`), and to no other workspace's, whatever its case.
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

const WORKSPACE_ROLES: readonly WorkspaceRole[] = Object.values(WORKSPACE_ROLE);

/** The highest role the plugin's role text names, which may list several comma-separated, read as a member where it names none we know. */
export function roleOf(text: string): WorkspaceRole {
  const named = text.split(",").map((part) => part.trim());
  return WORKSPACE_ROLES.find((role) => named.includes(role)) ?? WORKSPACE_ROLE.MEMBER;
}

/**
 * The roles a member is given, by an invitation or by the owner: a
 * workspace has one owner, its creator, so nobody is made one but by the
 * owner handing it over.
 */
export const ASSIGNABLE_ROLE = {
  ADMIN: WORKSPACE_ROLE.ADMIN,
  MEMBER: WORKSPACE_ROLE.MEMBER,
} as const;

// Note that the set stands in `link-home.ts`, which imports nothing, so the link grammar reads it without a cycle through here.
export { RESERVED_WORKSPACE_SLUGS };

export const WORKSPACE_BOUNDS = {
  /** The most characters a workspace's name may spell, after its ends are trimmed. */
  MAX_NAME_CHARS: 64,
  /** The most characters a slug spelled from a name, or chosen by an owner, may hold. */
  MAX_SLUG_CHARS: 48,
} as const;

/** The opening of the slug an account's first workspace falls back to, `personal-<id>`, which no other slug takes. */
export const PERSONAL_WORKSPACE_SLUG_PREFIX = "personal-";

/** A slug's shape: runs of lowercase letters and digits, one hyphen between each run and the next. */
const WORKSPACE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** Why a slug an owner chose was refused. */
export const WORKSPACE_SLUG_PROBLEM = {
  /** Something other than lowercase letters, digits, and single hyphens between them, or none, or more than `WORKSPACE_BOUNDS.MAX_SLUG_CHARS`. */
  MALFORMED: "malformed",
  /** One of `RESERVED_WORKSPACE_SLUGS`, or one opening `PERSONAL_WORKSPACE_SLUG_PREFIX`. */
  RESERVED: "reserved",
  /** Another workspace's, whatever its case. */
  TAKEN: "taken",
} as const;

export type WorkspaceSlugProblem =
  (typeof WORKSPACE_SLUG_PROBLEM)[keyof typeof WORKSPACE_SLUG_PROBLEM];

/**
 * What is wrong with a slug by its spelling alone, or nothing: the window
 * says it as it is typed, and the service refuses it on the same reading.
 * Whether another workspace holds it only the service knows.
 */
export function workspaceSlugProblemOf(slug: string): WorkspaceSlugProblem | undefined {
  if (slug.length > WORKSPACE_BOUNDS.MAX_SLUG_CHARS || !WORKSPACE_SLUG_PATTERN.test(slug)) {
    return WORKSPACE_SLUG_PROBLEM.MALFORMED;
  }
  const reserved =
    RESERVED_WORKSPACE_SLUGS.has(slug) || slug.startsWith(PERSONAL_WORKSPACE_SLUG_PREFIX);
  return reserved ? WORKSPACE_SLUG_PROBLEM.RESERVED : undefined;
}

/**
 * The image types a workspace's photo may be: a picture's (`picture-wire.ts`),
 * kept as a `data:` URL of one of them, served as its bytes under it, and drawn
 * by a window from a `data:` URL of its own making.
 */
export const WORKSPACE_PHOTO_TYPE = PICTURE_TYPE;

export type WorkspacePhotoType = PictureType;

/** A workspace photo's media type as the wire carries it. */
export const workspacePhotoTypeSchema = pictureTypeSchema;

export const WORKSPACE_PHOTO_BOUNDS = {
  /**
   * The most bytes a photo set on a workspace may hold, decoded. The desktop
   * sends a 256-pixel square WebP, a few kilobytes, so this holds the bound
   * well clear of any photo it makes while keeping the list's row small.
   */
  MAX_BYTES: 100_000,
} as const;

/** A workspace's photo, as its bytes under its media type. */
export type WorkspacePhoto = Picture;

/**
 * The photo a `data:` URL holds, where its type is one of
 * `WORKSPACE_PHOTO_TYPE` and its bytes read as that image; nothing for any
 * other text. The one reading of a photo's URL, for the photo set and the
 * photo kept.
 */
export const workspacePhotoOfDataUrl: (text: string) => WorkspacePhoto | undefined =
  pictureOfDataUrl;

/** A photo to set, as the `data:` URL it is kept as: one `workspacePhotoOfDataUrl` reads, within `WORKSPACE_PHOTO_BOUNDS.MAX_BYTES`. */
const workspacePhotoUrlSchema = EffectSchema.String.check(
  EffectSchema.makeFilter((text: string) => {
    const photo = workspacePhotoOfDataUrl(text);
    return photo !== undefined && photo.bytes.length <= WORKSPACE_PHOTO_BOUNDS.MAX_BYTES;
  }),
);

/** The GitHub account a workspace's connected installation is on: its login, and whether the installation is active. */
const workspaceGithubSchema = EffectSchema.Struct({
  login: EffectSchema.String,
  /** False where the installation was suspended or removed on GitHub: the workspace's repository work is refused there. */
  active: EffectSchema.Boolean,
});

/** One installation connected to a workspace: GitHub's id for it, the login of the account it is on, and whether it is active. */
const workspaceGithubInstallationSchema = EffectSchema.Struct({
  installationId: EffectSchema.Number,
  login: EffectSchema.String,
  /** False where the installation was suspended or removed on GitHub: its repositories are out of reach. */
  active: EffectSchema.Boolean,
});

export type WorkspaceGithubInstallation = typeof workspaceGithubInstallationSchema.Type;

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
   * absent from a service before slugs traveled, which the desktop reads
   * past, since a link is found by its task's id alone.
   */
  slug: EffectSchema.optionalKey(EffectSchema.String),
  /**
   * The slugs it stood under before its owner changed it, which stay its
   * own, so a link written under one still names it (`workspaceOfSlug`);
   * absent where it never changed, and from a service before slugs could.
   */
  formerSlugs: EffectSchema.optionalKey(EffectSchema.Array(EffectSchema.String)),
  role: EffectSchema.Literals(Object.values(WORKSPACE_ROLE)),
  /** The GitHub account of its first-linked installation still active, else its first-linked, or null where none is connected: what a desktop from before several installations reads. */
  github: EffectSchema.NullOr(workspaceGithubSchema),
  /** Every installation connected to it, the first linked first; absent from a service from before several, where `github` is the whole of it. */
  githubInstallations: EffectSchema.optionalKey(
    EffectSchema.Array(workspaceGithubInstallationSchema),
  ),
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

/**
 * The workspace a link's first step names among the reader's own: the one
 * it names by id, else the one that stands under it as its slug now, else
 * the one that stood under it before, a slug read whatever its case; nothing
 * where none of them does. The one reading of a link's workspace every
 * reader goes through, since a slug alone names a workspace in a link no
 * task's id pins, and only the reader's own workspaces are ever handed in,
 * so a link names no workspace its reader is not a member of.
 */
export function workspaceOfSlug<Listed extends Pick<Workspace, "id" | "slug" | "formerSlugs">>(
  workspaces: readonly Listed[],
  step: string,
): Listed | undefined {
  const asked = step.toLowerCase();
  return (
    workspaces.find((one) => one.id === step) ??
    workspaces.find((one) => one.slug?.toLowerCase() === asked) ??
    workspaces.find((one) => one.formerSlugs?.some((former) => former.toLowerCase() === asked))
  );
}

/** The slugs a workspace stood under before, as `formerSlugs` carries them: the text a row spells them in, a space between each, read as a list, and absent for none. */
export function formerSlugsOf(spelled: string): Pick<Workspace, "formerSlugs"> {
  const formerSlugs = spelled.split(" ").filter((slug) => slug !== "");
  return formerSlugs.length === 0 ? {} : { formerSlugs };
}

/** The account's workspaces, its first one first and the rest by name (GET). */
export const workspacesAnswerSchema = EffectSchema.Struct({
  workspaces: EffectSchema.Array(workspaceSchema),
});

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

/**
 * A workspace's slug changed (POST) by its owner alone: the workspace, and
 * the slug as typed, which the service reads by `workspaceSlugProblemOf`
 * itself so a refusal names why; answered with the workspace.
 */
export const workspaceSlugSetRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  slug: EffectSchema.String,
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

export type WorkspaceMembersAnswer = typeof workspaceMembersAnswerSchema.Type;

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

/** A repository added to a workspace on the caller's own GitHub token, or removed from it (`github-repositories-wire.ts`). */
export const workspaceTokenRepositoryRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  repository: githubRepositoryFullNameSchema,
  added: EffectSchema.Boolean,
});

/** The workspace the account left. */
export const workspaceLeaveAnswerSchema = workspaceLeaveRequestSchema;
