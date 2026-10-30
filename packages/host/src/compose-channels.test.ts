import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { WorkspaceChannelsLiveRows } from "@luke/features/channel-live";
import { CHANNEL_CALL_FAILURE, type ChannelsView } from "@luke/features/channel-view";
import type { Channel } from "@luke/features/channel-wire";
import type { LIVE_SIGNED_OUT } from "@luke/features/live-wire";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethod,
} from "@luke/gateway";
import type { WireRecord, WireValue } from "@luke/wire";
import { noNetwork } from "@luke/wire/testing";
import { Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import type { AppWorkspaceChannels } from "./app-state.js";
import { composeChannels } from "./compose-channels.js";
import { polledLive } from "./testing/polled-live.js";

/**
 * The channels concern: a workspace a window holds is followed once,
 * however often a window lets it go and holds it again, and its channels
 * are told on the slice every window draws. A rename or an archive is drawn
 * on that slice the moment it is asked and stands until the followed list
 * carries its transaction, and one the service refused is put back.
 * Synthetic ids and words.
 */

const WORKSPACE_ID = "workspace-1";
const ACCOUNT_ID = "account-1";
const APP_ID = "3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f60";

const settled = Effect.repeat(Effect.yieldNow, { times: 100 });

/** `settled`, then the host's next poll asked, which waits half a second after the last answered (`live-follow.ts`), then `settled` again. */
const nextPoll = Effect.andThen(
  settled,
  Effect.andThen(TestClock.adjust(Duration.millis(500)), settled),
);

const context = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };

/** #app's row as the list's channels statement answers it, open unless archived. */
function appRow(fields: { name?: string; archivedAt?: number } = {}) {
  return {
    id: APP_ID,
    name: fields.name ?? "app",
    purpose: "The desktop and web apps",
    project: false,
    createdBy: null,
    createdAt: 1,
    archivedAt: fields.archivedAt ?? null,
  };
}

/** The list's rows with #app as given and nothing waiting on the reader. */
function listOf(app: ReturnType<typeof appRow>): WorkspaceChannelsLiveRows {
  return { channels: [app], tallies: [], waiting: [], looks: [] };
}

/** #app as a write's answer lists it among the open channels. */
const APP: Channel = {
  id: APP_ID,
  name: "app",
  purpose: "The desktop and web apps",
  project: false,
  createdAt: 1,
  waiting: 0,
  threads: 0,
};

function subject() {
  return Effect.gen(function* () {
    const list = polledLive<keyof WorkspaceChannelsLiveRows, typeof LIVE_SIGNED_OUT>([
      "channels",
      "tallies",
      "waiting",
      "looks",
    ]);
    const firstReads: string[] = [];
    const replies: { edit: ChannelsView; archive: ChannelsView } = {
      edit: { channels: [APP] },
      archive: { channels: [] },
    };
    const emitted: { kind: string; payload: WireValue }[] = [];
    const composer = yield* composeChannels({
      kernel: {
        runMode: { sendsNetwork: true },
        now: () => 50,
        createId: () => "c0ffee00-0000-4000-8000-000000000001",
        emit: (kind, payload) => emitted.push({ kind, payload }),
      },
      account: { capabilitiesActive: () => true },
      accountId: () => ACCOUNT_ID,
      inbox: { write: (_change, written) => written },
      client: {
        create: () => Effect.succeed({ channels: [] }),
        edit: () => Effect.succeed(replies.edit),
        archive: () => Effect.succeed(replies.archive),
        unarchive: () => Effect.succeed({ channels: [] }),
        look: () => Effect.succeed({ channels: [] }),
        threads: () => Effect.succeed({ threads: [] }),
        move: () => Effect.succeed({ failure: CHANNEL_CALL_FAILURE.NOT_FOUND }),
        workspaceLive: (workspaceId, _userId, poll, after) =>
          poll
            ? list.poll(after)
            : Effect.sync(() => {
                firstReads.push(workspaceId);
                return list.first();
              }),
      },
    }).pipe(Effect.provide(noNetwork));
    const call = (method: GatewayMethod, params: WireRecord = {}) => {
      const handler = composer.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return handler(params, context);
    };
    /** #app as each telling of the held workspaces drew it: its name, and whether it was archived. */
    const drawn = () =>
      emitted
        .filter((each) => each.kind === GATEWAY_EVENT.WORKSPACE_CHANNELS_CHANGED)
        .flatMap((each) => {
          const rows = (each.payload as unknown as AppWorkspaceChannels)[WORKSPACE_ID]?.rows;
          if (rows === undefined) return [];
          const open = rows.open.find((channel) => channel.id === APP_ID);
          const archived = rows.archived.find((channel) => channel.id === APP_ID);
          return [open === undefined ? `archived ${archived?.name}` : open.name];
        });
    return { call, list, firstReads, replies, drawn };
  });
}

it.effect(
  "a workspace let go and held again, as a channel switch draws its surfaces again, is read once",
  () =>
    Effect.gen(function* () {
      const { call, list, firstReads, drawn } = yield* subject();
      list.set(listOf(appRow()));

      yield* call(GATEWAY_METHOD.CHANNELS_FOLLOW, { workspaceId: WORKSPACE_ID });
      yield* settled;
      yield* call(GATEWAY_METHOD.CHANNELS_UNFOLLOW, { workspaceId: WORKSPACE_ID });
      yield* call(GATEWAY_METHOD.CHANNELS_FOLLOW, { workspaceId: WORKSPACE_ID });
      yield* settled;

      assert.deepEqual(firstReads, [WORKSPACE_ID]);
      assert.deepEqual(drawn(), ["app"]);
    }),
);

it.effect(
  "a rename stands from the press until the held list carries its transaction, through an answer from before it, and a refused archive is put back",
  () =>
    Effect.gen(function* () {
      const { call, list, replies, drawn } = yield* subject();
      list.set(listOf(appRow()));
      yield* call(GATEWAY_METHOD.CHANNELS_FOLLOW, { workspaceId: WORKSPACE_ID });
      yield* settled;
      // An answer Luke Sync woke hands the follow its wait for a write's transaction.
      list.set(listOf(appRow()), ["1"]);
      yield* nextPoll;

      replies.edit = { channels: [{ ...APP, name: "web" }], txid: "2" };
      const from = drawn().length;
      const renamed = yield* Effect.forkChild(
        call(GATEWAY_METHOD.CHANNELS_EDIT, {
          workspaceId: WORKSPACE_ID,
          channelId: APP_ID,
          name: "web",
        }),
      );
      yield* settled;
      assert.equal(drawn().at(-1), "web", "the rename is drawn before the service answers");
      // An answer from before the rename landed is held behind it rather than drawn.
      list.set(listOf(appRow()), ["3"]);
      yield* nextPoll;
      list.set(listOf(appRow({ name: "web" })), ["2"]);
      yield* nextPoll;

      assert.deepEqual(yield* Fiber.join(renamed), replies.edit);
      assert.deepEqual(
        drawn()
          .slice(from)
          .filter((name) => name !== "web"),
        [],
        "the old name is never drawn back",
      );

      replies.archive = { failure: CHANNEL_CALL_FAILURE.NOT_PERMITTED };
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.CHANNELS_ARCHIVE, {
          workspaceId: WORKSPACE_ID,
          channelId: APP_ID,
        }),
        replies.archive,
      );
      assert.equal(drawn().at(-1), "web", "the refused archive is put back");
    }),
);
