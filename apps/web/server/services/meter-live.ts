import { Effect, Layer } from "effect";
import {
  HOSTED_METER,
  readHostedUsage,
  spendHostedMeter,
  spendIntroductionMeter,
} from "../hosted/quota.js";
import { HostedClock, HostedDatabaseService, HostedMeterService } from "./tags.js";

export const HostedMeterLive = Layer.effect(
  HostedMeterService,
  Effect.gen(function* () {
    const database = yield* HostedDatabaseService;
    const clock = yield* HostedClock;
    return {
      spend: (userId, meter) =>
        Effect.promise(() => spendHostedMeter(database, { userId, meter, now: clock.now() })),
      spendIntroduction: (callerKey) =>
        Effect.promise(() => spendIntroductionMeter(database, { callerKey, now: clock.now() })),
      readUsage: (userId) =>
        Effect.promise(() => readHostedUsage(database, { userId, now: clock.now() })),
    };
  }),
);

export { HOSTED_METER };
