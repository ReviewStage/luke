import { Clock, Effect } from "effect";

export interface RateBrakeConfig {
  windowMs: number;
  maxRequestsPerWindow: number;
  maxTrackedUsers: number;
}

export interface RateBrake {
  readonly check: (userId: string, weight?: number) => Effect.Effect<boolean>;
}

interface TrackedWindow {
  readonly windowStart: number;
  readonly count: number;
}

export function makeRateBrake(config: RateBrakeConfig): RateBrake {
  const tracked = new Map<string, TrackedWindow>();

  return {
    check: (userId, weight = 1) =>
      Effect.map(Clock.currentTimeMillis, (now) => {
        const held = tracked.get(userId);
        if (!held || now - held.windowStart >= config.windowMs) {
          if (tracked.size >= config.maxTrackedUsers) tracked.clear();
          tracked.set(userId, { windowStart: now, count: weight });
          return weight <= config.maxRequestsPerWindow;
        }
        const count = held.count + weight;
        tracked.set(userId, { windowStart: held.windowStart, count });
        return count <= config.maxRequestsPerWindow;
      }),
  };
}
