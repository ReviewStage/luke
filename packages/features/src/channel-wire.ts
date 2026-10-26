import { Schema as EffectSchema } from "effect";
import { inboxItemSchema } from "./inbox-wire.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

/**
 * channel-wire.ts -- a workspace's channels, the topic areas its inbox threads live in, as the panel and the service read them.
 *
 * Every member of a workspace sees every one of its channels, open and
 * archived, and any member creates, edits, archives, or unarchives one, and
 * moves any thread they may read into another open one; but never renames
 * or archives its #general, where every thread that names no channel goes. What differs per reader is how
 * many open asks wait on them in each channel and when they last looked at
 * it. Every write answers the workspace's channels as they then stand, as
 * the read does, so the panel draws the service's word rather than its
 * guess. A channel's threads are inbox items (`inbox-wire.ts`), each read
 * with the channel it lives in.
 */

export const CHANNEL_BOUNDS = {
  /** The most characters a channel's name may spell. */
  MAX_NAME_CHARS: 80,
  /** The most characters a channel's purpose may spell. */
  MAX_PURPOSE_CHARS: 250,
} as const;

/** A channel's name: a lowercase slug of words joined by hyphens, as `app` or `release-notes`. */
export const channelNameSchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(CHANNEL_BOUNDS.MAX_NAME_CHARS),
  EffectSchema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
);

/** A channel's purpose: one line saying what belongs in it, which an agent reads to choose it. */
export const channelPurposeSchema = EffectSchema.Trim.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(CHANNEL_BOUNDS.MAX_PURPOSE_CHARS),
);

/** One open channel of a workspace as its reader reads it. */
export const channelSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  name: EffectSchema.String,
  purpose: EffectSchema.String,
  /** Whether the channel is for one project rather than a standing area. */
  project: EffectSchema.Boolean,
  /** The member who made it; absent on a #general the workspace minted itself, and once their account is gone. */
  createdBy: EffectSchema.optionalKey(EffectSchema.String),
  createdAt: countedNumber,
  /** How many of its threads hold an ask open that waits on the reader. */
  waiting: countedNumber,
  /** When the reader last looked at it; absent where they never have. */
  lookedAt: EffectSchema.optionalKey(countedNumber),
  /** When the latest of its threads the reader may read was posted, which a row beside `lookedAt` reads as unread; absent where it holds none. */
  latestPostedAt: EffectSchema.optionalKey(countedNumber),
});

export type Channel = typeof channelSchema.Type;

/** A workspace's open channels by name, as the read and every write answer them. */
export const channelsAnswerSchema = EffectSchema.Struct({
  channels: EffectSchema.Array(channelSchema),
});

export type ChannelsAnswer = typeof channelsAnswerSchema.Type;

/** The read's query: the workspace whose channels are read. */
export const channelsQuerySchema = EffectSchema.Struct({ workspaceId: workspaceIdSchema });

/** A channel a member makes: its workspace, name, and purpose, and whether it is one project's, which it is not where the request says nothing. */
export const channelCreateRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  name: channelNameSchema,
  purpose: channelPurposeSchema,
  project: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type ChannelCreateRequest = typeof channelCreateRequestSchema.Type;

/** One open channel of a workspace, named by both. */
const channelOfWorkspace = { workspaceId: workspaceIdSchema, channelId: wireUuidSchema };

/** A channel given a new name, a new purpose, or both, what it leaves out standing; #general's name never changes, and its purpose does. */
export const channelEditRequestSchema = EffectSchema.Struct({
  ...channelOfWorkspace,
  name: EffectSchema.optionalKey(channelNameSchema),
  purpose: EffectSchema.optionalKey(channelPurposeSchema),
});

export type ChannelEditRequest = typeof channelEditRequestSchema.Type;

/** A channel archived, which frees its name and leaves its threads where they are; never #general. */
export const channelArchiveRequestSchema = EffectSchema.Struct(channelOfWorkspace);

export type ChannelArchiveRequest = typeof channelArchiveRequestSchema.Type;

/** An archived channel opened again under its own name, its threads where they stood; refused where an open channel now goes by it. */
export const channelUnarchiveRequestSchema = EffectSchema.Struct(channelOfWorkspace);

export type ChannelUnarchiveRequest = typeof channelUnarchiveRequestSchema.Type;

/** One archived channel of a workspace: what it was, and when it was archived. Its threads stay readable. */
export const archivedChannelSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  name: EffectSchema.String,
  purpose: EffectSchema.String,
  project: EffectSchema.Boolean,
  createdBy: EffectSchema.optionalKey(EffectSchema.String),
  createdAt: countedNumber,
  archivedAt: countedNumber,
});

export type ArchivedChannel = typeof archivedChannelSchema.Type;

/** A workspace's archived channels, the latest archived first. */
export const archivedChannelsAnswerSchema = EffectSchema.Struct({
  channels: EffectSchema.Array(archivedChannelSchema),
});

export type ArchivedChannelsAnswer = typeof archivedChannelsAnswerSchema.Type;

/** The reader's look at a channel, stamped at the service's now, which marks what was posted before it as seen. */
export const channelLookRequestSchema = EffectSchema.Struct(channelOfWorkspace);

export type ChannelLookRequest = typeof channelLookRequestSchema.Type;

/** The threads read's query: the channel whose threads are read, and the thread an older page is read before, which the last page's `older` named; the first page where it is left out. */
export const channelThreadsQuerySchema = EffectSchema.Struct({
  channelId: wireUuidSchema,
  before: EffectSchema.optionalKey(wireUuidSchema),
});

/**
 * The agent that posted a thread, as the account's read names one
 * (`account-inbox-wire.ts`), which a post draws where no read of its
 * task's agents the window holds names it: a channel holds every task's
 * threads, and a task's row names only its first few agents.
 */
export const channelThreadAgentSchema = EffectSchema.Struct({
  /** The name it goes by, Luke for a member's operator, else its title; null where it has neither. */
  title: EffectSchema.NullOr(EffectSchema.String),
  /** AI Gateway's catalog id, such as `anthropic/claude-opus-5.5`. */
  model: EffectSchema.String,
  /** The name of the automation whose run started it, which an untitled agent goes by; absent for one started by hand. */
  automationName: EffectSchema.optionalKey(EffectSchema.String),
});

export type ChannelThreadAgent = typeof channelThreadAgentSchema.Type;

/** One thread as a channel carries it: the inbox item, the channel it lives in, and its agent. */
export const channelThreadSchema = EffectSchema.Struct({
  ...inboxItemSchema.fields,
  channelId: wireUuidSchema,
  /** Absent from a service before it, and where the agent's row is gone. */
  agent: EffectSchema.optionalKey(channelThreadAgentSchema),
});

export type ChannelThread = typeof channelThreadSchema.Type;

/**
 * A page of a channel's threads the reader may read, oldest posted first.
 * The first carries the latest posted of those holding no ask open that
 * waits on the reader, and every one that holds such an ask however old; an
 * older page the next latest of the former alone, so paging back reads every
 * thread once. `older` is the thread to read the next older page before,
 * absent where none stands.
 */
export const channelThreadsAnswerSchema = EffectSchema.Struct({
  threads: EffectSchema.Array(channelThreadSchema),
  older: EffectSchema.optionalKey(wireUuidSchema),
});

export type ChannelThreadsAnswer = typeof channelThreadsAnswerSchema.Type;

/** A thread the reader may read moved into another open channel of its own workspace. */
export const channelMoveRequestSchema = EffectSchema.Struct({
  threadId: wireUuidSchema,
  channelId: wireUuidSchema,
});

export type ChannelMoveRequest = typeof channelMoveRequestSchema.Type;

/** The thread a move answers, as it then stands in the channel it went to. */
export const channelMoveAnswerSchema = EffectSchema.Struct({ thread: channelThreadSchema });

export type ChannelMoveAnswer = typeof channelMoveAnswerSchema.Type;
