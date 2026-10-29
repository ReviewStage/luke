import {
  CHANNEL_CALL_FAILURE,
  type ChannelCallFailure,
  type ChannelsView,
} from "@luke/features/channel-view";
import type { ArchivedChannel, Channel } from "@luke/features/channel-wire";
import { ACT_UNREACHED_WORDS } from "@luke/features/words";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { STATUS_TONE } from "@luke/ui";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { askAct, useAct } from "../act.js";
import { streamFrom } from "../act-stream.js";
import { TOAST_HOLD, type ToastNotice, useToast } from "../toast.js";
import { useExperiment } from "../use-app-state.js";
import { CHANNEL_SHOWN, channelShown, generalChannel } from "./channels-model.js";

/**
 * use-channels.ts -- a workspace's channels as the window holds them, the channel the Inbox is narrowed to, and its archived channels, each read through the act port (STAG-547).
 *
 * The channels are held once per workspace for the whole window, so the
 * sidebar that lists them under the Inbox and the Inbox that heads one with
 * its name and purpose draw the same read, and a write made in either, a
 * channel made, edited, archived, or unarchived, or the reader's look,
 * stands in both the moment the service answers it with the workspace's
 * channels as they then stand. They are read as the first surface holding
 * them is drawn, again as the window comes back into view, and followed
 * while any surface draws them in view (`channels.follow`): each time the
 * host tells that channels moved, the channels are read again, and so are
 * the archived ones. Which channel the Inbox is narrowed to, if any, is the
 * window's own while it runs; with none chosen, as at launch, the Inbox
 * lists every channel's items, the reader's to-do list across all of them,
 * and one channel's only once one is chosen. A channel made answers its id,
 * so whoever made it opens it; archiving the channel the window shows moves
 * the window to #general and says so, where an archive by someone else
 * leaves the Inbox to say the channel is gone.
 */

/** A workspace's channels as last read: none until a read answers, and whether the last read failed. */
interface HeldChannels {
  readonly channels: readonly Channel[] | undefined;
  readonly failed: boolean;
}

const NOTHING_HELD: HeldChannels = { channels: undefined, failed: false };

/** Each workspace's channels as last read, by its id. */
const held = new Map<string, HeldChannels>();

/** Each workspace's channels read, by its id, a new map whenever a read is held, which a reader of every workspace's channels draws again by. */
let heldChannels: ReadonlyMap<string, readonly Channel[]> = new Map();

/** Each workspace's archived channels as last read, by its id, a new map whenever a read is held, so the window's links and history name an archived channel the Inbox is narrowed to. */
let heldArchived: ReadonlyMap<string, readonly ArchivedChannel[]> = new Map();

/** The window's surfaces drawing any workspace's channels, told of each change. */
const listeners = new Set<() => void>();

/** Each workspace whose channels the window follows, by its id: how many surfaces hold the follow, and its stop. */
const follows = new Map<string, { readonly holders: number; readonly stop: () => void }>();

/** The surfaces reading the archived channels, told which channels moved. */
const moveListeners = new Set<(moved: readonly string[]) => void>();

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

/** Every workspace's archived channels read, as they stand, which a server's render reads as the window's does. */
function heldArchivedNow(): ReadonlyMap<string, readonly ArchivedChannel[]> {
  return heldArchived;
}

/** Every workspace's channels read, as they stand, which a server's render reads as the window's does. */
function heldNow(): ReadonlyMap<string, readonly Channel[]> {
  return heldChannels;
}

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
  heldChannels = new Map(
    [...held].flatMap(([id, each]) => (each.channels === undefined ? [] : [[id, each.channels]])),
  );
  told();
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

/** Reads a workspace's channels again and holds the answer. */
function readChannels(workspaceId: string): void {
  askAct(ACT_KIND.CHANNELS_LIST, { workspaceId }).then(
    (view) => hold(workspaceId, view),
    () => hold(workspaceId, undefined),
  );
}

/**
 * Follows a workspace's channels for one more surface, opening the follow
 * for the first; the stop lets it go, closing it with the last. Each move
 * the host tells reads the channels again and tells every listener which
 * channels moved; a follow the host ended says nothing, and the channels
 * read as they stand when a surface next shows them.
 */
function holdFollow(workspaceId: string): () => void {
  const standing = follows.get(workspaceId);
  if (standing === undefined) {
    const stop = streamFrom(
      () => askAct(ACT_KIND.CHANNELS_FOLLOW, { workspaceId }),
      (heard) => {
        if ("failure" in heard) return;
        readChannels(workspaceId);
        for (const listener of moveListeners) listener(heard.moved);
      },
    );
    follows.set(workspaceId, { holders: 1, stop });
  } else {
    follows.set(workspaceId, { ...standing, holders: standing.holders + 1 });
  }
  return () => {
    const now = follows.get(workspaceId);
    if (now === undefined) return;
    if (now.holders > 1) {
      follows.set(workspaceId, { ...now, holders: now.holders - 1 });
      return;
    }
    follows.delete(workspaceId);
    now.stop();
  };
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

/**
 * Moves the window to #general where it showed the channel just archived,
 * before the channels that leave it out are held, so the Inbox never says
 * the channel it was just showing is gone; and says where it went.
 */
function leaveArchived(
  channelId: string,
  was: readonly Channel[] | undefined,
  channels: readonly Channel[],
  toast: (notice: ToastNotice) => void,
): void {
  if (place.channelId !== channelId) return;
  const general = generalChannel(channels);
  const name = was?.find((channel) => channel.id === channelId)?.name;
  moveTo({ channelId: general?.id, following: undefined });
  toast({
    words: `${name === undefined ? "The channel" : `#${name}`} is archived. You're in #general now.`,
    tone: STATUS_TONE.COMPLETE,
    hold: TOAST_HOLD.DONE,
  });
}

/** A workspace's channels and the writes on them, as `useChannels` hands them. */
/** Why a thread did not move: the words the window says, and the answer or error that refused it, which a shown failure reports. */
export interface MoveRefused {
  readonly words: string;
  readonly cause: unknown;
}

export interface ChannelsControl {
  /** The channels, none until first read. */
  readonly channels: readonly Channel[] | undefined;
  /** Whether the last read failed. */
  readonly failed: boolean;
  /** Reads the channels again. */
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
 * A workspace's channels as the window holds them, read as the first
 * surface holding them is drawn and as `shown` comes back, and followed
 * while it is.
 */
export function useChannels(workspaceId: string | undefined, shown: boolean): ChannelsControl {
  const { act } = useAct();
  const toast = useToast();
  const heldHere = () =>
    workspaceId === undefined ? NOTHING_HELD : (held.get(workspaceId) ?? NOTHING_HELD);
  const standing = useSyncExternalStore(subscribe, heldHere, heldHere);
  const onRefresh = useCallback(() => {
    if (workspaceId !== undefined) readChannels(workspaceId);
  }, [workspaceId]);
  useEffect(() => {
    if (shown) onRefresh();
  }, [shown, onRefresh]);
  useEffect(
    () => (workspaceId === undefined || !shown ? undefined : holdFollow(workspaceId)),
    [workspaceId, shown],
  );
  return useMemo(() => {
    /** A write whose answer, the channels as they then stand, is held, `before` run on them first; what refused it, or none. */
    const written = (
      asked: Promise<ChannelsView>,
      before: (channels: readonly Channel[]) => void = () => undefined,
    ): Promise<string | undefined> =>
      asked.then(
        (view) => {
          if ("failure" in view) return REFUSAL_WORDS[view.failure];
          before(view.channels);
          if (workspaceId !== undefined) hold(workspaceId, view);
          return undefined;
        },
        () => ACT_UNREACHED_WORDS,
      );
    return {
      channels: standing.channels,
      failed: standing.failed,
      onRefresh,
      onCreate: (name, purpose, project) => {
        if (workspaceId === undefined) return Promise.resolve({ refused: ACT_UNREACHED_WORDS });
        let made: string | undefined;
        // Note that a channel's name is its workspace's alone, so the made one is found by it among the channels answered.
        return written(
          act(ACT_KIND.CHANNELS_CREATE, { workspaceId, name, purpose, project }),
          (channels) => {
            made = channels.find((channel) => channel.name === name)?.id;
          },
        ).then((refused) =>
          refused !== undefined || made === undefined
            ? { refused: refused ?? ACT_UNREACHED_WORDS }
            : { channelId: made },
        );
      },
      onEdit: (channelId, edit) =>
        workspaceId === undefined
          ? Promise.resolve(ACT_UNREACHED_WORDS)
          : written(act(ACT_KIND.CHANNELS_EDIT, { workspaceId, channelId, ...edit })),
      onArchive: (channelId) =>
        workspaceId === undefined
          ? Promise.resolve(ACT_UNREACHED_WORDS)
          : written(act(ACT_KIND.CHANNELS_ARCHIVE, { workspaceId, channelId }), (channels) =>
              leaveArchived(channelId, standing.channels, channels, toast),
            ),
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
      onLook: (channelId) => {
        if (workspaceId === undefined) return;
        // Note that a look that does not land leaves the New line where it stood, which says nothing wrong.
        written(act(ACT_KIND.CHANNELS_LOOK, { workspaceId, channelId })).catch(() => undefined);
      },
    };
  }, [act, toast, workspaceId, standing, onRefresh]);
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

/** Every workspace's channels the window holds, by the workspace's id, which it reads nothing to learn. */
export function useHeldChannels(): ReadonlyMap<string, readonly Channel[]> {
  return useSyncExternalStore(subscribe, heldNow, heldNow);
}

/**
 * A channel of a workspace as the window holds it, open or archived, which
 * it reads nothing to learn: from the lists the sidebar and the archived
 * channels' surfaces hold; none where neither names it, as for a channel
 * of another workspace.
 */
export function useHeldChannel(
  workspaceId: string | undefined,
  channelId: string,
): Channel | ArchivedChannel | undefined {
  const open = useSyncExternalStore(subscribe, heldNow, heldNow);
  const archived = useSyncExternalStore(subscribe, heldArchivedNow, heldArchivedNow);
  if (workspaceId === undefined) return undefined;
  return (
    open.get(workspaceId)?.find((each) => each.id === channelId) ??
    archived.get(workspaceId)?.find((each) => each.id === channelId)
  );
}

/** The channel the Inbox is narrowed to with Channels on, open or archived. */
export interface ShownChannel {
  readonly channel: Pick<Channel, "id" | "name">;
}

/**
 * The channel a workspace's Inbox is narrowed to, as the window holds its
 * channels and its archived ones, which it reads nothing to learn: an
 * archived channel is named once the Inbox that shows it has read the
 * archived channels. None with Channels off, before the channels are
 * read, or where the workspace holds none.
 */
export function useShownChannel(workspaceId: string | undefined): ShownChannel | undefined {
  const channelsOn = useExperiment(EXPERIMENT.CHANNELS);
  const { channels } = useChannels(channelsOn ? workspaceId : undefined, false);
  const archived = useSyncExternalStore(subscribe, heldArchivedNow, heldArchivedNow);
  const { channelId } = useChannelPlace();
  const shown = channelShown(
    channels,
    channelId,
    workspaceId === undefined ? undefined : archived.get(workspaceId),
  );
  const channel =
    shown.kind === CHANNEL_SHOWN.CHANNEL || shown.kind === CHANNEL_SHOWN.ARCHIVED
      ? shown.channel
      : undefined;
  return useMemo(() => (channel === undefined ? undefined : { channel }), [channel]);
}

/** A workspace's archived channels as last read, the latest archived first, and the door that reads them again. */
export interface ArchivedChannelsControl {
  /** The archived channels as last read, none until first read; a read that fails keeps them. */
  readonly channels: readonly ArchivedChannel[] | undefined;
  /** Why the last read failed, none where it answered. */
  readonly failure: ChannelCallFailure | undefined;
  readonly onRefresh: () => void;
}

/**
 * A workspace's archived channels, read as the surface opens, again on
 * `onRefresh`, and whenever the follow says any channel moved, since an
 * archive or an unarchive moves one. Note that they are held for the
 * window, a failed read keeping what was held, as the open channels are,
 * so an Inbox narrowed to an archived channel and the window's links and
 * history naming it (`useShownChannel`) read the same list.
 */
export function useArchivedChannels(workspaceId: string | undefined): ArchivedChannelsControl {
  const { act } = useAct();
  const archived = useSyncExternalStore(subscribe, heldArchivedNow, heldArchivedNow);
  const [failed, setFailed] = useState<{
    readonly workspaceId: string;
    readonly failure: ChannelCallFailure | undefined;
  }>();
  const onRefresh = useCallback(() => {
    if (workspaceId === undefined) return;
    act(ACT_KIND.CHANNELS_ARCHIVED, { workspaceId }).then(
      (view) => {
        if ("failure" in view) return setFailed({ workspaceId, failure: view.failure });
        setFailed({ workspaceId, failure: undefined });
        heldArchived = new Map(heldArchived).set(workspaceId, view.channels);
        told();
      },
      () => setFailed({ workspaceId, failure: CHANNEL_CALL_FAILURE.UNANSWERED }),
    );
  }, [act, workspaceId]);
  useEffect(() => onRefresh(), [onRefresh]);
  useEffect(() => {
    moveListeners.add(onRefresh);
    return () => {
      moveListeners.delete(onRefresh);
    };
  }, [onRefresh]);
  return {
    channels: workspaceId === undefined ? undefined : archived.get(workspaceId),
    failure: failed?.workspaceId === workspaceId ? failed?.failure : undefined,
    onRefresh,
  };
}
