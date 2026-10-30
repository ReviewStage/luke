/**
 * channel-collections.ts -- a workspace's channels held in a TanStack DB collection: fed by the list's follow, drawn as the window lists them, and changed by a write the moment it is asked.
 *
 * The list's parts are joined into one row per channel
 * (`@luke/features/channel-live`), and the rows kept in a collection of
 * their own (`live-collection.ts`), so an answer that moved one channel
 * writes that one row and leaves every other as it stood. The list is drawn
 * from the rows whole, its open channels by name and its archived ones the
 * latest archived first, once for each answer that moved a row and as each
 * write is drawn and settles. Nothing is drawn until the follow first
 * answers, so a write asked before then never draws a list holding nothing
 * else.
 *
 * A rename, an archive, an unarchive, or a look is drawn over its
 * channel's row at once, and a channel made is drawn under the id the host
 * minted for it; each stands while the service writes it: kept once the
 * followed list carries its transaction, and taken back where the service
 * refused it. Where the list hands no wait yet, the row as the write's own
 * answer leaves it is taken in the read's place, so a write never answers
 * before the list drawn shows it.
 */

import {
  type ChannelListRow,
  channelRowsOfLive,
  channelsOfRows,
  type WorkspaceChannels,
  type WorkspaceChannelsLiveRows,
} from "@luke/features/channel-live";
import type { Channel } from "@luke/features/channel-wire";
import { Data, Effect, type Scope } from "effect";
import {
  answeredCollection,
  optimistically,
  type RowRefused,
  type RowWrite,
  type RowWritten,
  rowsOf,
  rowWrites,
} from "./live-collection.js";
import { confirmWrite, type TxWait } from "./live-follow.js";

/** A channel made that the service refused, which takes back what it drew. */
class Unmade extends Data.TaggedError("Unmade") {}

/** What an open channel as a write answered it says of its row; its archive is the read's to say. */
export function writtenFields(channel: Channel): Partial<ChannelListRow> {
  return {
    name: channel.name,
    purpose: channel.purpose,
    project: channel.project,
    createdBy: channel.createdBy ?? null,
    createdAt: channel.createdAt,
    archivedAt: null,
    waiting: channel.waiting,
    lookedAt: channel.lookedAt ?? null,
    latestPostedAt: channel.latestPostedAt ?? null,
    threads: channel.threads ?? 0,
  };
}

export interface ChannelListDependencies {
  /** Draws the list as it now stands. */
  readonly draw: (channels: WorkspaceChannels) => Effect.Effect<void>;
  /** The followed list's wait for a write's transaction; none while the follow hands none. */
  readonly txWait: () => TxWait | undefined;
}

/** A workspace's channels in a collection, for as long as its scope stands. */
export interface ChannelListCollections {
  /** Takes one answer of the list's follow and draws it. */
  readonly answer: (rows: WorkspaceChannelsLiveRows) => Effect.Effect<void>;
  /** Whether the list holds a channel, open or archived, which a write on it is drawn over. */
  readonly holds: (channelId: string) => boolean;
  /** A change to a channel's row: drawn at once, kept or taken back as the service answers it. */
  readonly write: RowWrite<ChannelListRow>;
  /**
   * A channel made, under the id the host minted for it: drawn at once,
   * kept once the list carries its transaction, or as the service answered
   * it where the list hands no wait, and taken back where it refused it.
   */
  readonly made: <Answer>(
    row: ChannelListRow,
    written: Effect.Effect<RowWritten<ChannelListRow, Answer> | RowRefused<Answer>>,
  ) => Effect.Effect<Answer>;
  /** Waits for a write that drew nothing here, as a thread moved between channels, to reach the list. */
  readonly confirm: (txid: string | undefined) => Effect.Effect<void>;
}

/** A workspace's channels, drawn from the follow's first answer on. */
export function channelListCollections(
  dependencies: ChannelListDependencies,
): Effect.Effect<ChannelListCollections, never, Scope.Scope> {
  return Effect.gen(function* () {
    const channels = yield* answeredCollection({ getKey: (row: ChannelListRow) => row.id });
    // Note that nothing is drawn before the follow first answers, nor once the scope closed, since a follow let go draws for no window.
    let answered = false;
    let open = true;
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        open = false;
      }),
    );
    const drawn = Effect.suspend(() =>
      answered && open
        ? dependencies.draw(channelsOfRows(rowsOf(channels.collection)))
        : Effect.void,
    );
    /** Confirms a write on the followed list where it hands a wait, or takes its own answer in the list's place where it does not. */
    const confirmed = (txid: string | undefined, answeredInstead: () => void) => {
      const wait = dependencies.txWait();
      return wait === undefined || txid === undefined
        ? Effect.sync(answeredInstead)
        : confirmWrite(wait, txid);
    };
    return {
      answer: (rows) =>
        Effect.suspend(() => {
          channels.answer(channelRowsOfLive(rows));
          answered = true;
          return drawn;
        }),
      holds: (channelId) => channels.collection.has(channelId),
      write: rowWrites(channels, { drawn, txWait: dependencies.txWait }),
      made: <Answer>(
        row: ChannelListRow,
        written: Effect.Effect<RowWritten<ChannelListRow, Answer> | RowRefused<Answer>>,
      ) =>
        Effect.gen(function* () {
          const said: { value?: Answer } = {};
          const draw = () => {
            if (answered && !channels.collection.has(row.id)) channels.collection.insert(row);
          };
          const work = Effect.gen(function* () {
            yield* drawn;
            const result = yield* written;
            if ("refused" in result) {
              said.value = result.refused;
              return yield* new Unmade();
            }
            said.value = result.answer;
            const { fields } = result;
            yield* confirmed(result.txid, () => {
              if (answered) {
                channels.confirmNew(
                  typeof fields === "object" ? { ...row, ...fields, id: row.id } : row,
                );
              }
            });
          });
          yield* optimistically(draw, work).pipe(
            Effect.catchTag("Unmade", () => Effect.void),
            Effect.ensuring(drawn),
          );
          // SAFETY: the work sets the answer before it settles, whether the service made the channel or refused it.
          return said.value as Answer;
        }),
      confirm: (txid) => confirmWrite(dependencies.txWait(), txid),
    };
  });
}
