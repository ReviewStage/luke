import {
  CHANNEL_CALL_FAILURE,
  type ChannelCallFailure,
  type ChannelsView,
} from "@luke/features/channel-view";
import type { ArchivedChannel, Channel, ChannelThread } from "@luke/features/channel-wire";
import { ACT_UNREACHED_WORDS } from "@luke/features/words";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { STATUS_TONE } from "@luke/ui";
import { Schema } from "effect";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { askAct, useAct } from "../act.js";
import { streamFrom } from "../act-stream.js";
import { TOAST_HOLD, type ToastNotice, useToast } from "../toast.js";
import { useExperiment } from "../use-app-state.js";
import { keptKey, useKept } from "../use-kept.js";
import {
  CHANNEL_SHOWN,
  CHANNEL_VIEW,
  type ChannelView,
  channelShown,
  generalChannel,
} from "./channels-model.js";

/**
 * use-channels.ts -- a workspace's channels as the window holds them, the channel chosen, one channel's threads page by page, and its archived channels, each read through the act port (STAG-547).
 *
 * The channels are held once per workspace for the whole window, so the
 * sidebar that lists them and the stream that heads one with its name and
 * purpose draw the same read, and a write made in either, a channel made,
 * edited, archived, or unarchived, or the reader's look, stands in both the
 * moment the service answers it with the workspace's channels as they then
 * stand. They are read as the first surface holding them is drawn, again as
 * the window comes back into view, and followed while any surface draws
 * them in view (`channels.follow`): each time the host tells that channels
 * moved, the channels are read again, and so is a channel's stream that
 * shows one of them, as far back as the older pages it loaded reached. Which channel the
 * window shows, and whether a thread stands open beside it, is the
 * window's own while it runs; the channel last shown in each workspace is
 * kept on this Mac, and shown again on launch once the workspace's channels
 * are read and it still stands among them, #general standing in otherwise.
 * Which view the stream shows, Mine by default, is kept on this Mac as the
 * Inbox's view choices are. A channel made answers its id, so whoever made
 * it opens it; archiving the channel the window shows moves the window to
 * #general and says so, where an archive by someone else leaves the stream
 * to say the channel is gone.
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

/** Each workspace's archived channels as last read, by its id, a new map whenever a read is held, so the window's links and history name an archived channel its stream shows. */
let heldArchived: ReadonlyMap<string, readonly ArchivedChannel[]> = new Map();

/** The window's surfaces drawing any workspace's channels, told of each change. */
const listeners = new Set<() => void>();

/** Each workspace whose channels the window follows, by its id: how many surfaces hold the follow, and its stop. */
const follows = new Map<string, { readonly holders: number; readonly stop: () => void }>();

/** The streams drawing a channel's threads, told which channels moved. */
const moveListeners = new Set<(moved: readonly string[]) => void>();

/**
 * The channel the window shows and the thread opened in it, by its item's
 * id. Note that the thread is named rather than flagged open, so it stands
 * only while the Inbox's choice is that item: the window's history, which
 * keeps the choice, takes the thread away with it on Back.
 */
interface ChannelPlace {
  readonly channelId: string | undefined;
  readonly threadId: string | undefined;
}

let place: ChannelPlace = { channelId: undefined, threadId: undefined };

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

/** Where the stream's view is kept on this Mac. */
const KEPT_VIEW = keptKey<ChannelView>(
  "luke.channelView",
  Schema.fromJsonString(Schema.Literals(Object.values(CHANNEL_VIEW))),
);

/** Where the channel last shown in each workspace is kept on this Mac, by the workspace's id. */
const KEPT_CHANNEL = keptKey<Readonly<Record<string, string>>>(
  "luke.shownChannel",
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);

/** No channel kept in any workspace. */
const NOTHING_KEPT: Readonly<Record<string, string>> = {};

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
 * one's channels, its own last shown standing in once its channels are
 * read (`useChannels`); the first workspace listed keeps the place as a
 * link chose it.
 */
export function listChannelWorkspace(workspaceId: string): void {
  if (placeWorkspace === workspaceId) return;
  const was = placeWorkspace;
  placeWorkspace = workspaceId;
  if (was !== undefined) moveTo({ channelId: undefined, threadId: undefined });
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
 * the host tells reads the channels again and tells every stream which
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
  if (next.channelId === place.channelId && next.threadId === place.threadId) return;
  place = next;
  told();
}

/** Shows a channel, the thread open in it kept only where it is the channel already shown; a door any surface or link opens a channel by. */
export function chooseChannel(channelId: string): void {
  moveTo({ channelId, threadId: channelId === place.channelId ? place.threadId : undefined });
}

/**
 * Opens a thread, in its channel where that is known and in the channel
 * shown otherwise, until its item is read (`useThreadChannel`); the one
 * door every surface opening a thread goes through (`onOpenItem`).
 */
export function openChannelThread(itemId: string, channelId?: string): void {
  moveTo({ channelId: channelId ?? place.channelId, threadId: itemId });
}

/** Stands the channel and the thread as a step of the window's history held them. */
export function standChannelPlace(
  channelId: string | undefined,
  threadId: string | undefined,
): void {
  moveTo({ channelId: channelId ?? place.channelId, threadId });
}

/**
 * Moves the window to #general where it showed the channel just archived,
 * before the channels that leave it out are held, so the stream never says
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
  moveTo({ channelId: general?.id, threadId: undefined });
  toast({
    words: `${name === undefined ? "The channel" : `#${name}`} is archived. You're in #general now.`,
    tone: STATUS_TONE.COMPLETE,
    hold: TOAST_HOLD.DONE,
  });
}

/** A workspace's channels and the writes on them, as `useChannels` hands them. */
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
  /** Moves a thread into another open channel of the workspace; what refused it, or none where it moved. */
  readonly onMove: (threadId: string, channelId: string) => Promise<string | undefined>;
  /** Stamps the reader's look at a channel, now. */
  readonly onLook: (channelId: string) => void;
}

/**
 * A workspace's channels as the window holds them, read as the first
 * surface holding them is drawn and as `shown` comes back, and followed
 * while it is. Note that where it is the workspace the window lists, the
 * channel it shows is kept as the workspace's last once it stands among
 * them, and with none chosen, as at launch or on another workspace
 * listed, the one kept is shown where it still stands among them, before
 * the window paints, so an archived or unknown one leaves #general standing in.
 */
export function useChannels(workspaceId: string | undefined, shown: boolean): ChannelsControl {
  const { act } = useAct();
  const toast = useToast();
  const heldHere = () =>
    workspaceId === undefined ? NOTHING_HELD : (held.get(workspaceId) ?? NOTHING_HELD);
  const standing = useSyncExternalStore(subscribe, heldHere, heldHere);
  const [kept, , changeKept] = useKept(KEPT_CHANNEL, NOTHING_KEPT);
  const { channelId: chosen } = useSyncExternalStore(subscribe, placeNow, placeNow);
  const listed = placeWorkspace === undefined || placeWorkspace === workspaceId;
  useLayoutEffect(() => {
    const { channels } = standing;
    if (workspaceId === undefined || !listed || channels === undefined) return;
    if (chosen === undefined) {
      const last = kept[workspaceId];
      if (channels.some((channel) => channel.id === last)) {
        moveTo({ channelId: last, threadId: undefined });
      }
      return;
    }
    if (!channels.some((channel) => channel.id === chosen)) return;
    changeKept((was) => (was[workspaceId] === chosen ? was : { ...was, [workspaceId]: chosen }));
  }, [workspaceId, listed, standing, chosen, kept, changeKept]);
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
          (view) => ("failure" in view ? REFUSAL_WORDS[view.failure] : undefined),
          () => ACT_UNREACHED_WORDS,
        ),
      onLook: (channelId) => {
        if (workspaceId === undefined) return;
        // Note that a look that does not land leaves the New line where it stood, which says nothing wrong.
        written(act(ACT_KIND.CHANNELS_LOOK, { workspaceId, channelId })).catch(() => undefined);
      },
    };
  }, [act, toast, workspaceId, standing, onRefresh]);
}

/** The channel the window shows, the thread opened in it, and the doors that move them. */
export interface ChannelPlaceControl extends ChannelPlace {
  readonly onChoose: (channelId: string) => void;
  readonly onOpenThread: (itemId: string) => void;
  readonly onCloseThread: () => void;
}

/** The channel the window shows and the thread opened in it, the window's own while it runs. */
export function useChannelPlace(): ChannelPlaceControl {
  const standing = useSyncExternalStore(subscribe, placeNow, placeNow);
  return useMemo(
    () => ({
      ...standing,
      onChoose: chooseChannel,
      onOpenThread: (itemId) => openChannelThread(itemId),
      onCloseThread: () => moveTo({ ...place, threadId: undefined }),
    }),
    [standing],
  );
}

/**
 * Moves the stream to the channel the open thread lives in once its item
 * is read, as for a thread opened by a link, which names its item and
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
    standing.threadId === id &&
    standing.channelId !== channelId;
  useEffect(() => {
    if (misplaced) moveTo({ channelId, threadId: id });
  }, [misplaced, channelId, id]);
}

/** Every workspace's channels the window holds, by the workspace's id, which it reads nothing to learn. */
export function useHeldChannels(): ReadonlyMap<string, readonly Channel[]> {
  return useSyncExternalStore(subscribe, heldNow, heldNow);
}

/** What the Inbox's place shows with Channels on: the channel its stream shows, open or archived, and the thread opened in it, by its item's id. */
export interface ShownChannel {
  readonly channel: Pick<Channel, "id" | "name">;
  readonly threadId: string | undefined;
}

/**
 * The channel a workspace's stream shows and the thread opened in it, as
 * the window holds its channels and its archived ones, which it reads
 * nothing to learn: an archived channel is named once the stream that
 * shows it has read the archived channels. None with Channels off, before
 * the channels are read, or where the workspace holds none.
 */
export function useShownChannel(workspaceId: string | undefined): ShownChannel | undefined {
  const channelsOn = useExperiment(EXPERIMENT.CHANNELS);
  const { channels } = useChannels(channelsOn ? workspaceId : undefined, false);
  const archived = useSyncExternalStore(subscribe, heldArchivedNow, heldArchivedNow);
  const { channelId, threadId } = useChannelPlace();
  const shown = channelShown(
    channels,
    channelId,
    workspaceId === undefined ? undefined : archived.get(workspaceId),
  );
  const channel =
    shown.kind === CHANNEL_SHOWN.CHANNEL || shown.kind === CHANNEL_SHOWN.ARCHIVED
      ? shown.channel
      : undefined;
  return useMemo(
    () => (channel === undefined ? undefined : { channel, threadId }),
    [channel, threadId],
  );
}

/** The stream's view, Mine until first chosen, kept on this Mac. */
export function useChannelView(): readonly [ChannelView, (view: ChannelView) => void] {
  const [view, onView] = useKept(KEPT_VIEW, CHANNEL_VIEW.MINE);
  return [view, onView];
}

/** One channel's threads as last read, oldest first, the doors that read them again and read an older page. */
export interface ChannelThreadsControl {
  /** The threads, none until first read. */
  readonly threads: readonly ChannelThread[] | undefined;
  /** Why the last read failed, none where it answered. */
  readonly failure: ChannelCallFailure | undefined;
  /** Whether an older page stands to be read. */
  readonly hasOlder: boolean;
  /** Reads the latest page again, and the older pages read as far back as they reached. */
  readonly onRefresh: () => void;
  /** Reads the next older page, where one stands. */
  readonly onOlder: () => void;
}

/** One channel's threads as read: the older pages, the latest page, and the thread to read the next older page before. */
interface ChannelThreadsRead {
  readonly channelId: string;
  /** The threads the older pages carried, oldest first. */
  readonly earlier: readonly ChannelThread[];
  /** The threads the latest page carried, none until it is first read. */
  readonly latest: readonly ChannelThread[] | undefined;
  readonly older: string | undefined;
  readonly failure: ChannelCallFailure | undefined;
}

/** Two threads in the order a channel posts them, its id breaking a tie, as the service pages them. */
function postedOrder(a: ChannelThread, b: ChannelThread): number {
  return a.postedAt - b.postedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The older pages and the latest as one stream, each thread once as the latest read it, oldest posted first. */
function threadsOf(read: ChannelThreadsRead): readonly ChannelThread[] | undefined {
  if (read.latest === undefined) return undefined;
  const latest = new Set(read.latest.map((thread) => thread.id));
  return [...read.earlier.filter((thread) => !latest.has(thread.id)), ...read.latest].toSorted(
    postedOrder,
  );
}

/**
 * A channel's threads, read as it opens, again on `onRefresh` and whenever
 * the follow says the channel moved, and an older page on `onOlder`; a read
 * for a channel left since is let go.
 */
export function useChannelThreads(channelId: string | undefined): ChannelThreadsControl {
  const { act } = useAct();
  const [read, setRead] = useState<ChannelThreadsRead>();
  // Note that a read landing after another channel was opened is let go, so it never stands over the newer channel's.
  const asking = useRef(channelId);
  asking.current = channelId;
  /** Folds an answer into the read of `channelId`, a failure keeping what was read. */
  const fold = useCallback(
    (asked: string, change: (was: ChannelThreadsRead) => ChannelThreadsRead) =>
      setRead((was) => {
        if (asking.current !== asked) return was;
        const standing =
          was?.channelId === asked
            ? was
            : {
                channelId: asked,
                earlier: [],
                latest: undefined,
                older: undefined,
                failure: undefined,
              };
        return change(standing);
      }),
    [],
  );
  // The oldest thread the stream's older pages hold, which a refresh reads back past.
  const held = useRef<ChannelThread | undefined>(undefined);
  held.current = read !== undefined && read.channelId === channelId ? read.earlier[0] : undefined;
  const onRefresh = useCallback(() => {
    if (channelId === undefined) return;
    const oldest = held.current;
    /** Whether the older pages read reach back to where the oldest held thread stood. */
    const reached = (earlier: readonly ChannelThread[]) => {
      const first = earlier[0];
      return oldest === undefined || (first !== undefined && postedOrder(first, oldest) <= 0);
    };
    const failed = (failure: ChannelCallFailure) => fold(channelId, (was) => ({ ...was, failure }));
    // Note that the older pages held are read again too, back past where the oldest stood rather than by count, so a thread moved out of one leaves the stream and one posted since drops none off its end.
    const reread = async () => {
      const latest = await act(ACT_KIND.CHANNELS_THREADS, { channelId });
      if ("failure" in latest) return failed(latest.failure);
      let earlier: readonly ChannelThread[] = [];
      let older = latest.older;
      while (older !== undefined && !reached(earlier)) {
        const page = await act(ACT_KIND.CHANNELS_THREADS, { channelId, before: older });
        if ("failure" in page) return failed(page.failure);
        earlier = [...page.threads, ...earlier];
        older = page.older;
      }
      fold(channelId, () => ({
        channelId,
        earlier,
        latest: latest.threads,
        older,
        failure: undefined,
      }));
    };
    reread().catch(() => failed(CHANNEL_CALL_FAILURE.UNANSWERED));
  }, [act, channelId, fold]);
  const older = read?.channelId === channelId ? read?.older : undefined;
  const onOlder = useCallback(() => {
    if (channelId === undefined || older === undefined) return;
    act(ACT_KIND.CHANNELS_THREADS, { channelId, before: older }).then(
      (view) =>
        fold(channelId, (was) =>
          "failure" in view
            ? { ...was, failure: view.failure }
            : was.older !== older
              ? was
              : { ...was, earlier: [...view.threads, ...was.earlier], older: view.older },
        ),
      () => fold(channelId, (was) => ({ ...was, failure: CHANNEL_CALL_FAILURE.UNANSWERED })),
    );
  }, [act, channelId, older, fold]);
  useEffect(() => onRefresh(), [onRefresh]);
  useEffect(() => {
    if (channelId === undefined) return undefined;
    const listener = (moved: readonly string[]) => {
      if (moved.includes(channelId)) onRefresh();
    };
    moveListeners.add(listener);
    return () => {
      moveListeners.delete(listener);
    };
  }, [channelId, onRefresh]);
  const current = read?.channelId === channelId ? read : undefined;
  return {
    threads: current === undefined ? undefined : threadsOf(current),
    failure: current?.failure,
    hasOlder: older !== undefined,
    onRefresh,
    onOlder,
  };
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
 * so a stream showing an archived channel and the window's links and
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
