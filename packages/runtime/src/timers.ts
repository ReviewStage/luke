import { Duration } from "effect";

export const SECOND_MS = Duration.toMillis(Duration.seconds(1));
export const MINUTE_MS = Duration.toMillis(Duration.minutes(1));
export const HOUR_MS = Duration.toMillis(Duration.hours(1));
export const DAY_MS = Duration.toMillis(Duration.days(1));
