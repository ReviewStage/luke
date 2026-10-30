import type { HostedChannelClient } from "@luke/features";
import type { ChannelListRow } from "@luke/features/channel-live";
import {
  CHANNEL_CALL_FAILURE,
  type ChannelMoveView,
  type ChannelsView,
  type ChannelThreadsView,
  channelArchiveParamsSchema,
  channelCreateParamsSchema,
  channelEditParamsSchema,
  channelLookParamsSchema,
  channelMoveParamsSchema,
  channelsFollowParamsSchema,
  channelThreadsParamsSchema,
  channelUnarchiveParamsSchema,
} from "@luke/features/channel-view";
import type { Channel } from "@luke/features/channel-wire";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  readParams,
} from "@luke/gateway";
import type { WireValue } from "@luke/wire";
import { Effect, FiberMap, type Scope } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type { AppWorkspaceChannels } from "./app-state.js";
import { writtenFields } from "./channel-collections.js";
import { type WorkspaceChannelsHeld, workspaceChannels } from "./channel-follow.js";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { HostKernel } from "./host-kernel.js";
import { INBOX_CHANGE, type InboxReads } from "./inbox-collections.js";
import type { RowRefused, RowWritten } from "./live-collection.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-channels.ts -- a workspace's channels, held for the windows and asked of the service on their behalf: followed, made, edited, archived, unarchived, looked at, a page of one's threads read, and a thread moved.
 *
 * A workspace a window holds is followed over the service's held poll and
 * kept in a collection (`channel-follow.ts`), and every held workspace is
 * told to every window as `WORKSPACE_CHANNELS_CHANGED`, which the app state
 * lays in its slice. Every write on a channel of a held workspace is drawn
 * over its collection the moment it is asked and stands until the followed
 * list carries its transaction, or is taken back where the service refused
 * it; a channel made is drawn under an id minted here, which the service
 * takes. A thread moved is drawn over every inbox read holding it
 * (`inbox-collections.ts`) and waited for on its channels' list too. Behind
 * a closed account gate, or on a run that sends nothing, every ask answers
 * unanswered and nothing is followed until the gate opens; a sign-out lets
 * every follow go.
 */

/** The service's side of the channels, as this concern asks it. */
type ChannelsClient = Pick<
  HostedChannelClient,
  "create" | "edit" | "archive" | "unarchive" | "look" | "threads" | "move" | "workspaceLive"
>;

export interface ChannelsDependencies {
  kernel: Pick<HostKernel, "emit" | "now" | "createId"> & {
    runMode: Pick<RunMode, "sendsNetwork">;
  };
  account: Pick<AccountComposer, "capabilitiesActive">;
  /** The account signed in now, which a follow names from its start; none where nobody is. */
  accountId: () => string | undefined;
  client: ChannelsClient;
  /** The inbox reads a thread moved between channels is drawn over (`compose-agents.ts`). */
  inbox: Pick<InboxReads, "write">;
}

export interface ChannelsComposer extends Composer {
  /** Every held workspace followed anew, as the account gate opening asks. */
  readonly open: Effect.Effect<void>;
  /** Every follow let go, as a sign-out lets them go. */
  readonly reset: Effect.Effect<void>;
}

const UNANSWERED = { failure: CHANNEL_CALL_FAILURE.UNANSWERED } as const;

export function composeChannels(
  dependencies: ChannelsDependencies,
): Effect.Effect<ChannelsComposer, never, Scope.Scope | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const gate = () =>
      dependencies.kernel.runMode.sendsNetwork && dependencies.account.capabilitiesActive();
    const asked = askedOf(gate, http);
    const held = yield* workspaceChannels({
      live: (workspaceId, userId, poll, after) =>
        asked(dependencies.client.workspaceLive(workspaceId, userId, poll, after)),
      accountId: dependencies.accountId,
      gate,
      tell: (channels: AppWorkspaceChannels) =>
        Effect.sync(() =>
          dependencies.kernel.emit(GATEWAY_EVENT.WORKSPACE_CHANNELS_CHANGED, carried(channels)),
        ),
    });
    const holds = yield* FiberMap.make<string>();
    return composed(dependencies, asked, held, holds);
  });
}

/** The service asked behind the gate, over the host's own HTTP client. */
function askedOf(gate: () => boolean, http: HttpClient.HttpClient) {
  return <Answer>(
    call: Effect.Effect<Answer, never, HttpClient.HttpClient>,
  ): Effect.Effect<Answer | typeof UNANSWERED> =>
    gate() ? Effect.provideService(call, HttpClient.HttpClient, http) : Effect.succeed(UNANSWERED);
}

/** The channel a write's answer names, as the workspace's channels then stand; none where it refused or does not name it. */
function answeredChannel(view: ChannelsView, channelId: string): Channel | undefined {
  return "failure" in view ? undefined : view.channels.find((each) => each.id === channelId);
}

/** A write's answer as a row write reads it, carried for the window: refused, or kept with its transaction and what it says of the channel. */
function rowWritten(
  view: ChannelsView,
  channelId: string,
): RowWritten<ChannelListRow, WireValue> | RowRefused<WireValue> {
  if ("failure" in view) return { refused: carried(view) };
  const channel = answeredChannel(view, channelId);
  return {
    answer: carried(view),
    txid: view.txid,
    ...(channel === undefined ? undefined : { fields: writtenFields(channel) }),
  };
}

/** The composer's one table, built from its seams; nothing here starts anything but what a window holds. */
function composed(
  dependencies: ChannelsDependencies,
  asked: ReturnType<typeof askedOf>,
  held: WorkspaceChannelsHeld,
  holds: FiberMap.FiberMap<string>,
): ChannelsComposer {
  const { kernel, client, inbox } = dependencies;

  /**
   * A write on one channel of a held workspace, `change` drawn over its row
   * at once and standing while the service writes it; asked alone where no
   * follow of the workspace stands.
   */
  const writtenOver = (
    workspaceId: string,
    channelId: string,
    change: (row: ChannelListRow) => Partial<ChannelListRow>,
    call: Effect.Effect<ChannelsView>,
  ) =>
    Effect.suspend((): Effect.Effect<WireValue> => {
      const list = held.standing(workspaceId);
      if (list === undefined) return Effect.map(call, (view) => carried<ChannelsView>(view));
      return list.write(
        channelId,
        change,
        Effect.map(call, (view) => rowWritten(view, channelId)),
      );
    });

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.CHANNELS_CREATE]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          channelCreateParamsSchema,
          params,
          "a channel made names its workspace, its name, and its purpose",
        );
        // Note that the id is minted here, so the channel is drawn before the service answers and kept under the id it takes.
        const made = { ...read, id: read.id ?? kernel.createId() };
        const call: Effect.Effect<ChannelsView> = asked(client.create(made));
        const list = held.standing(made.workspaceId);
        if (list === undefined) return carried<ChannelsView>(yield* call);
        const row: ChannelListRow = {
          id: made.id,
          name: made.name,
          purpose: made.purpose,
          project: made.project ?? false,
          createdBy: dependencies.accountId() ?? null,
          createdAt: kernel.now(),
          archivedAt: null,
          waiting: 0,
          lookedAt: null,
          latestPostedAt: null,
          threads: 0,
        };
        return yield* list.made(
          row,
          Effect.map(call, (view) => rowWritten(view, made.id)),
        );
      }),
    [GATEWAY_METHOD.CHANNELS_EDIT]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          channelEditParamsSchema,
          params,
          "an edit names a workspace's channel and its new name or purpose",
        );
        const { name, purpose } = read;
        return yield* writtenOver(
          read.workspaceId,
          read.channelId,
          () => ({
            ...(name === undefined ? undefined : { name }),
            ...(purpose === undefined ? undefined : { purpose }),
          }),
          asked(client.edit(read)),
        );
      }),
    [GATEWAY_METHOD.CHANNELS_UNARCHIVE]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          channelUnarchiveParamsSchema,
          params,
          "an unarchive names a workspace's channel",
        );
        return yield* writtenOver(
          read.workspaceId,
          read.channelId,
          () => ({ archivedAt: null }),
          asked(client.unarchive(read)),
        );
      }),
    [GATEWAY_METHOD.CHANNELS_ARCHIVE]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          channelArchiveParamsSchema,
          params,
          "an archive names a workspace's channel",
        );
        // Note that the answer lists open channels alone, so the archive stands as drawn until the list carries the service's instant.
        return yield* writtenOver(
          read.workspaceId,
          read.channelId,
          () => ({ archivedAt: kernel.now() }),
          asked(client.archive(read)),
        );
      }),
    [GATEWAY_METHOD.CHANNELS_LOOK]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          channelLookParamsSchema,
          params,
          "a look names a workspace's channel",
        );
        return yield* writtenOver(
          read.workspaceId,
          read.channelId,
          () => ({ lookedAt: kernel.now() }),
          asked(client.look(read)),
        );
      }),
    [GATEWAY_METHOD.CHANNELS_MOVE]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          channelMoveParamsSchema,
          params,
          "a move names a thread and the channel it goes to",
        );
        const { threadId, channelId } = read;
        const answer = yield* inbox.write(
          { kind: INBOX_CHANGE.MOVED, itemId: threadId, channelId },
          asked(client.move(read)) satisfies Effect.Effect<ChannelMoveView>,
          (view) => ({
            txid: "failure" in view ? undefined : view.txid,
            item: undefined,
            kept: !("failure" in view),
          }),
        );
        // A thread moved moves both channels' counts, so the move answers once the list showing them carries it too.
        const list = "failure" in answer ? undefined : held.holding(channelId);
        if (list !== undefined && !("failure" in answer)) yield* list.confirm(answer.txid);
        return carried<ChannelMoveView>(answer);
      }),
    // A window holds a workspace's channels while it draws them; the hold is one fiber standing until let go, so a window holding it again holds nothing anew.
    [GATEWAY_METHOD.CHANNELS_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* readParams(
          channelsFollowParamsSchema,
          params,
          "a follow names a workspace",
        );
        yield* FiberMap.run(
          holds,
          workspaceId,
          Effect.scoped(Effect.andThen(held.hold(workspaceId), Effect.never)),
          { onlyIfMissing: true },
        );
        return {};
      }),
    [GATEWAY_METHOD.CHANNELS_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* readParams(
          channelsFollowParamsSchema,
          params,
          "a follow names a workspace",
        );
        yield* FiberMap.remove(holds, workspaceId);
        return {};
      }),
    [GATEWAY_METHOD.CHANNELS_RETRY]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* readParams(
          channelsFollowParamsSchema,
          params,
          "reading channels again names a workspace",
        );
        yield* held.retry(workspaceId);
        return {};
      }),
    [GATEWAY_METHOD.CHANNELS_THREADS]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          channelThreadsParamsSchema,
          params,
          "a read names a channel",
        );
        return carried<ChannelThreadsView>(yield* asked(client.threads(read)));
      }),
  };

  // Note that the windows' holds stand through a sign-out, so a session signing in follows them anew (`open`).
  return { methods, lifetime: Effect.void, open: held.open, reset: held.end };
}
