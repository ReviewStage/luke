import { Schema } from "effect";
import { pinnedPictureUrl } from "./account-picture.js";
import { refuses } from "./contract/base.js";
import {
  LIVE_MODE,
  LIVE_PARAM,
  type LiveReadAnswer,
  type LiveRowOf,
  liveRead,
  liveRows,
  ORDER,
  orderedLiveRows,
} from "./live-read.js";
import { LIVE_READ, LIVE_USER_QUERY } from "./live-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { countedNumber, HOSTED_API_ERROR } from "./service-wire.js";
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

/**
 * workspace-live.ts -- the account's workspaces, and one workspace's people and pending invitations, as the desktop follows them over Neon Realtime: the reads declared, and what the desktop reads of their rows.
 *
 * Neon's guide is followed as `live-wire.ts` follows it: the service builds
 * each statement with the account's id in it and seals it, and the desktop
 * subscribes to the statements, renews them, and decodes their rows here.
 * The rows are the wire's own values, each column under the key the wire
 * reads it by and each instant as epoch milliseconds; Realtime keeps no
 * order, so the reader orders them as the held read does.
 */

/**
 * The account's workspaces as the desktop follows them: two parts, its
 * workspaces and the GitHub installations connected to them, which the
 * held read reads apart too, since a workspace holding several would
 * otherwise be a row for each. Its own first workspace stands first, the
 * rest by name, then by id; a workspace's installations by when they were
 * first linked, then by id.
 */
export const WORKSPACES_READ = liveRead({
  name: "workspaces",
  path: HOSTED_SERVICE_PATH.LIVE_WORKSPACES,
  params: { [LIVE_USER_QUERY]: LIVE_PARAM.USER },
  mode: LIVE_MODE.SNAPSHOT,
  parts: {
    workspaces: liveRows({
      row: Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        slug: Schema.String,
        /** Whether it is the reader's own first workspace. */
        own: Schema.Boolean,
        /** Whether it is anyone's first workspace. */
        personal: Schema.Boolean,
        /** The plugin's role text, which may list several roles comma-separated. */
        role: Schema.String,
        /** Always null: no workspace connects Linear any more, but a desktop from v0.22.0 fails its follow on a row without it, so the service still answers it and this build reads a row without it too. The key goes with the minimum supported desktop version. */
        linearActive: Schema.optionalKey(Schema.Null),
        memberCount: countedNumber,
        photoVersion: Schema.NullOr(Schema.String),
        /** The reader's own sign-in picture on their own first workspace, else null. */
        ownerImage: Schema.NullOr(Schema.String),
        /** The slugs it stood under before, a space between each, empty for none; absent from a service before slugs could change. */
        formerSlugs: Schema.optionalKey(Schema.String),
      }),
      key: "id",
      order: [
        ["own", ORDER.DESC],
        ["name", ORDER.ASC],
        ["id", ORDER.ASC],
      ],
    }),
    installations: liveRows({
      row: Schema.Struct({
        workspaceId: Schema.String,
        installationId: countedNumber,
        login: Schema.String,
        active: Schema.Boolean,
        /** When it was first linked, which orders a workspace's installations. */
        linkedAt: countedNumber,
      }),
      key: "installationId",
      order: [
        ["linkedAt", ORDER.ASC],
        ["installationId", ORDER.ASC],
      ],
    }),
  },
});

export type WorkspacesLiveAnswer = LiveReadAnswer<typeof WORKSPACES_READ>;

/** The workspaces' rows as Realtime delivers them. */
type WorkspacesLiveRows = typeof WORKSPACES_READ.rows.Type;

type WorkspaceInstallationLiveRow = LiveRowOf<typeof WORKSPACES_READ.parts.installations>;

/**
 * A row as the wire carries its workspace, as the held read writes it: every
 * installation, the first linked first, and again the first still active,
 * else the first, as the one a desktop from before several reads.
 */
function workspaceOfLiveRow(
  row: LiveRowOf<typeof WORKSPACES_READ.parts.workspaces>,
  installations: readonly WorkspaceInstallationLiveRow[],
): Workspace {
  const githubInstallations = orderedLiveRows(
    WORKSPACES_READ.parts.installations,
    installations,
  ).map(({ installationId, login, active }) => ({ installationId, login, active }));
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

/** The account's workspaces as the held read answers them: its own first one first, the rest by name, then by id. */
export function workspacesOfLiveRows(rows: WorkspacesLiveRows): readonly Workspace[] {
  const installations = new Map<string, WorkspaceInstallationLiveRow[]>();
  for (const row of rows.installations) {
    installations.set(row.workspaceId, [...(installations.get(row.workspaceId) ?? []), row]);
  }
  return orderedLiveRows(WORKSPACES_READ.parts.workspaces, rows.workspaces).map((row) =>
    workspaceOfLiveRow(row, installations.get(row.id) ?? []),
  );
}

/**
 * One workspace's people as the desktop follows them, read for the account
 * asking: two parts, its members and who its work names but left, each by
 * name, then by id. The service answers `not-found` for a workspace the
 * account is not a member of.
 */
export const WORKSPACE_MEMBERS_READ = liveRead({
  name: LIVE_READ.WORKSPACE_MEMBERS,
  path: HOSTED_SERVICE_PATH.LIVE_WORKSPACE_MEMBERS,
  params: { [LIVE_USER_QUERY]: LIVE_PARAM.USER, workspaceId: LIVE_PARAM.TEXT },
  mode: LIVE_MODE.SNAPSHOT,
  parts: {
    members: liveRows({
      row: Schema.Struct({
        userId: Schema.String,
        name: Schema.String,
        email: Schema.String,
        /** The plugin's role text, which may list several roles comma-separated. */
        role: Schema.String,
        /** The sign-in picture as the account holds it, null for none. */
        image: Schema.NullOr(Schema.String),
      }),
      key: "userId",
      order: [
        ["name", ORDER.ASC],
        ["userId", ORDER.ASC],
      ],
    }),
    former: liveRows({
      row: Schema.Struct({
        userId: Schema.String,
        name: Schema.String,
        image: Schema.NullOr(Schema.String),
      }),
      key: "userId",
      order: [
        ["name", ORDER.ASC],
        ["userId", ORDER.ASC],
      ],
    }),
  },
  refuses: refuses(HOSTED_API_ERROR.NOT_FOUND),
});

export type WorkspaceMembersLiveAnswer = LiveReadAnswer<typeof WORKSPACE_MEMBERS_READ>;

/** The order roles are listed in: owners, then admins, then members. */
const ROLE_ORDER: readonly WorkspaceRole[] = [
  WORKSPACE_ROLE.OWNER,
  WORKSPACE_ROLE.ADMIN,
  WORKSPACE_ROLE.MEMBER,
];

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
  rows: typeof WORKSPACE_MEMBERS_READ.rows.Type,
): WorkspaceMembersAnswer {
  const members = orderedLiveRows(WORKSPACE_MEMBERS_READ.parts.members, rows.members).map(
    ({ image, role, ...member }) => ({ ...member, role: roleOf(role), ...pictureOf(image) }),
  );
  const former = orderedLiveRows(WORKSPACE_MEMBERS_READ.parts.former, rows.former).map(
    ({ image, ...person }) => ({ ...person, ...pictureOf(image) }),
  );
  return {
    members: ROLE_ORDER.flatMap((role) => members.filter((one) => one.role === role)),
    ...(former.length === 0 ? undefined : { former }),
  };
}

/**
 * One workspace's pending invitations as the desktop follows them, for an
 * owner or an admin of it: one part, its pending invitations, expired ones
 * among them, soonest to expire first, and the service's own origin each
 * accept link is built on beside it. The service answers `not-found` for a
 * workspace the account is not in and `not-permitted` for one it neither
 * owns nor administers.
 */
export const WORKSPACE_INVITATIONS_READ = liveRead({
  name: LIVE_READ.WORKSPACE_INVITATIONS,
  path: HOSTED_SERVICE_PATH.LIVE_WORKSPACE_INVITATIONS,
  params: { [LIVE_USER_QUERY]: LIVE_PARAM.USER, workspaceId: LIVE_PARAM.TEXT },
  mode: LIVE_MODE.SNAPSHOT,
  parts: {
    invitations: liveRows({
      row: Schema.Struct({
        id: Schema.String,
        email: Schema.String,
        /** The plugin's role text, null where it holds none. */
        role: Schema.NullOr(Schema.String),
        expiresAt: countedNumber,
      }),
      key: "id",
      order: [["expiresAt", ORDER.ASC]],
    }),
  },
  beside: { origin: Schema.String },
  refuses: refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED),
});

export type WorkspaceInvitationsLiveAnswer = LiveReadAnswer<typeof WORKSPACE_INVITATIONS_READ>;

/** A workspace's pending invitations as their rows deliver them. */
type WorkspaceInvitationsLiveRows = typeof WORKSPACE_INVITATIONS_READ.rows.Type;

/**
 * The pending invitations as the held read answers them at `now`: those not
 * yet expired, which the live statement cannot bound, of a role an
 * invitation may carry, soonest to expire first, each with its accept link
 * on the service's `origin`.
 */
export function workspaceInvitationsOfLiveRows(
  rows: WorkspaceInvitationsLiveRows,
  origin: string,
  now: number,
): readonly WorkspaceInvitation[] {
  return orderedLiveRows(WORKSPACE_INVITATIONS_READ.parts.invitations, rows.invitations)
    .filter((one) => one.expiresAt > now)
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

/**
 * The instant after `now` the soonest pending invitation expires at, where
 * one does, which is when the held read built from `rows` next leaves one
 * out with no row moving; none where every one has expired.
 */
export function nextInvitationExpiry(
  rows: WorkspaceInvitationsLiveRows,
  now: number,
): number | undefined {
  const pending = rows.invitations.map((one) => one.expiresAt).filter((at) => at > now);
  return pending.length === 0 ? undefined : Math.min(...pending);
}
