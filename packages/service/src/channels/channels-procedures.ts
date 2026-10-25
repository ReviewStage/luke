/**
 * channels-procedures.ts -- a workspace's channels: read them, make, rename, or archive one, stamp the reader's look at one, and read one's threads.
 *
 * The channels resource of the hosted oRPC router (`@luke/features/contract`'s
 * `channels.ts`). Any member of a workspace reads and writes its channels,
 * but never renames or archives its #general (`channel-store.ts`), and every
 * write answers the workspace's channels as they then stand, each with how
 * many open asks wait on the reader there (`inbox-store.ts`'s `WAITS_ON`)
 * and when they last looked at it. A workspace the account is not in, or a
 * channel none of its own, is not found.
 */

import {
  archiveChannel,
  CHANNEL_WRITE_REFUSAL,
  type ChannelWriteRefusal,
  createChannel,
  listChannelLooks,
  openChannels,
  renameChannel,
  stampChannelLook,
} from "@luke/database/models/channel-store";
import type { Channel, ChannelsAnswer } from "@luke/features/channel-wire";
import { DateTime, Effect, Result } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { channelThreads, channelWaitingCounts } from "../inbox/inbox-store.js";
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
  const [rows, waiting, looks] = yield* hostedStoreOrUnavailable(
    Effect.all([
      openChannels(userId, organizationId, now),
      channelWaitingCounts(userId, organizationId),
      listChannelLooks(userId, organizationId),
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
    };
  });
  const answer: ChannelsAnswer = { channels };
  return answer;
});

/** The channels resource: the workspace's channels, one made, renamed, archived, or looked at, and one's threads. */
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
    rename: signedIn.rename.effect(function* ({ input, context }) {
      const { workspaceId, channelId, name } = input;
      const renamed = yield* hostedStoreOrUnavailable(
        renameChannel(context.userId, workspaceId, channelId, name),
      );
      yield* written(renamed);
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
    look: signedIn.look.effect(function* ({ input, context }) {
      const { workspaceId, channelId } = input;
      const now = yield* DateTime.nowAsDate;
      // Note that a look at a channel of another workspace stamps nothing, and the list then answers for the one named.
      yield* hostedStoreOrUnavailable(stampChannelLook(context.userId, channelId, now));
      return yield* channelsOf(context.userId, workspaceId);
    }),
    threads: signedIn.threads.effect(function* ({ input, context }) {
      const threads = yield* hostedStoreOrUnavailable(
        channelThreads(context.userId, input.channelId),
      );
      return { threads };
    }),
  };
}
