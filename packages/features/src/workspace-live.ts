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
  roleOf,
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMembersAnswer,
  type WorkspaceRole,
} from "./workspace-wire.js";

/**
 * workspace-live.ts -- the account's workspaces, and one workspace's people and pending invitations, as the desktop follows them over Neon Realtime: the sealed statements the service answers, and the rows they deliver.
 *
 * Neon's guide is followed as `live-wire.ts` follows it: the service builds
 * each statement with the account's id in it and seals it, and the desktop
 * subscribes to the statements, renews them, and decodes their rows here.
 * The rows are the wire's own values, each column under the key the wire
 * reads it by and each instant as epoch milliseconds; Realtime keeps no
 * order, so the reader orders them as the held read does.
 */

/**
 * The account's workspaces sealed for following: the address, and two
 * statements, its workspaces and the GitHub installations connected to
 * them, which the held read reads apart too, since a workspace holding
 * several would otherwise be a row for each. Asked to poll, or where
 * Realtime cannot seal them, the service answers each statement's rows
 * inline instead (`LIVE_POLL`).
 */
export const workspacesLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({
    workspaces: sealedLiveQuerySchema,
    installations: sealedLiveQuerySchema,
  }),
});

export type WorkspacesLiveAnswer = typeof workspacesLiveAnswerSchema.Type;

/** One workspace as its row delivers it: what the wire leaves out where it holds nothing is null. */
const workspaceLiveRowSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  name: EffectSchema.String,
  slug: EffectSchema.String,
  /** Whether it is the reader's own first workspace. */
  own: EffectSchema.Boolean,
  /** Whether it is anyone's first workspace. */
  personal: EffectSchema.Boolean,
  /** The plugin's role text, which may list several roles comma-separated. */
  role: EffectSchema.String,
  /** Whether its Linear connection stands; null where it holds none. */
  linearActive: EffectSchema.NullOr(EffectSchema.Boolean),
  memberCount: countedNumber,
  photoVersion: EffectSchema.NullOr(EffectSchema.String),
  /** The reader's own sign-in picture on their own first workspace, else null. */
  ownerImage: EffectSchema.NullOr(EffectSchema.String),
});

/** One installation connected to a workspace the reader is a member of, as its row delivers it. */
const workspaceInstallationLiveRowSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.String,
  installationId: countedNumber,
  login: EffectSchema.String,
  active: EffectSchema.Boolean,
  /** When it was first linked, which orders a workspace's installations. */
  linkedAt: countedNumber,
});

/** The workspaces' rows as Realtime delivers them, decoded at the boundary before anything reads them. */
export const workspacesLiveRowsSchema = EffectSchema.Struct({
  workspaces: EffectSchema.Array(workspaceLiveRowSchema),
  installations: EffectSchema.Array(workspaceInstallationLiveRowSchema),
});

type WorkspaceInstallationLiveRow = typeof workspaceInstallationLiveRowSchema.Type;

/** By code unit, as a comparator answers. */
function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A row as the wire carries its workspace, as the held read writes it: every
 * installation, the first linked first, and again the first still active,
 * else the first, as the one a desktop from before several reads.
 */
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
    ...(row.linearActive === null ? undefined : { linear: { active: row.linearActive } }),
    memberCount: row.memberCount,
    ...(row.photoVersion === null ? undefined : { photoVersion: row.photoVersion }),
    ...(pictureUrl === undefined ? undefined : { pictureUrl }),
    ...(row.personal ? { personal: true } : undefined),
  };
}

/** The account's workspaces as the held read answers them: its own first one first, the rest by name, then by id. */
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

/**
 * One workspace's people sealed for following, read for the account asking:
 * the address, and two statements, its members and who its work names but
 * left. The service answers `not-found` for a workspace the account is not
 * a member of; asked to poll, or where Realtime cannot seal them, it answers
 * each statement's rows inline instead (`LIVE_POLL`).
 */
export const workspaceMembersLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({
    members: sealedLiveQuerySchema,
    former: sealedLiveQuerySchema,
  }),
});

export type WorkspaceMembersLiveAnswer = typeof workspaceMembersLiveAnswerSchema.Type;

/** A workspace's people as their rows deliver them: each sign-in picture as the account holds it, null for none. */
export const workspaceMembersLiveRowsSchema = EffectSchema.Struct({
  members: EffectSchema.Array(
    EffectSchema.Struct({
      userId: EffectSchema.String,
      name: EffectSchema.String,
      email: EffectSchema.String,
      /** The plugin's role text, which may list several roles comma-separated. */
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

/** The order roles are listed in: owners, then admins, then members. */
const ROLE_ORDER: readonly WorkspaceRole[] = [
  WORKSPACE_ROLE.OWNER,
  WORKSPACE_ROLE.ADMIN,
  WORKSPACE_ROLE.MEMBER,
];

/** By name, then by id, as the held read orders people. */
function byName(
  a: { readonly name: string; readonly userId: string },
  b: { readonly name: string; readonly userId: string },
): number {
  return byText(a.name, b.name) || byText(a.userId, b.userId);
}

/** A picture the renderer may draw, under the key the wire carries it by; nothing for any other. */
function pictureOf(image: string | null): { readonly pictureUrl?: string } {
  const pictureUrl = pinnedPictureUrl(image);
  return pictureUrl === undefined ? {} : { pictureUrl };
}

/**
 * A workspace's people as the held read answers them: the members owners
 * first, then admins, then members, each by name, and who left by name,
 * absent where nobody did.
 */
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

/**
 * One workspace's pending invitations sealed for following, for an owner or
 * an admin of it: the address, the service's own origin each accept link is
 * built on, and one statement. The service answers `not-found` for a
 * workspace the account is not in and `not-permitted` for one it neither
 * owns nor administers; asked to poll, or where Realtime cannot seal it, it
 * answers the statement's rows inline instead (`LIVE_POLL`).
 */
export const workspaceInvitationsLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  origin: EffectSchema.String,
  queries: EffectSchema.Struct({ invitations: sealedLiveQuerySchema }),
});

/** A workspace's pending invitations as their rows deliver them, expired ones among them. */
export const workspaceInvitationsLiveRowsSchema = EffectSchema.Struct({
  invitations: EffectSchema.Array(
    EffectSchema.Struct({
      id: EffectSchema.String,
      email: EffectSchema.String,
      /** The plugin's role text, null where it holds none. */
      role: EffectSchema.NullOr(EffectSchema.String),
      expiresAt: countedNumber,
    }),
  ),
});

/**
 * The pending invitations as the held read answers them at `now`: those not
 * yet expired, which the live statement cannot bound, of a role an
 * invitation may carry, soonest to expire first, each with its accept link
 * on the service's `origin`.
 */
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
