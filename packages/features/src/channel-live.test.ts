import assert from "node:assert/strict";
import { it } from "vitest";
import { type ChannelsLiveRows, channelsMovedBetween } from "./channel-live.js";

/**
 * Which of a workspace's channels a follow tells moved: each whose row or
 * threads changed between two deliveries, one gone among them, and every
 * one on a seal's first delivery, since the window's own read may have
 * missed it.
 */

const CHANNEL = { id: "app", name: "app", purpose: "Desktop.", project: false, archivedAt: null };

const BEFORE: ChannelsLiveRows = {
  channels: [
    CHANNEL,
    { ...CHANNEL, id: "web", name: "web" },
    { ...CHANNEL, id: "infra", name: "infra" },
    { ...CHANNEL, id: "docs", name: "docs" },
  ],
  threads: [
    { channelId: "app", threads: 2, updatedAt: 10 },
    { channelId: "web", threads: 1, updatedAt: 10 },
  ],
};

it("tells the channels renamed, re-purposed, archived, or whose threads moved, and every one at first", () => {
  const after: ChannelsLiveRows = {
    channels: [
      CHANNEL,
      { ...CHANNEL, id: "web", name: "site" },
      { ...CHANNEL, id: "infra", name: "infra", archivedAt: 20 },
      { ...CHANNEL, id: "docs", name: "docs", purpose: "Guides." },
    ],
    threads: [
      { channelId: "app", threads: 3, updatedAt: 10 },
      { channelId: "web", threads: 1, updatedAt: 10 },
    ],
  };
  const quiet: ChannelsLiveRows = { ...BEFORE, channels: BEFORE.channels.toReversed() };

  assert.deepEqual(channelsMovedBetween(BEFORE, after), ["app", "docs", "infra", "web"]);
  assert.deepEqual(channelsMovedBetween(BEFORE, quiet), []);
  assert.deepEqual(channelsMovedBetween(undefined, BEFORE), ["app", "docs", "infra", "web"]);
});
