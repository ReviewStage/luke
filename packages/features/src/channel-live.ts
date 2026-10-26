import { Schema as EffectSchema } from "effect";
import { sealedLiveQuerySchema } from "./live-wire.js";
import { countedNumber } from "./service-wire.js";

/**
 * channel-live.ts -- a workspace's channels as the desktop follows them over Neon Realtime: the sealed statements the service answers, the rows they deliver, and which channels moved between two deliveries.
 *
 * The rows mark where the channels stand rather than carry what a window
 * draws: every channel of the workspace, open or archived, with its name,
 * purpose, and when it was archived; and, for each channel, how many threads
 * the reader may read there and when the latest of them last changed. A
 * reader that hears a channel moved reads the channels, and that channel's
 * threads if it shows them, again through the held reads
 * (`channel-wire.ts`), which answer for the reader alone what waits on them.
 * Realtime keeps no order, so nothing here reads one.
 */

/**
 * One workspace's channels sealed for following, read for the account
 * asking: the address, and two statements, its channels and where each
 * one's threads stand. The service answers `not-found` for a workspace the
 * account is not a member of; asked to poll, or where Realtime cannot seal
 * them, it answers each statement's rows inline instead (`LIVE_POLL`).
 */
export const channelsLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({
    channels: sealedLiveQuerySchema,
    threads: sealedLiveQuerySchema,
  }),
});

export type ChannelsLiveAnswer = typeof channelsLiveAnswerSchema.Type;

/** A workspace's channels as their rows deliver them: each channel, null where it is open; and each channel's threads as a count and when the latest changed. */
export const channelsLiveRowsSchema = EffectSchema.Struct({
  channels: EffectSchema.Array(
    EffectSchema.Struct({
      id: EffectSchema.String,
      name: EffectSchema.String,
      purpose: EffectSchema.String,
      project: EffectSchema.Boolean,
      archivedAt: EffectSchema.NullOr(countedNumber),
    }),
  ),
  threads: EffectSchema.Array(
    EffectSchema.Struct({
      channelId: EffectSchema.String,
      threads: countedNumber,
      updatedAt: countedNumber,
    }),
  ),
});

export type ChannelsLiveRows = typeof channelsLiveRowsSchema.Type;

/** Where each channel the rows name stands, as one comparable value by its id. */
function marksOf(rows: ChannelsLiveRows): ReadonlyMap<string, string> {
  const threads = new Map(rows.threads.map((row) => [row.channelId, row] as const));
  const ids = new Set([...rows.channels.map((row) => row.id), ...threads.keys()]);
  return new Map(
    [...ids].map((id) => {
      const row = rows.channels.find((each) => each.id === id);
      const thread = threads.get(id);
      const mark = [row?.name, row?.purpose, row?.archivedAt, thread?.threads, thread?.updatedAt];
      return [id, JSON.stringify(mark)] as const;
    }),
  );
}

/**
 * The channels whose row or threads moved between two deliveries, by id,
 * a channel gone from the later among them; every channel the later names
 * where there is no earlier, since the read a window opened with may have
 * missed what it says.
 */
export function channelsMovedBetween(
  before: ChannelsLiveRows | undefined,
  after: ChannelsLiveRows,
): readonly string[] {
  const now = marksOf(after);
  if (before === undefined) return [...now.keys()].toSorted();
  const was = marksOf(before);
  const ids = new Set([...was.keys(), ...now.keys()]);
  return [...ids].filter((id) => was.get(id) !== now.get(id)).toSorted();
}
