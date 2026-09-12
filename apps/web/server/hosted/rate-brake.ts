import { Clock, Effect } from "effect";

/**
 * Per-user brake, keyed on the resolved account rather than the network
 * address: the token already names who is asking, so rotating IPs cannot
 * route around it. The map lives in the function instance, which makes it a
 * per-instance brake rather than a cluster-wide guarantee — platform-level
 * rules are the real backstop — but it turns a hammering client into a
 * trickle and limits amplification against provider quotas.
 *
 * Effect's own `RateLimiter` is built for throttling a queue of work, not
 * for admission control: its only way to ask "is a permit free right now"
 * is racing its blocking `take` against a zero-duration timeout, and that
 * race is genuinely nondeterministic — a busy event loop can lose it even
 * when a permit stands free, which turned "past the brake" into a flaky
 * false refusal under this repository's own test suite. What this keeps of
 * Effect instead is `Clock`: the same window-and-count check the hand-rolled
 * brake made, over the same bounded map, but read through the ambient Clock
 * so it is `TestClock`-testable without a route threading its own `now`
 * through it, and written inside one synchronous step so two checks for the
 * same user never interleave.
 */
export interface RateBrakeConfig {
  windowMs: number;
  maxRequestsPerWindow: number;
  /** The map is bounded; past this it forgets every tracked user rather than growing. */
  maxTrackedUsers: number;
}

export interface RateBrake {
  readonly check: (userId: string, weight?: number) => Effect.Effect<boolean>;
}

interface TrackedWindow {
  readonly windowStart: number;
  readonly count: number;
}

/**
 * A per-user brake built once: whether an ask puts its user over the
 * window, `weight` being what the ask costs — one request by default, or
 * the events a batch carries — so a single oversized batch is braked on
 * arrival rather than on the one after it.
 */
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

/**
 * The promise door the routes that still hold a promise call through,
 * keeping the older brake's own polarity — `true` means the request is over
 * the window and must be refused — since each of them reads it as
 * `if (rateLimited(userId)) return 429`. The check needs no service: its
 * whole state is the map `makeRateBrake` closes over, so nothing here needs
 * a runtime edge to answer it.
 *
 * @deprecated A strangler shim. P10-16 moved every route it converted onto
 * `RateBrake.check` directly; it goes with the last promise-shaped hosted
 * route (`conversation-read.ts`, `events.ts`, `devices-vault-app.ts`).
 */
export function createRateBrake(
  config: RateBrakeConfig,
): (userId: string, weight?: number) => Promise<boolean> {
  const brake = makeRateBrake(config);
  return (userId, weight) =>
    Effect.runPromise(Effect.map(brake.check(userId, weight), (admitted) => !admitted));
}
