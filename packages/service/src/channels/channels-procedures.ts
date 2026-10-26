/**
 * channels-procedures.ts -- a workspace's channels: read them, open or archived, make, edit, archive, or unarchive one, stamp the reader's look at one, read a page of one's threads, and move a thread into one.
 *
 * The channels resource of the hosted oRPC router (`@luke/features/contract`'s
 * `channels.ts`). Any member of a workspace reads and writes its channels,
 * but never renames or archives its #general (`channel-store.ts`), and every
 * write on a channel answers the workspace's channels as they then stand,
 * each with how many open asks wait on the reader there (`inbox-store.ts`'s
 * `WAITS_ON`), when they last looked at it, and when its latest thread was
 * posted. A member moves any thread they may read into another open channel
 * of its workspace. A workspace the account is not in, a channel none of
 * its own, or a thread they may not read, is not found.
 */

import {
  type ArchivedChannelRow,
  archiveChannel,
  CHANNEL_WRITE_REFUSAL,
  type ChannelWriteRefusal,
  channelWorkspaceOf,
  createChannel,
  editChannel,
  listArchivedChannels,
  listChannelLooks,
  openChannels,
  stampChannelLook,
  unarchiveChannel,
} from "@luke/database/models/channel-store";
import { isWorkspaceMember } from "@luke/database/models/workspace-store";
import type { ArchivedChannel, Channel, ChannelsAnswer } from "@luke/features/channel-wire";
import { DateTime, Effect, Option, Result } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import {
  channelLatestPosts,
  channelThreads,
  channelWaitingCounts,
  moveChannelThread,
} from "../inbox/inbox-store.js";
import { accountMiddleware, hosted } from "../orpc/base.js";

export interface ChannelsProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The refusal a channel write the store refused is answered with. */
function writeRefusal(refusal: ChannelWriteRefusal): HostedRefusal {
  switch (refusal) {
    case CHANNEL_WRITE_REFUSAL.NOT_FOUND:
      return HOSTED_REFUSAL.NOT_FOUND;
    case CHANNEL_WRITE_REFUSAL.NAME_TAKEN:
      return HOSTED_REFUSAL.CHANNEL_NAME_TAKEN;
    case CHANNEL_WRITE_REFUSAL.GENERAL:
      return HOSTED_REFUSAL.NOT_PERMITTED;
  }
}

/** A store write's outcome, its refusal failed as the request's. */
const written = <A>(outcome: Result.Result<A, ChannelWriteRefusal>) =>
  Result.isFailure(outcome)
    ? Effect.fail(writeRefusal(outcome.failure))
    : Effect.succeed(outcome.success);

/** The channel's workspace, open or archived, as the reader reaches it; not found where it is none of theirs. */
const workspaceOfChannel = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  channelId: string,
) {
  const workspace = yield* hostedStoreOrUnavailable(channelWorkspaceOf(userId, channelId));
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return workspace.value;
});

/**
 * The workspace's open channels as the reader reads them, its #general
 * minted first where it has none yet; not found where the account is not a
 * member, whose list is the one that holds none.
 */
const channelsOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  organizationId: string,
) {
  const now = yield* DateTime.nowAsDate;
  const [rows, waiting, looks, latest] = yield* hostedStoreOrUnavailable(
    Effect.all([
      openChannels(userId, organizationId, now),
      channelWaitingCounts(userId, organizationId),
      listChannelLooks(userId, organizationId),
      channelLatestPosts(userId, organizationId),
    ]),
  );
  if (rows.length === 0) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const lookedAt = new Map(looks.map((look) => [look.channelId, look.lookedAt]));
  const channels = rows.map((row): Channel => {
    const looked = lookedAt.get(row.id);
    const posted = latest.get(row.id);
    return {
      id: row.id,
      name: row.name,
      purpose: row.purpose,
      project: row.project,
      ...(row.createdBy === null ? undefined : { createdBy: row.createdBy }),
      createdAt: row.createdAt,
      waiting: waiting.get(row.id) ?? 0,
      ...(looked === undefined ? undefined : { lookedAt: looked }),
      ...(posted === undefined ? undefined : { latestPostedAt: posted }),
    };
  });
  const answer: ChannelsAnswer = { channels };
  return answer;
});

/** An archived channel as the wire carries it. */
function archivedChannel(row: ArchivedChannelRow): ArchivedChannel {
  return {
    id: row.id,
    name: row.name,
    purpose: row.purpose,
    project: row.project,
    ...(row.createdBy === null ? undefined : { createdBy: row.createdBy }),
    createdAt: row.createdAt,
    archivedAt: row.archivedAt,
  };
}

/** The channels resource: the workspace's channels, open or archived, one made, edited, archived, unarchived, or looked at, a page of one's threads, and a thread moved. */
export function channelsProcedures(seams: ChannelsProcedureSeams) {
  const signedIn = hosted.channels.use(accountMiddleware(seams.resolveUserId));
  return {
    list: signedIn.list.effect(function* ({ input, context }) {
      return yield* channelsOf(context.userId, input.workspaceId);
    }),
    create: signedIn.create.effect(function* ({ input, context }) {
      const { workspaceId, name, purpose, project = false } = input;
      const now = yield* DateTime.nowAsDate;
      const made = yield* hostedStoreOrUnavailable(
        createChannel(context.userId, workspaceId, { name, purpose, project }, now),
      );
      yield* written(made);
      return yield* channelsOf(context.userId, workspaceId);
    }),
    edit: signedIn.edit.effect(function* ({ input, context }) {
      const { workspaceId, channelId, name, purpose } = input;
      const edited = yield* hostedStoreOrUnavailable(
        editChannel(context.userId, workspaceId, channelId, { name, purpose }),
      );
      yield* written(edited);
      return yield* channelsOf(context.userId, workspaceId);
    }),
    archive: signedIn.archive.effect(function* ({ input, context }) {
      const { workspaceId, channelId } = input;
      const now = yield* DateTime.nowAsDate;
      const archived = yield* hostedStoreOrUnavailable(
        archiveChannel(context.userId, workspaceId, channelId, now),
      );
      yield* written(archived);
      return yield* channelsOf(context.userId, workspaceId);
    }),
    unarchive: signedIn.unarchive.effect(function* ({ input, context }) {
      const { workspaceId, channelId } = input;
      const opened = yield* hostedStoreOrUnavailable(
        unarchiveChannel(context.userId, workspaceId, channelId),
      );
      yield* written(opened);
      return yield* channelsOf(context.userId, workspaceId);
    }),
    archived: signedIn.archived.effect(function* ({ input, context }) {
      const { workspaceId } = input;
      // Note that membership is read first, because a workspace with no archived channel answers none as one the account is not in would.
      const member = yield* hostedStoreOrUnavailable(
        isWorkspaceMember(context.userId, workspaceId),
      );
      if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const rows = yield* hostedStoreOrUnavailable(
        listArchivedChannels(context.userId, workspaceId),
      );
      return { channels: rows.map(archivedChannel) };
    }),
    look: signedIn.look.effect(function* ({ input, context }) {
      const { workspaceId, channelId } = input;
      // A channel of another workspace than the one named is not found, so a look never lands where the answer does not.
      const workspace = yield* workspaceOfChannel(context.userId, channelId);
      if (workspace !== workspaceId) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const now = yield* DateTime.nowAsDate;
      yield* hostedStoreOrUnavailable(stampChannelLook(context.userId, channelId, now));
      return yield* channelsOf(context.userId, workspaceId);
    }),
    threads: signedIn.threads.effect(function* ({ input, context }) {
      // Note that the channel is reached first, so one of a workspace the reader is not in is not found rather than empty.
      yield* workspaceOfChannel(context.userId, input.channelId);
      const page = yield* hostedStoreOrUnavailable(
        channelThreads(context.userId, input.channelId, input.before),
      );
      // A thread to read before that the reader may not read is not found, so a page never reads past one they cannot see.
      if (Option.isNone(page)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return page.value;
    }),
    move: signedIn.move.effect(function* ({ input, context }) {
      const moved = yield* hostedStoreOrUnavailable(
        moveChannelThread(context.userId, input.threadId, input.channelId),
      );
      // Note that a thread the mover may not read and a channel that is no open one of its workspace are one refusal, so a move tells nothing of either.
      if (Result.isFailure(moved)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { thread: moved.success };
    }),
  };
}
