/**
 * channels-procedures.ts -- a workspace's channels: read them, open or archived, make, edit, archive, or unarchive one, stamp the reader's look at one, read a page of one's threads, and move a thread into one.
 *
 * The channels resource of the hosted oRPC router (`@luke/features/contract`'s
 * `channels.ts`). Any member of a workspace reads and writes its channels,
 * but never renames or archives its #general (`channel-store.ts`), and every
 * write on a channel answers the workspace's channels as they then stand,
 * and the transaction it was written in, which a desktop following the
 * channels waits for, each with how many open asks wait on the reader there (`inbox-store.ts`'s
 * `WAITS_ON`), when they last looked at it, how many of its threads they
 * may read, and when the latest was posted; an archived channel carries the
 * same but the look. A member moves any thread they may read into another open channel
 * of its workspace. A workspace the account is not in, a channel none of
 * its own, or a thread they may not read, is not found.
 */

import {
  type ArchivedChannelRow,
  archiveChannel,
  CHANNEL_WRITE_REFUSAL,
  type ChannelTxid,
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
  type ChannelPostTally,
  channelPostTallies,
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

/** The workspace's channels as they stand once a write landed, with the transaction it was written in where it wrote any. */
const channelsWritten = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  organizationId: string,
  { txid }: ChannelTxid,
) {
  const answer: ChannelsAnswer = yield* channelsOf(userId, organizationId);
  return txid === undefined ? answer : { ...answer, txid };
});

/** What a channel holds of the threads the reader may read, as the wire carries it: none and no latest post where it holds none. */
function tallied(tally: ChannelPostTally | undefined): Pick<Channel, "threads" | "latestPostedAt"> {
  return tally === undefined
    ? { threads: 0 }
    : { threads: tally.threads, latestPostedAt: tally.latestPostedAt };
}

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
  const [rows, waiting, looks, tallies] = yield* hostedStoreOrUnavailable(
    Effect.all([
      openChannels(userId, organizationId, now),
      channelWaitingCounts(userId, organizationId),
      listChannelLooks(userId, organizationId),
      channelPostTallies(userId, organizationId),
    ]),
  );
  if (rows.length === 0) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const lookedAt = new Map(looks.map((look) => [look.channelId, look.lookedAt]));
  const channels = rows.map((row): Channel => {
    const looked = lookedAt.get(row.id);
    return {
      id: row.id,
      name: row.name,
      purpose: row.purpose,
      project: row.project,
      ...(row.createdBy === null ? undefined : { createdBy: row.createdBy }),
      createdAt: row.createdAt,
      waiting: waiting.get(row.id) ?? 0,
      ...(looked === undefined ? undefined : { lookedAt: looked }),
      ...tallied(tallies.get(row.id)),
    };
  });
  const answer: ChannelsAnswer = { channels };
  return answer;
});

/** An archived channel as the wire carries it, with what waits on the reader in it and what it holds for them. */
function archivedChannel(
  row: ArchivedChannelRow,
  waiting: number,
  tally: ChannelPostTally | undefined,
): ArchivedChannel {
  return {
    id: row.id,
    name: row.name,
    purpose: row.purpose,
    project: row.project,
    ...(row.createdBy === null ? undefined : { createdBy: row.createdBy }),
    createdAt: row.createdAt,
    archivedAt: row.archivedAt,
    waiting,
    ...tallied(tally),
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
      const { workspaceId, name, purpose, project = false, id } = input;
      const now = yield* DateTime.nowAsDate;
      const made = yield* hostedStoreOrUnavailable(
        createChannel(context.userId, workspaceId, { name, purpose, project, id }, now),
      );
      return yield* channelsWritten(context.userId, workspaceId, yield* written(made));
    }),
    edit: signedIn.edit.effect(function* ({ input, context }) {
      const { workspaceId, channelId, name, purpose } = input;
      const edited = yield* hostedStoreOrUnavailable(
        editChannel(context.userId, workspaceId, channelId, { name, purpose }),
      );
      return yield* channelsWritten(context.userId, workspaceId, yield* written(edited));
    }),
    archive: signedIn.archive.effect(function* ({ input, context }) {
      const { workspaceId, channelId } = input;
      const now = yield* DateTime.nowAsDate;
      const archived = yield* hostedStoreOrUnavailable(
        archiveChannel(context.userId, workspaceId, channelId, now),
      );
      return yield* channelsWritten(context.userId, workspaceId, yield* written(archived));
    }),
    unarchive: signedIn.unarchive.effect(function* ({ input, context }) {
      const { workspaceId, channelId } = input;
      const opened = yield* hostedStoreOrUnavailable(
        unarchiveChannel(context.userId, workspaceId, channelId),
      );
      return yield* channelsWritten(context.userId, workspaceId, yield* written(opened));
    }),
    archived: signedIn.archived.effect(function* ({ input, context }) {
      const { workspaceId } = input;
      // Note that membership is read first, because a workspace with no archived channel answers none as one the account is not in would.
      const member = yield* hostedStoreOrUnavailable(
        isWorkspaceMember(context.userId, workspaceId),
      );
      if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const [rows, waiting, tallies] = yield* hostedStoreOrUnavailable(
        Effect.all([
          listArchivedChannels(context.userId, workspaceId),
          channelWaitingCounts(context.userId, workspaceId),
          channelPostTallies(context.userId, workspaceId),
        ]),
      );
      return {
        channels: rows.map((row) =>
          archivedChannel(row, waiting.get(row.id) ?? 0, tallies.get(row.id)),
        ),
      };
    }),
    look: signedIn.look.effect(function* ({ input, context }) {
      const { workspaceId, channelId } = input;
      // A channel of another workspace than the one named is not found, so a look never lands where the answer does not.
      const workspace = yield* workspaceOfChannel(context.userId, channelId);
      if (workspace !== workspaceId) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const now = yield* DateTime.nowAsDate;
      const looked = yield* hostedStoreOrUnavailable(
        stampChannelLook(context.userId, channelId, now),
      );
      return yield* channelsWritten(context.userId, workspaceId, looked);
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
      return { thread: moved.success.thread, txid: moved.success.txid };
    }),
  };
}
