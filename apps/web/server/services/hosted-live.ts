import { Layer } from "effect";
import { HostedAuthLive } from "./auth-live.js";
import { HostedClockLive } from "./clock-live.js";
import { HostedDatabaseLive } from "./database-live.js";
import { HostedEncryptionLive } from "./encryption-live.js";
import { HostedMeterLive } from "./meter-live.js";
import { HostedOpenAiLive } from "./openai-live.js";
import { HostedPosthogLive } from "./posthog-live.js";

const HostedBaseLive = Layer.mergeAll(
  HostedClockLive,
  HostedDatabaseLive,
  HostedAuthLive,
  HostedOpenAiLive,
  HostedEncryptionLive,
);

export const HostedLive = Layer.provideMerge(
  HostedBaseLive,
  Layer.mergeAll(HostedMeterLive, HostedPosthogLive),
);
