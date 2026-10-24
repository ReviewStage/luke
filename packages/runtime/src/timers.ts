import { Duration } from "effect";

/** One second, minute, hour, and day in milliseconds, for every age, half-life, and lookback measured in them. */
export const SECOND_MS = Duration.toMillis(Duration.seconds(1));
export const MINUTE_MS = Duration.toMillis(Duration.minutes(1));
export const HOUR_MS = Duration.toMillis(Duration.hours(1));
export const DAY_MS = Duration.toMillis(Duration.days(1));
