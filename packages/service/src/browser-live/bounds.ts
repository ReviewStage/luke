/**
 * bounds.ts -- the live view's bounds: how long a socket stands, how often it moves the agent's sandbox lease on, and how fast its frames go.
 *
 * Note that they stand apart from the relay (`relay.ts`), which imports
 * the tabs' procedures for a takeover's hold, so a procedure that holds a
 * sandbox on the live view's terms (`agent-browser-tabs-procedures.ts`'s
 * open) reads them without importing the relay back.
 */

import { Duration } from "effect";

export const BROWSER_LIVE_BOUNDS = {
  /** How long a socket stays open past the panel's last message. */
  IDLE: Duration.minutes(5),
  /** How often the panel's messages move the lease on, so a mouse move is not a write. */
  LEASE_WRITE_EVERY: Duration.minutes(1),
  /** How often a socket asks whether the panel has gone the idle bound silent. */
  IDLE_CHECK_EVERY: Duration.seconds(30),
  /** How often the tab is read again, for its driver and whether it still stands. */
  TAB_CHECK_EVERY: Duration.seconds(5),
  /** How often input moves the member's takeover on, well inside its hold. */
  RENEW_EVERY: Duration.seconds(10),
  /** The least time between two frames: at most eight a second. */
  FRAME_EVERY: Duration.millis(125),
  /** How long the close waits on the browser to stop the cast. */
  CAST_END_TIMEOUT: Duration.seconds(2),
  /** The most bytes the panel's socket may still be sending before a frame is skipped. */
  MAX_BUFFERED_BYTES: 1024 * 1024,
  /** The screencast: JPEG, no larger than a laptop's screen, at a quality text stays legible at. */
  SCREENCAST: { format: "jpeg", quality: 60, maxWidth: 1280, maxHeight: 800 },
} as const;
