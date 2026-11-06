import { Duration } from "effect";

export const BROWSER_LIVE_BOUNDS = {
  IDLE: Duration.minutes(5),
  INPUT_IDLE: Duration.minutes(15),
  LEASE_WRITE_EVERY: Duration.minutes(1),
  IDLE_CHECK_EVERY: Duration.seconds(30),
  TAB_CHECK_EVERY: Duration.seconds(5),
  RENEW_EVERY: Duration.seconds(10),
  FRAME_EVERY: Duration.millis(125),
  CAST_END_TIMEOUT: Duration.seconds(2),
  MAX_BUFFERED_BYTES: 1024 * 1024,
  SCREENCAST: { format: "jpeg", quality: 60, maxWidth: 1280, maxHeight: 800 },
} as const;
