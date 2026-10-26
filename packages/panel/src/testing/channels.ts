/**
 * channels.ts -- one workspace's #general as the act port answers it, for a
 * test that opens a thread beside its stream, as a link to the thread does.
 */

import type { Channel } from "@luke/features/channel-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { FakeActPort } from "./app-bridge.js";

/** The channel a test's threads open beside. */
export const GENERAL_CHANNEL: Channel = {
  id: "0c0c0c0c-0000-4000-8000-000000000001",
  name: "general",
  purpose: "Anything that belongs nowhere else.",
  project: false,
  waiting: 0,
  createdAt: 1,
};

/** The act port's answers for the channels: #general alone, its stream holding no thread, since a test opens its threads as a link does. */
export const CHANNEL_PROCEDURES: Partial<FakeActPort> = {
  [ACT_KIND.CHANNELS_LIST]: () => Promise.resolve({ channels: [GENERAL_CHANNEL] }),
  [ACT_KIND.CHANNELS_LOOK]: () => Promise.resolve({ channels: [GENERAL_CHANNEL] }),
  [ACT_KIND.CHANNELS_THREADS]: () => Promise.resolve({ threads: [] }),
};
