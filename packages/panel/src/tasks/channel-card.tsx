import type { ArchivedChannel, Channel } from "@luke/features/channel-wire";
import { LIVE_READ } from "@luke/features/live-wire";
import { dateOfText } from "@luke/features/time-format";
import {
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  HoverCardRule,
  HoverCardSkeleton,
  Time,
  useMinute,
} from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";
import type { ReactNode } from "react";
import { PROVENANCE_VERB, ProvenanceRow } from "../actor-ref.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import { HOST_READ_STATUS, useHostRead } from "../use-host-read.js";
import { useLinkWorkspace, WorkspaceDirectory } from "./chip-cards.js";
import { needsYouWords, threadsWords } from "./inbox-model.js";
import { useHeldChannel } from "./use-channels.js";

/**
 * channel-card.tsx -- a channel's card, hung wherever the window names one: a `#channel` chip in words, its sidebar row, and its row in the command palette.
 *
 * The card is drawn as every other card is: a head of the channel's glyph,
 * its bare name, under it what kind it is and how much it holds ("Channel ·
 * 42 threads", or "Project · archived Oct 26" once archived), and in its
 * corner how many of its asks wait on the reader, in the Inbox tab card's
 * words, or where none does, how long since its latest post; then its
 * purpose as the note; and at its foot, under a rule, who made it and when,
 * as a task's card says it. A #general the workspace minted itself, and a
 * channel whose maker's account is gone, has no foot. It says nothing in
 * colour and offers no way in, since the control it hangs from opens the
 * channel. What it shows is read from the channels the host holds
 * (`useHeldChannel`); a chip naming one no list the host holds names, as a
 * channel of another workspace, holds that workspace's channels, open and
 * archived, while the card is hung (`useHostRead`), as every surface holds
 * the channels it reads. The card waits as every chip's card does
 * (`HoverCardSkeleton`) while that read or its maker's name is out.
 */

/** What a channel is called by its kind, in its card's sub. */
const CHANNEL_KIND_WORDS = { CHANNEL: "Channel", PROJECT: "Project" } as const;

/** What parts the kind from the size in a card's sub. */
const PART = " · ";

/** What a channel's card says under its name: its kind, and how many threads it holds, or when it was archived. */
function channelSub(channel: Channel | ArchivedChannel, now: number): string {
  const kind = channel.project ? CHANNEL_KIND_WORDS.PROJECT : CHANNEL_KIND_WORDS.CHANNEL;
  if ("archivedAt" in channel)
    return `${kind}${PART}archived ${dateOfText(channel.archivedAt, now)}`;
  const { threads } = channel;
  if (threads === undefined) return kind;
  return `${kind}${PART}${threadsWords(threads)}`;
}

/** What stands in a channel's card's corner: how many of its asks wait on the reader, else how long since its latest post, else nothing. */
function channelCorner(channel: Channel | ArchivedChannel, now: number): ReactNode {
  const waiting = channel.waiting ?? 0;
  if (waiting > 0) return needsYouWords(waiting);
  const latest = channel.latestPostedAt;
  return latest === undefined ? undefined : <Time at={latest} now={now} hint={false} />;
}

/** Who made a channel and when, as the members around it name them (`ProvenanceRow`). */
function CreatedBy({
  userId,
  name,
  at,
  now,
}: {
  userId: string;
  name: string;
  at: number;
  now: number;
}): React.JSX.Element {
  return (
    <ProvenanceRow
      verb={PROVENANCE_VERB.CREATED}
      actor={usePerson({ userId, name })}
      at={at}
      now={now}
    />
  );
}

/** A channel's card as the members around it name its maker; waiting while they are read. */
function ChannelCardBody({ channel }: { channel: Channel | ArchivedChannel }): React.JSX.Element {
  const now = useMinute();
  const { members, former, reading } = useMemberDirectory();
  const { createdBy } = channel;
  // Note that a maker neither the members nor who left name has no account the card can name, so it says nothing of them.
  const maker =
    createdBy === undefined
      ? undefined
      : [...(members ?? []), ...(former ?? [])].find((each) => each.userId === createdBy);
  if (createdBy !== undefined && maker === undefined && reading) {
    return (
      <HoverCardSkeleton glyph={<GLYPH.CHANNEL />} name={channel.name} sub data-channel-card="" />
    );
  }
  return (
    <HoverCard data-channel-card="">
      <HoverCardHead
        glyph={<GLYPH.CHANNEL />}
        name={channel.name}
        sub={channelSub(channel, now)}
        corner={channelCorner(channel, now)}
      />
      <HoverCardNote>{channel.purpose}</HoverCardNote>
      {maker === undefined ? null : (
        <>
          <HoverCardRule />
          <CreatedBy userId={maker.userId} name={maker.name} at={channel.createdAt} now={now} />
        </>
      )}
    </HoverCard>
  );
}

/** A channel's card, its maker named as the members of its workspace hold them where the window lists that workspace, else as the members around it do. */
export function ChannelCard({
  channel,
  workspaceId,
}: {
  channel: Channel | ArchivedChannel;
  workspaceId: string | undefined;
}): React.JSX.Element {
  const workspace = useAppSlice(APP_SLICE.TASKS)?.workspaces.find(
    (each) => each.id === workspaceId,
  );
  const body = <ChannelCardBody channel={channel} />;
  return workspace === undefined ? (
    body
  ) : (
    <WorkspaceDirectory workspace={workspace}>{body}</WorkspaceDirectory>
  );
}

/** A channel's card where the host holds no list naming it, its workspace's channels held while it is hung; `reading` until they are read, and `fallback` where the read failed or names no such channel. */
function ReadChannelChipCard({
  workspaceId,
  channelId,
  reading,
  fallback,
}: {
  workspaceId: string;
  channelId: string;
  reading: ReactNode;
  fallback: ReactNode;
}): ReactNode {
  const { rows, status } = useHostRead(LIVE_READ.CHANNELS, workspaceId);
  if (status === HOST_READ_STATUS.LOADING) return reading;
  const channel =
    rows?.open.find((each) => each.id === channelId) ??
    rows?.archived.find((each) => each.id === channelId);
  if (channel === undefined) return fallback;
  return <ChannelCard channel={channel} workspaceId={workspaceId} />;
}

/**
 * A `#channel` chip's card, the channel read in the workspace the link
 * names, else the one the words are of, from the channels the window holds
 * of it, else read as the card is hung; `reading` while they are, and
 * `fallback` where no workspace is known or no list of it names the channel.
 */
export function ChannelChipCard({
  channelId,
  workspace: slug,
  wordsWorkspaceId,
  reading,
  fallback,
}: {
  channelId: string;
  /** The slug of the workspace the link was written under. */
  workspace: string;
  /** The workspace the words are of, read where the account holds none of the link's slug. */
  wordsWorkspaceId: string | undefined;
  reading: ReactNode;
  fallback: ReactNode;
}): ReactNode {
  const named = useLinkWorkspace(slug);
  const workspaceId = named?.id ?? wordsWorkspaceId;
  const held = useHeldChannel(workspaceId, channelId);
  if (workspaceId === undefined) return fallback;
  if (held !== undefined) return <ChannelCard channel={held} workspaceId={workspaceId} />;
  return (
    <ReadChannelChipCard
      workspaceId={workspaceId}
      channelId={channelId}
      reading={reading}
      fallback={fallback}
    />
  );
}
