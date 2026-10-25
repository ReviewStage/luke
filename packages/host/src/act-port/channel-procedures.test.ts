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
 * only a panel asks; the voice and call windows are refused in each kind's
 * own words before the host is asked; and a panel's ask reaches the host
 * with its payload as the panel sent it.
 */

// The platform's handle on the window that asked, which no procedure here reads.
const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };
const CALL: ActSender = { ...PANEL, panel: false, call: true };

const ports: TestActPort<unknown>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

const WORKSPACE_ID = "workspace-1";
const CHANNEL_ID = "3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f60";

/** Each kind's refusal, as its contract procedure words it. */
const REFUSAL = {
  [CHANNEL_ACT_KIND.CHANNELS_LIST]: "Could not read the channels on this system.",
  [CHANNEL_ACT_KIND.CHANNELS_CREATE]: "Could not make the channel on this system.",
  [CHANNEL_ACT_KIND.CHANNELS_RENAME]: "Could not rename the channel on this system.",
  [CHANNEL_ACT_KIND.CHANNELS_ARCHIVE]: "Could not archive the channel on this system.",
  [CHANNEL_ACT_KIND.CHANNELS_LOOK]: "Could not mark the channel seen on this system.",
  [CHANNEL_ACT_KIND.CHANNELS_THREADS]: "Could not read the channel's threads on this system.",
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
    kind: CHANNEL_ACT_KIND.CHANNELS_LIST,
    host: "list",
    payload: { workspaceId: WORKSPACE_ID },
    call: (client) => client[CHANNEL_ACT_KIND.CHANNELS_LIST]({ workspaceId: WORKSPACE_ID }),
  },
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
    kind: CHANNEL_ACT_KIND.CHANNELS_RENAME,
    host: "rename",
    payload: { workspaceId: WORKSPACE_ID, channelId: CHANNEL_ID, name: "ship" },
    call: (client) =>
      client[CHANNEL_ACT_KIND.CHANNELS_RENAME]({
        workspaceId: WORKSPACE_ID,
        channelId: CHANNEL_ID,
        name: "ship",
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
    kind: CHANNEL_ACT_KIND.CHANNELS_LOOK,
    host: "look",
    payload: { workspaceId: WORKSPACE_ID, channelId: CHANNEL_ID },
    call: (client) =>
      client[CHANNEL_ACT_KIND.CHANNELS_LOOK]({ workspaceId: WORKSPACE_ID, channelId: CHANNEL_ID }),
  },
  {
    kind: CHANNEL_ACT_KIND.CHANNELS_THREADS,
    host: "threads",
    payload: { channelId: CHANNEL_ID },
    call: (client) => client[CHANNEL_ACT_KIND.CHANNELS_THREADS]({ channelId: CHANNEL_ID }),
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
    channelsList: unanswered("list"),
    channelsCreate: unanswered("create"),
    channelsRename: unanswered("rename"),
    channelsArchive: unanswered("archive"),
    channelsLook: unanswered("look"),
    channelsThreads: unanswered("threads"),
  };
  const port = testActPort<unknown>(channelProcedures({ host }));
  ports.push(port);
  return { client: port.as(actor, { trusted: true }), asked };
}

it("the voice and call windows are refused every channel act in the kind's own words, and the host is not asked", async () => {
  for (const actor of [VOICE, CALL]) {
    const { client, asked } = windowPort(actor);
    for (const act of ACTS) {
      assert.deepEqual(await settledAct(act.call(client)), { refused: REFUSAL[act.kind] });
    }
    assert.deepEqual(asked, []);
  }
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
