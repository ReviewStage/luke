import {
  type WorkspaceChannels,
  type WorkspaceChannelsLiveAnswer,
  workspaceChannelsLiveRowsSchema,
} from "@luke/features/channel-live";
import { CHANNEL_CALL_FAILURE } from "@luke/features/channel-view";
import { LIVE_SIGNED_OUT } from "@luke/features/live-wire";
import { Effect, type Scope } from "effect";
import {
  type AppHostRead,
  type AppWorkspaceChannels,
  NO_WORKSPACE_CHANNELS,
  UNREAD,
} from "./app-state.js";
import { type ChannelListCollections, channelListCollections } from "./channel-collections.js";
import { type HeldReads, heldReads } from "./live-collection.js";
import { followTakingRows, LIVE_GONE, restarting, type TxWait } from "./live-follow.js";

/**
 * channel-follow.ts -- a workspace's channels, followed over the service's held poll while a window holds them, kept in a collection a channel write is drawn over, and told whole on the app state as they change.
 *
 * The host follows the workspace's channels list (`live-follow.ts`) the
 * first time a window holds it, keeps its rows in a collection
 * (`channel-collections.ts`), takes each answer's rows as its poll answers,
 * and tells the list as it stands after each answer and each write drawn
 * over it. The windows hold the workspaces they list and the ones a
 * `#channel` chip names (`live-collection.ts`'s `heldReads`), and the host
 * keeps the few let go latest followed, so a window coming back to one, as
 * a channel switch that draws its surfaces again does, reads nothing anew.
 * Every held workspace is told whole on the one slice the windows draw
 * (`LIVE_READ.CHANNELS`).
 *
 * A read the service did not answer is asked again after `LIVE_RESTART`,
 * keeping what it last told; one that never answered is told failed. A
 * workspace the account does not reach is told failed and its follow ends;
 * one refused because the session is no longer the account the follow
 * started for ends unsaid, and the next sign-in follows it again
 * (`open`).
 */

/** A workspace's channels list as the follow asks for it, its rows inline where it polls; a failure where the service answered none. */
type Sealed = WorkspaceChannelsLiveAnswer | { readonly failure: string };

export interface WorkspaceChannelsDependencies {
  /** The workspace's channels list for the account named, its rows inline where `poll` asks, held past `after`. */
  readonly live: (
    workspaceId: string,
    userId: string,
    poll: boolean,
    after?: string,
  ) => Effect.Effect<Sealed>;
  /** The account signed in now, which a follow is read for from its first read on; none where nobody is. */
  readonly accountId: () => string | undefined;
  /** Whether the account gate stands open, so a follow may read. */
  readonly gate: () => boolean;
  readonly tell: (held: AppWorkspaceChannels) => Effect.Effect<void>;
}

/** The workspaces the windows hold, and what the host does for them. */
export interface WorkspaceChannelsHeld {
  /** Holds a workspace's channels for the caller's scope, following them unless they stand. */
  readonly hold: HeldReads<string>["hold"];
  /** Reads a workspace's channels again at once, as Try again asks, telling nothing of them meanwhile where they had failed. */
  readonly retry: (workspaceId: string) => Effect.Effect<void>;
  /** Follows every held workspace anew, as the account gate opening asks. */
  readonly open: Effect.Effect<void>;
  /** Lets every follow go and tells no workspace held: the session ended. */
  readonly end: Effect.Effect<void>;
  /** The collections of a workspace whose follow stands, which a write on its channels is drawn over; none where nothing follows it. */
  readonly standing: (workspaceId: string) => ChannelListCollections | undefined;
  /** The collections of the followed workspace holding the channel, open or archived; none where none does. */
  readonly holding: (channelId: string) => ChannelListCollections | undefined;
}

/**
 * The held lifetime over every workspace's follow, told whole on one
 * slice: each workspace's list as its follow last told it, kept where a
 * later read does not answer, and failed where it never answered; one let
 * go for good is told no more. Behind a closed gate a held workspace is
 * followed only once the gate opens (`open`).
 */
export function workspaceChannels(
  dependencies: WorkspaceChannelsDependencies,
): Effect.Effect<WorkspaceChannelsHeld, never, Scope.Scope> {
  return Effect.gen(function* () {
    let held: AppWorkspaceChannels = NO_WORKSPACE_CHANNELS;
    /** Each followed workspace's collections, by its id, while its follow stands. */
    const lists = new Map<string, ChannelListCollections>();
    const set = (workspaceId: string, read: AppHostRead<WorkspaceChannels> | undefined) =>
      Effect.suspend(() => {
        const next = { ...held };
        if (read === undefined) Reflect.deleteProperty(next, workspaceId);
        else next[workspaceId] = read;
        held = next;
        return dependencies.tell(held);
      });
    // Note that a read that stops answering keeps its rows, since its next answer brings them up to date.
    const failedUnlessRead = (workspaceId: string) =>
      Effect.suspend(() =>
        held[workspaceId]?.rows === undefined ? set(workspaceId, { failed: true }) : Effect.void,
      );

    /** One run of a workspace's follow, answering whether it is followed again after `LIVE_RESTART`. */
    const attempt = (workspaceId: string): Effect.Effect<boolean> =>
      Effect.scoped(
        Effect.gen(function* () {
          // The account the follow starts for, which every poll names, so one under another's session is refused as signed out and ends.
          const userId = dependencies.accountId();
          if (userId === undefined) return false;
          const seal = (poll: boolean, after?: string) =>
            dependencies.live(workspaceId, userId, poll, after);
          const first = yield* seal(false);
          if ("failure" in first) {
            if (first.failure === LIVE_SIGNED_OUT.failure) return false;
            if (first.failure === CHANNEL_CALL_FAILURE.NOT_FOUND) {
              yield* set(workspaceId, { failed: true });
              return false;
            }
            yield* failedUnlessRead(workspaceId);
            return true;
          }
          let wait: TxWait | undefined;
          /** Why the follow ended for good, the first poll's terminal failure, kept whatever answers after it. */
          let endedBy: string | undefined;
          const list = yield* channelListCollections({
            draw: (channels) => set(workspaceId, { rows: channels }),
            txWait: () => wait,
          });
          lists.set(workspaceId, list);
          // Note that a follow lets go only of its own list, since one started over may stand first.
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (lists.get(workspaceId) === list) lists.delete(workspaceId);
            }),
          );
          const poll = (after: string | undefined) =>
            Effect.map(seal(true, after), (read) => {
              if (!("failure" in read)) return read;
              const gone = read.failure === CHANNEL_CALL_FAILURE.NOT_FOUND;
              if (endedBy === undefined && (gone || read.failure === LIVE_SIGNED_OUT.failure)) {
                endedBy = read.failure;
              }
              return { failure: read.failure, gone };
            });
          const gone = yield* followTakingRows(
            {
              poll,
              onTxWait: (handed) => {
                wait = handed;
              },
            },
            first,
            workspaceChannelsLiveRowsSchema,
            list.answer,
          ).pipe(
            Effect.as(false),
            Effect.catch((broken) => Effect.succeed(broken.reason === LIVE_GONE)),
          );
          if (!gone) return true;
          if (endedBy === CHANNEL_CALL_FAILURE.NOT_FOUND) yield* set(workspaceId, { failed: true });
          return false;
        }),
      );
    const follow = (workspaceId: string) =>
      Effect.suspend(() => (dependencies.gate() ? restarting(attempt(workspaceId)) : Effect.void));
    const reads = yield* heldReads<string>(
      follow,
      (workspaceId) => set(workspaceId, undefined),
      Effect.suspend(() => {
        held = NO_WORKSPACE_CHANNELS;
        return dependencies.tell(held);
      }),
    );
    return {
      hold: reads.hold,
      retry: (workspaceId) =>
        Effect.andThen(
          Effect.suspend(() =>
            held[workspaceId]?.failed === true ? set(workspaceId, UNREAD) : Effect.void,
          ),
          reads.reopen(workspaceId),
        ),
      open: reads.reopenHeld,
      end: reads.end,
      standing: (workspaceId) => lists.get(workspaceId),
      holding: (channelId) => [...lists.values()].find((list) => list.holds(channelId)),
    };
  });
}
