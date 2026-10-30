import {
  CHANNEL_CALL_FAILURE,
  type ChannelCallFailure,
  type ChannelsView,
} from "@luke/features/channel-view";
import type { ArchivedChannel, Channel } from "@luke/features/channel-wire";
import { LIVE_READ } from "@luke/features/live-wire";
import { ACT_UNREACHED_WORDS } from "@luke/features/words";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { STATUS_TONE } from "@luke/ui";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { tellAct, useAct } from "../act.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { APP_SLICE, useAppSlice, useExperiment } from "../use-app-state.js";
import { HOST_READ_STATUS, useHostRead } from "../use-host-read.js";
import { CHANNEL_SHOWN, channelShown, generalChannel } from "./channels-model.js";

/**
 * use-channels.ts -- a workspace's channels as the host holds them, the channel the Inbox is narrowed to, and the writes on them (STAG-547).
 *
 * A workspace's channels, open and archived, reach every surface on app
 * state, held by the host while any surface reads them and a while after
 * (`useHostRead(LIVE_READ.CHANNELS)`), so the sidebar that lists them under
 * the Inbox, the Inbox that heads one with its name and purpose, the
 * palette, and a `#channel` chip draw the same read, a surface drawn again
 * draws them in its first frame, and nothing here reads them itself. A
 * write made in any of them, a channel made, edited, archived, or
 * unarchived, the reader's look, or a thread moved, is drawn by the host
 * the moment it is asked and stands in all of them at once. Which channel
 * the Inbox is narrowed to, if any, is the window's own while it runs; with
 * none chosen, as at launch, the Inbox lists every channel's items, the
 * reader's to-do list across all of them, and one channel's only once one
 * is chosen. A channel made answers its id, so whoever made it opens it;
 * archiving the channel the window shows moves the window to #general and
 * says so, where an archive by someone else leaves the Inbox to say the
 * channel is gone.
 */

/** The window's surfaces drawing the place, told of each change. */
const listeners = new Set<() => void>();

/**
 * The channel the Inbox is narrowed to, none where it lists every channel;
 * and the item opened into it whose channel the place follows once its
 * item is read (`useThreadChannel`), as a link names its item and not its
 * channel.
 */
interface ChannelPlace {
  readonly channelId: string | undefined;
  readonly following: string | undefined;
}

let place: ChannelPlace = { channelId: undefined, following: undefined };

/** The workspace the window lists, whose channels the place names; none until the window lists one. */
let placeWorkspace: string | undefined;

/** What a refused write says, by why it was refused. */
const REFUSAL_WORDS = {
  [CHANNEL_CALL_FAILURE.UNANSWERED]: ACT_UNREACHED_WORDS,
  [CHANNEL_CALL_FAILURE.NOT_FOUND]: "That channel is gone. Someone may have archived it.",
  [CHANNEL_CALL_FAILURE.NAME_TAKEN]: "Another channel already goes by that name.",
  [CHANNEL_CALL_FAILURE.NOT_PERMITTED]: "#general keeps its name and is never archived.",
  [CHANNEL_CALL_FAILURE.INVALID]:
    "A name is lowercase words joined by dashes, and a purpose is one short line.",
} as const satisfies Record<ChannelCallFailure, string>;

/** What a channel's making answered: what refused it, or the channel made. */
export type ChannelMade = { readonly refused: string } | { readonly channelId: string };

/** The place as it stands, which a server's render reads as the window's does. */
function placeNow(): ChannelPlace {
  return place;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function told(): void {
  for (const listener of listeners) listener();
}

/** What a write answered, as a surface says it: what refused it, or none where it was written. */
function written(asked: Promise<ChannelsView>): Promise<string | undefined> {
  return asked.then(
    (view) => ("failure" in view ? REFUSAL_WORDS[view.failure] : undefined),
    () => ACT_UNREACHED_WORDS,
  );
}

/**
 * Tells the place the workspace the window lists. Another workspace
 * listed in place of the one the place stood in shows none of the last
 * one's channels, the Inbox standing in; the first workspace listed keeps
 * the place as a link chose it.
 */
export function listChannelWorkspace(workspaceId: string): void {
  if (placeWorkspace === workspaceId) return;
  const was = placeWorkspace;
  placeWorkspace = workspaceId;
  if (was !== undefined) moveTo({ channelId: undefined, following: undefined });
}

/** Moves the window's place, telling every surface drawing it. */
function moveTo(next: ChannelPlace): void {
  if (next.channelId === place.channelId && next.following === place.following) return;
  place = next;
  told();
}

/** Narrows the Inbox to a channel; a door any surface or link opens a channel by. */
export function chooseChannel(channelId: string): void {
  moveTo({ channelId, following: undefined });
}

/**
 * Opens an item while the Inbox is narrowed to a channel: into its own
 * channel where that is known, and once its item is read otherwise
 * (`useThreadChannel`), so the list it opens in holds it; the one door
 * every surface opening an item goes through (`onOpenItem`). Note that an
 * Inbox narrowed to none stays so, every channel's items being its own.
 */
export function openChannelThread(itemId: string, channelId?: string): void {
  if (place.channelId === undefined) return;
  moveTo(
    channelId === undefined
      ? { channelId: place.channelId, following: itemId }
      : { channelId, following: undefined },
  );
}

/** Leaves any channel shown, so the Inbox lists every channel; the door its row and its command open it by. */
export function leaveChannel(): void {
  moveTo({ channelId: undefined, following: undefined });
}

/** Stands the channel as a step of the window's history held it, none for the Inbox narrowed to none. */
export function standChannelPlace(channelId: string | undefined): void {
  moveTo({ channelId, following: undefined });
}

/** A workspace's channels and the writes on them, as `useChannels` hands them. */
/** Why a thread did not move: the words the window says, and the answer or error that refused it, which a shown failure reports. */
export interface MoveRefused {
  readonly words: string;
  readonly cause: unknown;
}

export interface ChannelsControl {
  /** The open channels by name, none until first read. */
  readonly channels: readonly Channel[] | undefined;
  /** Whether the read failed before it ever answered. */
  readonly failed: boolean;
  /** Reads the channels again, as Try again asks. */
  readonly onRefresh: () => void;
  /** Makes a channel; what refused it, or the channel made, which the caller opens. */
  readonly onCreate: (name: string, purpose: string, project: boolean) => Promise<ChannelMade>;
  /** Gives a channel a new name, a new purpose, or both; what refused it, or none where it was edited. */
  readonly onEdit: (
    channelId: string,
    edit: { readonly name?: string; readonly purpose?: string },
  ) => Promise<string | undefined>;
  /** Archives a channel, the window going to #general where it showed it; what refused it, or none where it was archived. */
  readonly onArchive: (channelId: string) => Promise<string | undefined>;
  /** Opens an archived channel again; what refused it, or none where it was opened. */
  readonly onUnarchive: (channelId: string) => Promise<string | undefined>;
  /** Moves a thread into another open channel of the workspace; what refused it, in words and as the answer or error that said so, or none where it moved. */
  readonly onMove: (threadId: string, channelId: string) => Promise<MoveRefused | undefined>;
  /** Stamps the reader's look at a channel, now. */
  readonly onLook: (channelId: string) => void;
}

/**
 * A workspace's channels as the host holds them, held for as long as the
 * surface reading them stands, and the writes on them.
 */
export function useChannels(workspaceId: string | undefined): ChannelsControl {
  const { act } = useAct();
  const toast = useToast();
  const read = useHostRead(LIVE_READ.CHANNELS, workspaceId);
  const channels = read.rows?.open;
  const failed = read.status === HOST_READ_STATUS.FAILED;
  const { retry } = read;
  return useMemo(
    () => ({
      channels,
      failed,
      onRefresh: retry,
      onCreate: (name, purpose, project) => {
        if (workspaceId === undefined) return Promise.resolve({ refused: ACT_UNREACHED_WORDS });
        // Note that a channel's name is its workspace's alone, so the made one is found by it among the channels answered.
        return act(ACT_KIND.CHANNELS_CREATE, { workspaceId, name, purpose, project }).then(
          (view): ChannelMade => {
            if ("failure" in view) return { refused: REFUSAL_WORDS[view.failure] };
            const made = view.channels.find((channel) => channel.name === name)?.id;
            return made === undefined ? { refused: ACT_UNREACHED_WORDS } : { channelId: made };
          },
          () => ({ refused: ACT_UNREACHED_WORDS }),
        );
      },
      onEdit: (channelId, edit) =>
        workspaceId === undefined
          ? Promise.resolve(ACT_UNREACHED_WORDS)
          : written(act(ACT_KIND.CHANNELS_EDIT, { workspaceId, channelId, ...edit })),
      onArchive: (channelId) => {
        if (workspaceId === undefined) return Promise.resolve(ACT_UNREACHED_WORDS);
        const shown = place.channelId === channelId;
        const general = generalChannel(channels ?? [])?.id;
        const name = channels?.find((channel) => channel.id === channelId)?.name;
        // Note that the window leaves the channel before the host draws it archived, so the Inbox never says the channel it was just showing is gone.
        if (shown) moveTo({ channelId: general, following: undefined });
        return written(act(ACT_KIND.CHANNELS_ARCHIVE, { workspaceId, channelId })).then(
          (refused) => {
            if (!shown) return refused;
            if (refused !== undefined) {
              if (place.channelId === general) moveTo({ channelId, following: undefined });
              return refused;
            }
            toast({
              words: `${name === undefined ? "The channel" : `#${name}`} is archived. You're in #general now.`,
              tone: STATUS_TONE.COMPLETE,
              hold: TOAST_HOLD.DONE,
            });
            return undefined;
          },
        );
      },
      onUnarchive: (channelId) =>
        workspaceId === undefined
          ? Promise.resolve(ACT_UNREACHED_WORDS)
          : written(act(ACT_KIND.CHANNELS_UNARCHIVE, { workspaceId, channelId })),
      onMove: (threadId, channelId) =>
        act(ACT_KIND.CHANNELS_MOVE, { threadId, channelId }).then(
          (view) =>
            "failure" in view ? { words: REFUSAL_WORDS[view.failure], cause: view } : undefined,
          (cause: unknown) => ({ words: ACT_UNREACHED_WORDS, cause }),
        ),
      // Note that a look that does not land leaves the New line where it stood, which says nothing wrong.
      onLook: (channelId) => {
        if (workspaceId !== undefined) tellAct(ACT_KIND.CHANNELS_LOOK, { workspaceId, channelId });
      },
    }),
    [act, toast, workspaceId, channels, failed, retry],
  );
}

/** The channel the Inbox is narrowed to, and the door that narrows it to another. */
export interface ChannelPlaceControl {
  readonly channelId: string | undefined;
  readonly onChoose: (channelId: string) => void;
}

/** The channel the Inbox is narrowed to, the window's own while it runs. */
export function useChannelPlace(): ChannelPlaceControl {
  const standing = useSyncExternalStore(subscribe, placeNow, placeNow);
  const { channelId } = standing;
  return useMemo(() => ({ channelId, onChoose: chooseChannel }), [channelId]);
}

/** Whether the Inbox is narrowed to a channel: Channels on, and a channel chosen. */
export function useInboxNarrowed(): boolean {
  const channelsOn = useExperiment(EXPERIMENT.CHANNELS);
  const { channelId } = useSyncExternalStore(subscribe, placeNow, placeNow);
  return channelsOn && channelId !== undefined;
}

/**
 * Narrows the Inbox to the channel an item opened into it lives in once
 * the item is read, as for one opened by a link, which names its item and
 * not its channel; nothing for any other item, or one read from a service
 * that names no channel.
 */
export function useThreadChannel(
  item: { readonly id: string; readonly channelId?: string } | undefined,
): void {
  const standing = useSyncExternalStore(subscribe, placeNow, placeNow);
  const id = item?.id;
  const channelId = item?.channelId;
  const misplaced =
    id !== undefined &&
    channelId !== undefined &&
    standing.following === id &&
    standing.channelId !== channelId;
  useEffect(() => {
    if (misplaced) moveTo({ channelId, following: undefined });
  }, [misplaced, channelId]);
}

/** Every workspace's open channels the host holds, by the workspace's id, which it reads nothing to learn. */
export function useHeldChannels(): ReadonlyMap<string, readonly Channel[]> {
  const held = useAppSlice(APP_SLICE.CHANNELS);
  return useMemo(
    () =>
      new Map(
        Object.entries(held ?? {}).flatMap(([workspaceId, read]) =>
          read.rows === undefined ? [] : [[workspaceId, read.rows.open] as const],
        ),
      ),
    [held],
  );
}

/**
 * A channel of a workspace as the host holds it, open or archived, which
 * it reads nothing to learn; none where the host holds no read naming it,
 * as for a channel of a workspace no surface reads.
 */
export function useHeldChannel(
  workspaceId: string | undefined,
  channelId: string,
): Channel | ArchivedChannel | undefined {
  const held = useAppSlice(APP_SLICE.CHANNELS);
  const rows = workspaceId === undefined ? undefined : held?.[workspaceId]?.rows;
  return (
    rows?.open.find((each) => each.id === channelId) ??
    rows?.archived.find((each) => each.id === channelId)
  );
}

/** The channel the Inbox is narrowed to with Channels on, open or archived. */
export interface ShownChannel {
  readonly channel: Pick<Channel, "id" | "name">;
}

/**
 * The channel a workspace's Inbox is narrowed to, open or archived, as the
 * host holds the workspace's channels. None with Channels off, before the
 * channels are read, or where the workspace holds none.
 */
export function useShownChannel(workspaceId: string | undefined): ShownChannel | undefined {
  const channelsOn = useExperiment(EXPERIMENT.CHANNELS);
  const { rows } = useHostRead(LIVE_READ.CHANNELS, channelsOn ? workspaceId : undefined);
  const { channelId } = useChannelPlace();
  const shown = channelShown(rows?.open, channelId, rows?.archived);
  const channel =
    shown.kind === CHANNEL_SHOWN.CHANNEL || shown.kind === CHANNEL_SHOWN.ARCHIVED
      ? shown.channel
      : undefined;
  return useMemo(() => (channel === undefined ? undefined : { channel }), [channel]);
}

/** A workspace's archived channels, the latest archived first, and Try again. */
export interface ArchivedChannelsControl {
  /** The archived channels as the host holds them, none until first read. */
  readonly channels: readonly ArchivedChannel[] | undefined;
  /** Why the read failed before it ever answered, none where it did. */
  readonly failure: ChannelCallFailure | undefined;
  readonly onRefresh: () => void;
}

/**
 * A workspace's archived channels, from the same read as its open ones, so
 * an archive or an unarchive drawn by the host moves a channel between the
 * two at once, and the window's links and history naming an archived
 * channel (`useShownChannel`) read the same list.
 */
export function useArchivedChannels(workspaceId: string | undefined): ArchivedChannelsControl {
  const read = useHostRead(LIVE_READ.CHANNELS, workspaceId);
  return {
    channels: read.rows?.archived,
    failure: read.status === HOST_READ_STATUS.FAILED ? CHANNEL_CALL_FAILURE.UNANSWERED : undefined,
    onRefresh: read.retry,
  };
}
