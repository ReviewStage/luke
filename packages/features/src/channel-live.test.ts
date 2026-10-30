import assert from "node:assert/strict";
import { it } from "vitest";
import { channelRowsOfLive, channelsOfRows } from "./channel-live.js";

/**
 * The list a window draws from a workspace's channels read: each channel
 * with what it holds for the reader, joined by its id, open ones by name
 * and archived ones the latest archived first, as the service's list
 * answers them.
 */

it("draws the open channels by name with the reader's counts and look, and the archived latest first", () => {
  const channel = { purpose: "Work.", project: false, createdBy: null, createdAt: 1 };
  const list = channelsOfRows(
    channelRowsOfLive({
      channels: [
        { ...channel, id: "c-web", name: "web", archivedAt: null },
        { ...channel, id: "c-old", name: "old", archivedAt: 50 },
        { ...channel, id: "c-app", name: "app", archivedAt: null, createdBy: "user-dean" },
        { ...channel, id: "c-new", name: "new", archivedAt: 90 },
      ],
      tallies: [
        { channelId: "c-app", threads: 3, latestPostedAt: 40 },
        { channelId: "c-old", threads: 1, latestPostedAt: 20 },
      ],
      waiting: [{ channelId: "c-app", waiting: 2 }],
      looks: [{ channelId: "c-web", lookedAt: 30 }],
    }),
  );
  assert.deepEqual(list, {
    open: [
      {
        id: "c-app",
        name: "app",
        purpose: "Work.",
        project: false,
        createdAt: 1,
        createdBy: "user-dean",
        waiting: 2,
        latestPostedAt: 40,
        threads: 3,
      },
      {
        id: "c-web",
        name: "web",
        purpose: "Work.",
        project: false,
        createdAt: 1,
        waiting: 0,
        threads: 0,
        lookedAt: 30,
      },
    ],
    archived: [
      {
        id: "c-new",
        name: "new",
        purpose: "Work.",
        project: false,
        createdAt: 1,
        archivedAt: 90,
        waiting: 0,
        threads: 0,
      },
      {
        id: "c-old",
        name: "old",
        purpose: "Work.",
        project: false,
        createdAt: 1,
        archivedAt: 50,
        waiting: 0,
        latestPostedAt: 20,
        threads: 1,
      },
    ],
  });
});
