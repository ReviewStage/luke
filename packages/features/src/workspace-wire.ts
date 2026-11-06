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

export const WORKSPACE_ROLE = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
} as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLE)[keyof typeof WORKSPACE_ROLE];

const WORKSPACE_ROLES: readonly WorkspaceRole[] = Object.values(WORKSPACE_ROLE);

export function roleOf(text: string): WorkspaceRole {
  const named = text.split(",").map((part) => part.trim());
  return WORKSPACE_ROLES.find((role) => named.includes(role)) ?? WORKSPACE_ROLE.MEMBER;
}

export const ASSIGNABLE_ROLE = {
  ADMIN: WORKSPACE_ROLE.ADMIN,
  MEMBER: WORKSPACE_ROLE.MEMBER,
} as const;

export { RESERVED_WORKSPACE_SLUGS };

export const WORKSPACE_BOUNDS = {
  MAX_NAME_CHARS: 64,
  MAX_SLUG_CHARS: 48,
} as const;

export const PERSONAL_WORKSPACE_SLUG_PREFIX = "personal-";

const WORKSPACE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const WORKSPACE_SLUG_PROBLEM = {
  MALFORMED: "malformed",
  RESERVED: "reserved",
  TAKEN: "taken",
} as const;

export type WorkspaceSlugProblem =
  (typeof WORKSPACE_SLUG_PROBLEM)[keyof typeof WORKSPACE_SLUG_PROBLEM];

export function workspaceSlugProblemOf(slug: string): WorkspaceSlugProblem | undefined {
  if (slug.length > WORKSPACE_BOUNDS.MAX_SLUG_CHARS || !WORKSPACE_SLUG_PATTERN.test(slug)) {
    return WORKSPACE_SLUG_PROBLEM.MALFORMED;
  }
  const reserved =
    RESERVED_WORKSPACE_SLUGS.has(slug) || slug.startsWith(PERSONAL_WORKSPACE_SLUG_PREFIX);
  return reserved ? WORKSPACE_SLUG_PROBLEM.RESERVED : undefined;
}

export const WORKSPACE_PHOTO_TYPE = PICTURE_TYPE;

export type WorkspacePhotoType = PictureType;

export const workspacePhotoTypeSchema = pictureTypeSchema;

export const WORKSPACE_PHOTO_BOUNDS = {
  MAX_BYTES: 100_000,
} as const;

export type WorkspacePhoto = Picture;

export const workspacePhotoOfDataUrl: (text: string) => WorkspacePhoto | undefined =
  pictureOfDataUrl;

const workspacePhotoUrlSchema = EffectSchema.String.check(
  EffectSchema.makeFilter((text: string) => {
    const photo = workspacePhotoOfDataUrl(text);
    return photo !== undefined && photo.bytes.length <= WORKSPACE_PHOTO_BOUNDS.MAX_BYTES;
  }),
);

const workspaceGithubSchema = EffectSchema.Struct({
  login: EffectSchema.String,
  active: EffectSchema.Boolean,
});

const workspaceGithubInstallationSchema = EffectSchema.Struct({
  installationId: EffectSchema.Number,
  login: EffectSchema.String,
  active: EffectSchema.Boolean,
});

export type WorkspaceGithubInstallation = typeof workspaceGithubInstallationSchema.Type;

export const workspaceSchema = EffectSchema.Struct({
  id: workspaceIdSchema,
  name: EffectSchema.String,
  slug: EffectSchema.optionalKey(EffectSchema.String),
  formerSlugs: EffectSchema.optionalKey(EffectSchema.Array(EffectSchema.String)),
  role: EffectSchema.Literals(Object.values(WORKSPACE_ROLE)),
  github: EffectSchema.NullOr(workspaceGithubSchema),
  githubInstallations: EffectSchema.optionalKey(
    EffectSchema.Array(workspaceGithubInstallationSchema),
  ),
  memberCount: EffectSchema.optionalKey(countedNumber),
  photoVersion: EffectSchema.optionalKey(EffectSchema.String),
  pictureUrl: EffectSchema.optionalKey(EffectSchema.String),
  personal: EffectSchema.optionalKey(EffectSchema.Literal(true)),
});

export type Workspace = typeof workspaceSchema.Type;

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

export function formerSlugsOf(spelled: string): Pick<Workspace, "formerSlugs"> {
  const formerSlugs = spelled.split(" ").filter((slug) => slug !== "");
  return formerSlugs.length === 0 ? {} : { formerSlugs };
}

export const workspacesAnswerSchema = EffectSchema.Struct({
  workspaces: EffectSchema.Array(workspaceSchema),
});

export const workspaceAnswerSchema = EffectSchema.Struct({ workspace: workspaceSchema });

export const workspaceCreateRequestSchema = EffectSchema.Struct({
  name: EffectSchema.Trim.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(WORKSPACE_BOUNDS.MAX_NAME_CHARS),
  ),
});

export const workspaceRenameRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  name: workspaceCreateRequestSchema.fields.name,
});

export const workspaceSlugSetRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  slug: EffectSchema.String,
});

export const workspacePhotoSetRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  photo: EffectSchema.NullOr(workspacePhotoUrlSchema),
});

export const workspaceGithubRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
});

export const workspaceGithubConnectAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String.check(EffectSchema.isNonEmpty()),
});

export const workspaceMemberSchema = EffectSchema.Struct({
  userId: EffectSchema.String,
  name: EffectSchema.String,
  email: EffectSchema.String,
  role: workspaceSchema.fields.role,
  pictureUrl: EffectSchema.optionalKey(EffectSchema.String),
});

export type WorkspaceMember = typeof workspaceMemberSchema.Type;

export const formerMemberSchema = EffectSchema.Struct({
  userId: EffectSchema.String,
  name: EffectSchema.String,
  pictureUrl: EffectSchema.optionalKey(EffectSchema.String),
});

export type FormerMember = typeof formerMemberSchema.Type;

export const workspaceMembersAnswerSchema = EffectSchema.Struct({
  members: EffectSchema.Array(workspaceMemberSchema),
  former: EffectSchema.optionalKey(EffectSchema.Array(formerMemberSchema)),
});

export type WorkspaceMembersAnswer = typeof workspaceMembersAnswerSchema.Type;

export const WORKSPACE_MEMBERS_QUERY = { WORKSPACE_ID: "workspaceId" } as const;

export const workspaceMemberRemovalSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  userId: EffectSchema.String.check(EffectSchema.isNonEmpty()),
});

export const workspaceMemberRoleSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  userId: workspaceMemberRemovalSchema.fields.userId,
  role: EffectSchema.Literals(Object.values(ASSIGNABLE_ROLE)),
});

export const workspaceTransferSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  userId: workspaceMemberRemovalSchema.fields.userId,
});

export const workspaceLeaveRequestSchema = EffectSchema.Struct({ workspaceId: workspaceIdSchema });

export const workspaceTokenRepositoryRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  repository: githubRepositoryFullNameSchema,
  added: EffectSchema.Boolean,
});

export const workspaceLeaveAnswerSchema = workspaceLeaveRequestSchema;
