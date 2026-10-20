import { Schema as EffectSchema } from "effect";
import { pinnedPictureUrl } from "./account-picture.js";
import { sealedLiveQuerySchema } from "./live-wire.js";
import { countedNumber } from "./service-wire.js";
import { roleOf, type Workspace } from "./workspace-wire.js";

/**
 * workspace-live.ts -- the account's workspaces as the desktop follows them over Neon Realtime: the sealed statements the service answers, and the rows they deliver.
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
