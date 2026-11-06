import type { SyncTopic } from "@repo/database/sync/notification";
import { Context, type Duration, Effect, Option, type Scope } from "effect";

export const NO_TOPICS: readonly SyncTopic[] = [];

const NO_TXIDS: readonly string[] = [];

export interface SyncWatch {
  readonly next: Effect.Effect<readonly string[]>;
  readonly heardAt: Effect.Effect<Option.Option<number>>;
}

export interface SyncShape {
  readonly watch: (
    topics: readonly SyncTopic[],
    fallback: Duration.Duration,
  ) => Effect.Effect<SyncWatch, never, Scope.Scope>;
}

export const clockWatch = (fallback: Duration.Duration): SyncWatch => ({
  next: Effect.as(Effect.sleep(fallback), NO_TXIDS),
  heardAt: Effect.succeed(Option.none()),
});

const CLOCK_SYNC: SyncShape = {
  watch: (_topics, fallback) => Effect.succeed(clockWatch(fallback)),
};

export const Sync = Context.Reference<SyncShape>("@repo/service/Sync", {
  defaultValue: () => CLOCK_SYNC,
});
