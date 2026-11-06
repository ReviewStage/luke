import { Schema as EffectSchema } from "effect";
import { pinnedPictureUrl } from "./account-picture.js";
import { sealedLiveQuerySchema } from "./live-wire.js";
import { countedNumber } from "./service-wire.js";
import {
  INVITATION_ROLE,
  invitationAcceptUrl,
  type WorkspaceInvitation,
} from "./workspace-invitation-wire.js";
import {
  formerSlugsOf,
  roleOf,
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMembersAnswer,
  type WorkspaceRole,
} from "./workspace-wire.js";

export const workspacesLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({
    workspaces: sealedLiveQuerySchema,
    installations: sealedLiveQuerySchema,
  }),
});

export type WorkspacesLiveAnswer = typeof workspacesLiveAnswerSchema.Type;

const workspaceLiveRowSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  name: EffectSchema.String,
  slug: EffectSchema.String,
  own: EffectSchema.Boolean,
  personal: EffectSchema.Boolean,
  role: EffectSchema.String,
  memberCount: countedNumber,
  photoVersion: EffectSchema.NullOr(EffectSchema.String),
  ownerImage: EffectSchema.NullOr(EffectSchema.String),
  formerSlugs: EffectSchema.optionalKey(EffectSchema.String),
});

const workspaceInstallationLiveRowSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.String,
  installationId: countedNumber,
  login: EffectSchema.String,
  active: EffectSchema.Boolean,
  linkedAt: countedNumber,
});

export const workspacesLiveRowsSchema = EffectSchema.Struct({
  workspaces: EffectSchema.Array(workspaceLiveRowSchema),
  installations: EffectSchema.Array(workspaceInstallationLiveRowSchema),
});

type WorkspaceInstallationLiveRow = typeof workspaceInstallationLiveRowSchema.Type;

function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function workspaceOfLiveRow(
  row: typeof workspaceLiveRowSchema.Type,
  installations: readonly WorkspaceInstallationLiveRow[],
): Workspace {
  const githubInstallations = installations
    .toSorted((a, b) => a.linkedAt - b.linkedAt || a.installationId - b.installationId)
    .map(({ installationId, login, active }) => ({ installationId, login, active }));
  const first = githubInstallations.find((one) => one.active) ?? githubInstallations[0];
  const pictureUrl =
    row.photoVersion === null && row.own ? pinnedPictureUrl(row.ownerImage) : undefined;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    role: roleOf(row.role),
    github: first === undefined ? null : { login: first.login, active: first.active },
    githubInstallations,
    memberCount: row.memberCount,
    ...formerSlugsOf(row.formerSlugs ?? ""),
    ...(row.photoVersion === null ? undefined : { photoVersion: row.photoVersion }),
    ...(pictureUrl === undefined ? undefined : { pictureUrl }),
    ...(row.personal ? { personal: true } : undefined),
  };
}

export function workspacesOfLiveRows(
  rows: typeof workspacesLiveRowsSchema.Type,
): readonly Workspace[] {
  const installations = new Map<string, WorkspaceInstallationLiveRow[]>();
  for (const row of rows.installations) {
    installations.set(row.workspaceId, [...(installations.get(row.workspaceId) ?? []), row]);
  }
  return rows.workspaces
    .toSorted(
      (a, b) => Number(b.own) - Number(a.own) || byText(a.name, b.name) || byText(a.id, b.id),
    )
    .map((row) => workspaceOfLiveRow(row, installations.get(row.id) ?? []));
}

export const workspaceMembersLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({
    members: sealedLiveQuerySchema,
    former: sealedLiveQuerySchema,
  }),
});

export type WorkspaceMembersLiveAnswer = typeof workspaceMembersLiveAnswerSchema.Type;

export const workspaceMembersLiveRowsSchema = EffectSchema.Struct({
  members: EffectSchema.Array(
    EffectSchema.Struct({
      userId: EffectSchema.String,
      name: EffectSchema.String,
      email: EffectSchema.String,
      role: EffectSchema.String,
      image: EffectSchema.NullOr(EffectSchema.String),
    }),
  ),
  former: EffectSchema.Array(
    EffectSchema.Struct({
      userId: EffectSchema.String,
      name: EffectSchema.String,
      image: EffectSchema.NullOr(EffectSchema.String),
    }),
  ),
});

const ROLE_ORDER: readonly WorkspaceRole[] = [
  WORKSPACE_ROLE.OWNER,
  WORKSPACE_ROLE.ADMIN,
  WORKSPACE_ROLE.MEMBER,
];

function byName(
  a: { readonly name: string; readonly userId: string },
  b: { readonly name: string; readonly userId: string },
): number {
  return byText(a.name, b.name) || byText(a.userId, b.userId);
}

function pictureOf(image: string | null): { readonly pictureUrl?: string } {
  const pictureUrl = pinnedPictureUrl(image);
  return pictureUrl === undefined ? {} : { pictureUrl };
}

export function workspaceMembersOfLiveRows(
  rows: typeof workspaceMembersLiveRowsSchema.Type,
): WorkspaceMembersAnswer {
  const members = rows.members
    .toSorted(byName)
    .map(({ image, role, ...member }) => ({ ...member, role: roleOf(role), ...pictureOf(image) }));
  const former = rows.former
    .toSorted(byName)
    .map(({ image, ...person }) => ({ ...person, ...pictureOf(image) }));
  return {
    members: ROLE_ORDER.flatMap((role) => members.filter((one) => one.role === role)),
    ...(former.length === 0 ? undefined : { former }),
  };
}

export const workspaceInvitationsLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  origin: EffectSchema.String,
  queries: EffectSchema.Struct({ invitations: sealedLiveQuerySchema }),
});

export type WorkspaceInvitationsLiveAnswer = typeof workspaceInvitationsLiveAnswerSchema.Type;

export const workspaceInvitationsLiveRowsSchema = EffectSchema.Struct({
  invitations: EffectSchema.Array(
    EffectSchema.Struct({
      id: EffectSchema.String,
      email: EffectSchema.String,
      role: EffectSchema.NullOr(EffectSchema.String),
      expiresAt: countedNumber,
    }),
  ),
});

export function workspaceInvitationsOfLiveRows(
  rows: typeof workspaceInvitationsLiveRowsSchema.Type,
  origin: string,
  now: number,
): readonly WorkspaceInvitation[] {
  return rows.invitations
    .filter((one) => one.expiresAt > now)
    .toSorted((first, second) => first.expiresAt - second.expiresAt)
    .flatMap((one) => {
      const role = Object.values(INVITATION_ROLE).find((each) => each === one.role);
      if (role === undefined) return [];
      return [
        {
          id: one.id,
          email: one.email,
          role,
          expiresAt: new Date(one.expiresAt).toISOString(),
          acceptUrl: invitationAcceptUrl(origin, one.id, one.email),
        },
      ];
    });
}

export function nextInvitationExpiry(
  rows: typeof workspaceInvitationsLiveRowsSchema.Type,
  now: number,
): number | undefined {
  const pending = rows.invitations.map((one) => one.expiresAt).filter((at) => at > now);
  return pending.length === 0 ? undefined : Math.min(...pending);
}
