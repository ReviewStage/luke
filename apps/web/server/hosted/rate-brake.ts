/**
 * Per-user in-memory brake, keyed on the resolved account rather than the
 * network address: the token already names who is asking, so rotating IPs
 * cannot route around it. The counter lives in the function instance, which
 * makes it a per-instance brake rather than a cluster-wide guarantee —
 * platform-level rules are the real backstop — but it turns a hammering
 * client into a trickle and limits amplification against provider quotas.
 */
export interface RateBrakeConfig {
  windowMs: number;
  maxRequestsPerWindow: number;
  /** The map is bounded; past this it forgets the oldest window rather than growing. */
  maxTrackedUsers: number;
}

/**
 * Whether this ask puts the caller over the window. `weight` is what the ask
 * costs — one request by default, or the events a batch carries — so a single
 * oversized batch is braked on arrival rather than on the one after it.
 */
export type RateBrake = (userId: string, now: number, weight?: number) => boolean;

export function createRateBrake(config: RateBrakeConfig): RateBrake {
  const recentUsers = new Map<string, { windowStart: number; count: number }>();
  return (userId, now, weight = 1) => {
    const held = recentUsers.get(userId);
    if (!held || now - held.windowStart >= config.windowMs) {
      if (recentUsers.size >= config.maxTrackedUsers) {
        recentUsers.clear();
      }
      recentUsers.set(userId, { windowStart: now, count: weight });
      return weight > config.maxRequestsPerWindow;
    }
    held.count += weight;
    return held.count > config.maxRequestsPerWindow;
  };
}
