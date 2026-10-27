import assert from "node:assert/strict";
import type { Channel } from "@luke/features/channel-wire";
import { test } from "vitest";
import { CHANNEL_SHOWN, channelShown, channelSlug, channelUnread } from "./channels-model.js";

/**
 * channels-model.test.ts -- the channel the Inbox is narrowed to, open,
 * archived, or gone; a channel's unread weight; and a typed name written
 * as a channel's.
 */

/** Noon on the 20th of October 2026. */
const NOON = new Date(2026, 9, 20, 12).getTime();
const HOUR = 60 * 60 * 1000;

test("a typed name is written as a channel's", () => {
  assert.equal(channelSlug("  Release Train!  v2 "), "release-train-v2");
});

/** A channel of the workspace, standing or a project's. */
function channelOf(id: string, name: string, project = false): Channel {
  return { id, name, purpose: "A purpose", project, createdAt: NOON, waiting: 0 };
}

test("the Inbox is narrowed to the channel chosen while it stands, to none where none is chosen, and says a channel chosen that stands no more is gone", () => {
  const app = channelOf("c-app", "app");
  const general = channelOf("c-general", "general");
  assert.deepEqual(channelShown([app, general], "c-app"), {
    kind: CHANNEL_SHOWN.CHANNEL,
    channel: app,
  });
  assert.deepEqual(channelShown([app, general], undefined), { kind: CHANNEL_SHOWN.NONE });
  assert.deepEqual(channelShown([app, general], "c-archived"), { kind: CHANNEL_SHOWN.MISSING });
  assert.deepEqual(channelShown(undefined, "c-app"), { kind: CHANNEL_SHOWN.NONE });
});

test("a channel chosen among the archived ones is shown, and one neither open nor archived is gone", () => {
  const general = channelOf("c-general", "general");
  const old = { ...channelOf("c-old", "old-app"), archivedAt: NOON };
  assert.deepEqual(channelShown([general], "c-old", [old]), {
    kind: CHANNEL_SHOWN.ARCHIVED,
    channel: old,
  });
  assert.deepEqual(channelShown([general], "c-unknown", [old]), { kind: CHANNEL_SHOWN.MISSING });
});

test("a channel reads unread once something is posted after the reader's look, or where they never looked at one holding a thread", () => {
  const channel = (seen: Partial<Channel>): Channel => ({
    id: "c-app",
    name: "app",
    purpose: "A purpose",
    project: false,
    createdAt: NOON,
    waiting: 0,
    ...seen,
  });
  assert.equal(channelUnread(channel({ lookedAt: NOON, latestPostedAt: NOON + HOUR })), true);
  assert.equal(channelUnread(channel({ lookedAt: NOON + HOUR, latestPostedAt: NOON })), false);
  assert.equal(channelUnread(channel({ latestPostedAt: NOON })), true);
  assert.equal(channelUnread(channel({})), false);
});
