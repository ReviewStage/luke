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

export function createRateBrake(config: RateBrakeConfig): (userId: string, now: number) => boolean {
  const recentUsers = new Map<string, { windowStart: number; count: number }>();
  return (userId, now) => {
    const held = recentUsers.get(userId);
    if (!held || now - held.windowStart >= config.windowMs) {
      if (recentUsers.size >= config.maxTrackedUsers) {
        recentUsers.clear();
      }
      recentUsers.set(userId, { windowStart: now, count: 1 });
      return false;
    }
    held.count += 1;
    return held.count > config.maxRequestsPerWindow;
  };
}
