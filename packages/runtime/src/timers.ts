import { Duration } from "effect";

/** One day in milliseconds, for every age, half-life, and lookback measured in days. */
export const DAY_MS = Duration.toMillis(Duration.days(1));
