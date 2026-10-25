import { CHANNEL_CALL_FAILURE, type ChannelCallFailure, type ChannelsView } from "@luke/features/channel-view";
import type { Channel, ChannelThread } from "@luke/features/channel-wire";
import { ACT_UNREACHED_WORDS } from "@luke/features/words";
import { ACT_KIND } from "@luke/host/acts";
import { Schema } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAct } from "../act.js";
import { keptKey, useKept } from "../use-kept.js";
import { CHANNEL_VIEW, type ChannelView } from "./channels-model.js";

/**
 * use-channels.ts -- a workspace's channels as the window holds them, the channel chosen, and one channel's threads, each read through the act port (STAG-547).
 *
 * The channels are held once per workspace for the whole window, so the
 * sidebar that lists them and the stream that heads one with its name and
 * purpose draw the same read, and a write made in either, a channel made,
 * renamed, or archived, or the reader's look, stands in both the moment the
 * service answers it with the workspace's channels as they then stand. They
 * are read as the first surface holding them is drawn, again as the window
 * comes back into view, and again whenever a channel is opened or a thread
 * in it answered, since nothing follows them live yet. Which channel the
 * window shows, and whether a thread stands open beside it, is the
 * window's own while it runs; which view the stream shows, Mine by
 * default, is kept on this Mac as the Inbox's view choices are.
 */

/** A workspace's channels as last read: none until a read answers, and whether the last read failed. */
interface HeldChannels {
  readonly channels: readonly Channel[] | undefined;
  readonly failed: boolean;
}

const NOTHING_HELD: HeldChannels = { channels: undefined, failed: false };

/** Each workspace's channels as last read, by its id. */
const held = new Map<string, HeldChannels>();

/** The window's surfaces drawing any workspace's channels, told of each change. */
const listeners = new Set<() => void>();

/** The channel the window shows and whether its thread stands open beside it. */
interface ChannelPlace {
  readonly channelId: string | undefined;
  readonly threadOpen: boolean;
}

let place: ChannelPlace = { channelId: undefined, threadOpen: false };

/** What a refused write says, by why it was refused. */
const REFUSAL_WORDS = {
  [CHANNEL_CALL_FAILURE.UNANSWERED]: ACT_UNREACHED_WORDS,
  [CHANNEL_CALL_FAILURE.NOT_FOUND]: "That channel is gone. Someone may have archived it.",
  [CHANNEL_CALL_FAILURE.NAME_TAKEN]: "Another channel already goes by that name.",
  [CHANNEL_CALL_FAILURE.NOT_PERMITTED]: "#general is never renamed or archived.",
  [CHANNEL_CALL_FAILURE.INVALID]:
    "A name is lowercase words joined by dashes, and a purpose is one short line.",
} as const satisfies Record<ChannelCallFailure, string>;

/** Where the stream's view is kept on this Mac. */
const KEPT_VIEW = keptKey<ChannelView>(
  "luke.channelView",
  Schema.fromJsonString(Schema.Literals(Object.values(CHANNEL_VIEW))),
);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function told(): void {
  for (const listener of listeners) listener();
}

/** Holds a workspace's channels as an answer says, a failure keeping what was held. */
function hold(workspaceId: string, view: ChannelsView | undefined): void {
  const was = held.get(workspaceId) ?? NOTHING_HELD;
  held.set(
    workspaceId,
    view === undefined || "failure" in view
      ? { channels: was.channels, failed: true }
      : { channels: view.channels, failed: false },
  );
  told();
}

/** Moves the window's place, telling every surface drawing it. */
function moveTo(next: ChannelPlace): void {
  if (next.channelId === place.channelId && next.threadOpen === place.threadOpen) return;
  place = next;
  told();
}

/** A workspace's channels and the writes on them, as `useChannels` hands them. */
export interface ChannelsControl {
  /** The channels, none until first read. */
  readonly channels: readonly Channel[] | undefined;
  /** Whether the last read failed. */
  readonly failed: boolean;
  /** Reads the channels again. */
  readonly onRefresh: () => void;
  /** Makes a channel; what refused it, or none where it was made. */
  readonly onCreate: (name: string, purpose: string, project: boolean) => Promise<string | undefined>;
  /** Renames a channel; what refused it, or none where it was renamed. */
  readonly onRename: (channelId: string, name: string) => Promise<string | undefined>;
  /** Archives a channel; what refused it, or none where it was archived. */
  readonly onArchive: (channelId: string) => Promise<string | undefined>;
  /** Stamps the reader's look at a channel, now. */
  readonly onLook: (channelId: string) => void;
}

/** A workspace's channels as the window holds them, read as the first surface holding them is drawn and as `shown` comes back. */
export function useChannels(workspaceId: string | undefined, shown: boolean): ChannelsControl {
  const { act } = useAct();
  const standing = useSyncExternalStore(subscribe, () =>
    workspaceId === undefined ? NOTHING_HELD : (held.get(workspaceId) ?? NOTHING_HELD),
  );
  const onRefresh = useCallback(() => {
    if (workspaceId === undefined) return;
    act(ACT_KIND.CHANNELS_LIST, { workspaceId }).then(
      (view) => hold(workspaceId, view),
      () => hold(workspaceId, undefined),
    );
  }, [act, workspaceId]);
  useEffect(() => {
    if (shown) onRefresh();
  }, [shown, onRefresh]);
  return useMemo(() => {
    /** A write whose answer, the channels as they then stand, is held; what refused it, or none. */
    const written = (asked: Promise<ChannelsView>): Promise<string | undefined> =>
      asked.then(
        (view) => {
          if ("failure" in view) return REFUSAL_WORDS[view.failure];
          if (workspaceId !== undefined) hold(workspaceId, view);
          return undefined;
        },
        () => ACT_UNREACHED_WORDS,
      );
    return {
      channels: standing.channels,
      failed: standing.failed,
      onRefresh,
      onCreate: (name, purpose, project) =>
        workspaceId === undefined
          ? Promise.resolve(ACT_UNREACHED_WORDS)
          : written(act(ACT_KIND.CHANNELS_CREATE, { workspaceId, name, purpose, project })),
      onRename: (channelId, name) =>
        workspaceId === undefined
          ? Promise.resolve(ACT_UNREACHED_WORDS)
          : written(act(ACT_KIND.CHANNELS_RENAME, { workspaceId, channelId, name })),
      onArchive: (channelId) =>
        workspaceId === undefined
          ? Promise.resolve(ACT_UNREACHED_WORDS)
          : written(act(ACT_KIND.CHANNELS_ARCHIVE, { workspaceId, channelId })),
      onLook: (channelId) => {
        if (workspaceId === undefined) return;
        // Note that a look that does not land leaves the New line where it stood, which says nothing wrong.
        written(act(ACT_KIND.CHANNELS_LOOK, { workspaceId, channelId })).catch(() => undefined);
      },
    };
  }, [act, workspaceId, standing, onRefresh]);
}

/** The channel the window shows, whether its thread stands open, and the doors that move them. */
export interface ChannelPlaceControl extends ChannelPlace {
  readonly onChoose: (channelId: string) => void;
  readonly onOpenThread: () => void;
  readonly onCloseThread: () => void;
}

/** The channel the window shows and whether its thread stands open, the window's own while it runs. */
export function useChannelPlace(): ChannelPlaceControl {
  const standing = useSyncExternalStore(subscribe, () => place);
  return useMemo(
    () => ({
      ...standing,
      onChoose: (channelId) =>
        moveTo({
          channelId,
          threadOpen: channelId === place.channelId ? place.threadOpen : false,
        }),
      onOpenThread: () => moveTo({ ...place, threadOpen: true }),
      onCloseThread: () => moveTo({ ...place, threadOpen: false }),
    }),
    [standing],
  );
}

/** The stream's view, Mine until first chosen, kept on this Mac. */
export function useChannelView(): readonly [ChannelView, (view: ChannelView) => void] {
  const [view, onView] = useKept(KEPT_VIEW, CHANNEL_VIEW.MINE);
  return [view, onView];
}

/** One channel's threads as last read, oldest first, and the door that reads them again. */
export interface ChannelThreadsControl {
  /** The threads, none until first read. */
  readonly threads: readonly ChannelThread[] | undefined;
  /** Why the last read failed, none where it answered. */
  readonly failure: ChannelCallFailure | undefined;
  readonly onRefresh: () => void;
}

/** A channel's threads, read as it opens and again on `onRefresh`; a read for a channel left since is let go. */
export function useChannelThreads(channelId: string | undefined): ChannelThreadsControl {
  const { act } = useAct();
  const [read, setRead] = useState<{
    readonly channelId: string;
    readonly threads: readonly ChannelThread[] | undefined;
    readonly failure: ChannelCallFailure | undefined;
  }>();
  // Note that a read landing after another channel was opened is let go, so it never stands over the newer channel's.
  const asking = useRef(channelId);
  asking.current = channelId;
  const onRefresh = useCallback(() => {
    if (channelId === undefined) return;
    act(ACT_KIND.CHANNELS_THREADS, { channelId }).then(
      (view) =>
        setRead((was) => {
          if (asking.current !== channelId) return was;
          if ("failure" in view) {
            const kept = was?.channelId === channelId ? was.threads : undefined;
            return { channelId, threads: kept, failure: view.failure };
          }
          return { channelId, threads: view.threads, failure: undefined };
        }),
      () =>
        setRead((was) =>
          asking.current !== channelId
            ? was
            : {
                channelId,
                threads: was?.channelId === channelId ? was.threads : undefined,
                failure: CHANNEL_CALL_FAILURE.UNANSWERED,
              },
        ),
    );
  }, [act, channelId]);
  useEffect(() => onRefresh(), [onRefresh]);
  const current = read?.channelId === channelId ? read : undefined;
  return { threads: current?.threads, failure: current?.failure, onRefresh };
}
