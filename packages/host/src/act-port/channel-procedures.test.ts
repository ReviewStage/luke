import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { CHANNEL_CALL_FAILURE } from "@luke/features/channel-view";
import { Effect } from "effect";
import {
  type ActPortClient,
  CHANNEL_ACT_KIND,
  type PortActPayload,
  type PortActResult,
} from "../contract/index.js";
import type { ActSender } from "./base.js";
import { channelProcedures } from "./channel-procedures.js";
import type { ChannelProceduresDependencies } from "./index.js";
import { settledAct, type TestActPort, testActPort } from "./testing.js";

/**
 * The Channels view's acts, through the act port as a window calls them:
 * only a panel asks; a window that is not a panel is refused in each kind's
 * own words before the host is asked; and a panel's ask reaches the host
 * with its payload as the panel sent it.
 */

// The platform's handle on the window that asked, which no procedure here reads.
const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true };
const OTHER_WINDOW: ActSender = { ...PANEL, panel: false };

const ports: TestActPort<unknown>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

const WORKSPACE_ID = "workspace-1";
const CHANNEL_ID = "3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f60";
const THREAD_ID = "8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/** Each kind's refusal, as its contract procedure words it. */
const REFUSAL = {
  [CHANNEL_ACT_KIND.CHANNELS_CREATE]: "Could not make the channel on this system.",
  [CHANNEL_ACT_KIND.CHANNELS_EDIT]: "Could not edit the channel on this system.",
  [CHANNEL_ACT_KIND.CHANNELS_ARCHIVE]: "Could not archive the channel on this system.",
  [CHANNEL_ACT_KIND.CHANNELS_UNARCHIVE]: "Could not unarchive the channel on this system.",
  [CHANNEL_ACT_KIND.CHANNELS_LOOK]: "Could not mark the channel seen on this system.",
  [CHANNEL_ACT_KIND.CHANNELS_THREADS]: "Could not read the channel's threads on this system.",
  [CHANNEL_ACT_KIND.CHANNELS_MOVE]: "Could not move the thread on this system.",
} as const;

type Kind = keyof typeof REFUSAL;

/** One call of each kind, with the payload a panel sends and the host ask it reaches. */
const ACTS: readonly {
  kind: Kind;
  host: string;
  payload: PortActPayload<Kind>;
  call: (client: ActPortClient) => Promise<PortActResult<Kind>>;
}[] = [
  {
    kind: CHANNEL_ACT_KIND.CHANNELS_CREATE,
    host: "create",
    payload: { workspaceId: WORKSPACE_ID, name: "release", purpose: "Shipping", project: true },
    call: (client) =>
      client[CHANNEL_ACT_KIND.CHANNELS_CREATE]({
        workspaceId: WORKSPACE_ID,
        name: "release",
        purpose: "Shipping",
        project: true,
      }),
  },
  {
    kind: CHANNEL_ACT_KIND.CHANNELS_EDIT,
    host: "edit",
    payload: {
      workspaceId: WORKSPACE_ID,
      channelId: CHANNEL_ID,
      name: "ship",
      purpose: "Releases",
    },
    call: (client) =>
      client[CHANNEL_ACT_KIND.CHANNELS_EDIT]({
        workspaceId: WORKSPACE_ID,
        channelId: CHANNEL_ID,
        name: "ship",
        purpose: "Releases",
      }),
  },
  {
    kind: CHANNEL_ACT_KIND.CHANNELS_ARCHIVE,
    host: "archive",
    payload: { workspaceId: WORKSPACE_ID, channelId: CHANNEL_ID },
    call: (client) =>
      client[CHANNEL_ACT_KIND.CHANNELS_ARCHIVE]({
        workspaceId: WORKSPACE_ID,
        channelId: CHANNEL_ID,
      }),
  },
  {
    kind: CHANNEL_ACT_KIND.CHANNELS_UNARCHIVE,
    host: "unarchive",
    payload: { workspaceId: WORKSPACE_ID, channelId: CHANNEL_ID },
    call: (client) =>
      client[CHANNEL_ACT_KIND.CHANNELS_UNARCHIVE]({
        workspaceId: WORKSPACE_ID,
        channelId: CHANNEL_ID,
      }),
  },
  {
    kind: CHANNEL_ACT_KIND.CHANNELS_LOOK,
    host: "look",
    payload: { workspaceId: WORKSPACE_ID, channelId: CHANNEL_ID },
    call: (client) =>
      client[CHANNEL_ACT_KIND.CHANNELS_LOOK]({ workspaceId: WORKSPACE_ID, channelId: CHANNEL_ID }),
  },
  {
    kind: CHANNEL_ACT_KIND.CHANNELS_THREADS,
    host: "threads",
    payload: { channelId: CHANNEL_ID, before: THREAD_ID },
    call: (client) =>
      client[CHANNEL_ACT_KIND.CHANNELS_THREADS]({ channelId: CHANNEL_ID, before: THREAD_ID }),
  },
  {
    kind: CHANNEL_ACT_KIND.CHANNELS_MOVE,
    host: "move",
    payload: { threadId: THREAD_ID, channelId: CHANNEL_ID },
    call: (client) =>
      client[CHANNEL_ACT_KIND.CHANNELS_MOVE]({ threadId: THREAD_ID, channelId: CHANNEL_ID }),
  },
];

type HostAsk = ChannelProceduresDependencies["host"];

/** A window's act port over a host that answers every channel ask unanswered, and what it was asked. */
function windowPort(actor: ActSender) {
  const asked: unknown[] = [];
  const unanswered = (name: string) => (params: unknown) =>
    Effect.sync(() => {
      asked.push([name, params]);
      return { failure: CHANNEL_CALL_FAILURE.UNANSWERED };
    });
  const host: HostAsk = {
    channelsCreate: unanswered("create"),
    channelsEdit: unanswered("edit"),
    channelsArchive: unanswered("archive"),
    channelsUnarchive: unanswered("unarchive"),
    channelsLook: unanswered("look"),
    channelsThreads: unanswered("threads"),
    channelsMove: unanswered("move"),
    channelsFollow: () => Effect.void,
    channelsUnfollow: () => Effect.void,
    channelsRetry: () => Effect.void,
  };
  const port = testActPort<unknown>(channelProcedures({ host }));
  ports.push(port);
  return { client: port.as(actor, { trusted: true }), asked };
}

it("a window that is not a panel is refused every channel act in the kind's own words, and the host is not asked", async () => {
  const { client, asked } = windowPort(OTHER_WINDOW);
  for (const act of ACTS) {
    assert.deepEqual(await settledAct(act.call(client)), { refused: REFUSAL[act.kind] });
  }
  assert.deepEqual(asked, []);
});

it("a panel's ask reaches the host with its payload, and the host's answer is the panel's", async () => {
  const { client, asked } = windowPort(PANEL);
  for (const act of ACTS) {
    assert.deepEqual(await settledAct(act.call(client)), {
      answer: { failure: CHANNEL_CALL_FAILURE.UNANSWERED },
    });
  }
  assert.deepEqual(
    asked,
    ACTS.map((act) => [act.host, act.payload]),
  );
});
