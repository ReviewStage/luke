import { Layer } from "effect";
import { HostedClock } from "./tags.js";

export const HostedClockLive = Layer.succeed(HostedClock, {
  now: () => Date.now(),
});
