/**
 * What this machine reports of itself on every change-signal poll, and the
 * one rule that turns the machine's facts into the report. The report is two
 * instants and nothing wider: the instant presence holds until, and the
 * instant a meeting hold ends. The service records them and decides nothing
 * from them here; a quiet instant holds speech, and holding is the whole of
 * its power.
 */

/** The machine's own facts, read by the client that runs on it; the host never reads them itself. */
export interface MachinePresence {
  /** Seconds since input was last seen, as the operating system counts them. */
  readonly idleSeconds: number;
  readonly screenLocked: boolean;
}

/** What one poll reports: each an epoch-millisecond instant, or `null` to clear the one on file. */
export interface DevicePresenceReport {
  readonly activeUntil: number | null;
  readonly quietUntil: number | null;
}

/** How often a signed-in Mac polls the change signal, which is also how often its presence is restated. */
export const DEVICE_POLL_INTERVAL_MS = 60_000;

/**
 * The developer is present while input was seen within the limit and the
 * screen is unlocked — both, not either — and presence is claimed only until
 * the second poll after this one, so a Mac that stops polling reads as gone
 * on its own without a poll to say so, and one poll that was missed does not
 * flicker it.
 */
export const PRESENCE_RULE = {
  IDLE_LIMIT_SECONDS: 120,
  ACTIVE_WINDOW_MS: 2 * DEVICE_POLL_INTERVAL_MS,
} as const;

/** The instant presence holds until, or `null` for a machine that is idle, locked, or unknown to this host. */
export function activeUntilFrom(presence: MachinePresence | undefined, now: number): number | null {
  if (presence === undefined || presence.screenLocked) return null;
  if (presence.idleSeconds >= PRESENCE_RULE.IDLE_LIMIT_SECONDS) return null;
  return now + PRESENCE_RULE.ACTIVE_WINDOW_MS;
}
