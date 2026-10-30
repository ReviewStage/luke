import { Schema as EffectSchema } from "effect";
import type { ArchivedChannel, Channel } from "./channel-wire.js";
import { sealedLiveQuerySchema } from "./live-wire.js";
import { countedNumber } from "./service-wire.js";

/**
 * channel-live.ts -- a workspace's channels as the desktop follows them: the sealed statements the service answers, the rows they deliver, and the list a window draws from them.
 *
 * A build since this one follows the list itself (`workspaceChannels`):
 * every channel of the workspace, open or archived, as its row holds it;
 * and, for the reader alone, how many threads of each they may read and
 * when the latest was posted, how many of those wait on them, and when
 * they last looked at each. The host joins those parts into one row per
 * channel (`channelRowsOfLive`), keeps the rows in a collection, and draws
 * the list from them (`channelsOfRows`), so a reader hears only the
 * channels that moved and reads nothing else to draw them.
 *
 * Released desktops follow the older read (`channels`), whose rows only
 * mark where each channel stands and which the service answers until a
 * release cuts it: they read the list again over HTTP whenever a mark
 * moves.
 */

/**
 * One workspace's channels sealed for following as released desktops
 * follow them: the address, and two statements, its channels and where each
 * one's threads stand. The service answers `not-found` for a workspace the
 * account is not a member of; asked to poll, it answers each statement's
 * rows inline instead (`LIVE_POLL`).
 */
export const channelsLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({
    channels: sealedLiveQuerySchema,
    threads: sealedLiveQuerySchema,
  }),
});

/**
 * One workspace's channels list sealed for following, read for the account
 * asking: the address, and a statement for each part of what a channel
 * shows its reader. The service answers `not-found` for a workspace the
 * account is not a member of; asked to poll, it answers each statement's
 * rows inline instead (`LIVE_POLL`).
 */
export const workspaceChannelsLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({
    channels: sealedLiveQuerySchema,
    tallies: sealedLiveQuerySchema,
    waiting: sealedLiveQuerySchema,
    looks: sealedLiveQuerySchema,
  }),
});

export type WorkspaceChannelsLiveAnswer = typeof workspaceChannelsLiveAnswerSchema.Type;

/**
 * A workspace's channels list as its rows deliver it: each channel, its
 * archive null where it is open; how many threads of each the reader may
 * read and when the latest was posted, a channel with none left out; how
 * many of those wait on the reader, a channel where none does left out; and
 * when the reader last looked at each they ever looked at.
 */
export const workspaceChannelsLiveRowsSchema = EffectSchema.Struct({
  channels: EffectSchema.Array(
    EffectSchema.Struct({
      id: EffectSchema.String,
      name: EffectSchema.String,
      purpose: EffectSchema.String,
      project: EffectSchema.Boolean,
      createdBy: EffectSchema.NullOr(EffectSchema.String),
      createdAt: countedNumber,
      archivedAt: EffectSchema.NullOr(countedNumber),
    }),
  ),
  tallies: EffectSchema.Array(
    EffectSchema.Struct({
      channelId: EffectSchema.String,
      threads: countedNumber,
      latestPostedAt: countedNumber,
    }),
  ),
  waiting: EffectSchema.Array(
    EffectSchema.Struct({ channelId: EffectSchema.String, waiting: countedNumber }),
  ),
  looks: EffectSchema.Array(
    EffectSchema.Struct({ channelId: EffectSchema.String, lookedAt: countedNumber }),
  ),
});

export type WorkspaceChannelsLiveRows = typeof workspaceChannelsLiveRowsSchema.Type;

/**
 * One channel as the host's collection holds it: the channel's row and
 * what it holds for the reader, joined from the read's parts, each absent
 * value null, so a row compares whole with the one it replaces.
 */
export interface ChannelListRow {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  readonly project: boolean;
  readonly createdBy: string | null;
  readonly createdAt: number;
  /** Null where it is open. */
  readonly archivedAt: number | null;
  readonly waiting: number;
  readonly lookedAt: number | null;
  readonly latestPostedAt: number | null;
  readonly threads: number;
}

/** Each channel of the rows joined with what it holds for the reader, one row per channel. */
export function channelRowsOfLive(rows: WorkspaceChannelsLiveRows): readonly ChannelListRow[] {
  const tallies = new Map(rows.tallies.map((row) => [row.channelId, row] as const));
  const waiting = new Map(rows.waiting.map((row) => [row.channelId, row.waiting] as const));
  const looks = new Map(rows.looks.map((row) => [row.channelId, row.lookedAt] as const));
  return rows.channels.map((row) => {
    const tally = tallies.get(row.id);
    return {
      ...row,
      waiting: waiting.get(row.id) ?? 0,
      lookedAt: looks.get(row.id) ?? null,
      latestPostedAt: tally?.latestPostedAt ?? null,
      threads: tally?.threads ?? 0,
    };
  });
}

/** A workspace's channels as a window draws them: its open channels by name, and its archived ones, the latest archived first. */
export interface WorkspaceChannels {
  readonly open: readonly Channel[];
  readonly archived: readonly ArchivedChannel[];
}

/** What a channel row holds for the reader, as the wire carries it: each absent value left out rather than null. */
function heldFor(row: ChannelListRow) {
  return {
    ...(row.createdBy === null ? undefined : { createdBy: row.createdBy }),
    waiting: row.waiting,
    ...(row.latestPostedAt === null ? undefined : { latestPostedAt: row.latestPostedAt }),
    threads: row.threads,
  };
}

/** By code unit, as two names or ids compare however the host's locale reads them. */
function byCodeUnit(one: string, other: string): number {
  if (one === other) return 0;
  return one < other ? -1 : 1;
}

/**
 * The list a window draws from a workspace's channel rows, as the service's
 * list answers it: the open channels by name, each with the reader's look;
 * and the archived ones, the latest archived first, an id breaking a tie.
 */
export function channelsOfRows(rows: readonly ChannelListRow[]): WorkspaceChannels {
  const open = rows
    .filter((row) => row.archivedAt === null)
    .toSorted((one, other) => byCodeUnit(one.name, other.name))
    .map(
      (row): Channel => ({
        id: row.id,
        name: row.name,
        purpose: row.purpose,
        project: row.project,
        createdAt: row.createdAt,
        ...heldFor(row),
        ...(row.lookedAt === null ? undefined : { lookedAt: row.lookedAt }),
      }),
    );
  const archived = rows
    .flatMap((row) => (row.archivedAt === null ? [] : [{ row, archivedAt: row.archivedAt }]))
    .toSorted(
      (one, other) => other.archivedAt - one.archivedAt || byCodeUnit(one.row.id, other.row.id),
    )
    .map(
      ({ row, archivedAt }): ArchivedChannel => ({
        id: row.id,
        name: row.name,
        purpose: row.purpose,
        project: row.project,
        createdAt: row.createdAt,
        archivedAt,
        ...heldFor(row),
      }),
    );
  return { open, archived };
}
