/**
 * listener.ts -- `LISTEN` on Luke Sync's channel, over a connection of the listener's own.
 *
 * A pooler can't hold a `LISTEN`, since the session it would be registered
 * on is handed to another client after each transaction, and the pooled
 * client's connections are the requests' own (the store tests' Postgres pool
 * holds one), so a listen opens a single connection to the unpooled URL it is
 * handed and holds it for as long as its scope stands. What arrives is handed
 * on as the payload's text: `SyncNotificationSchema` reads it, and what to do
 * with one that does not decode is the reader's to decide. The store's tests
 * listen on their PGlite instead (`@luke/database/testing`).
 */
import { PgClient } from "@effect/sql-pg";
import { Context, type Duration, Effect, Layer, type Redacted, type Scope, Stream } from "effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import type { SqlError } from "effect/sql/SqlError";
import { SYNC_CHANNEL } from "./notification.js";

export interface SyncListenerShape {
  /**
   * Listens on `luke_sync`, answering once Postgres has acknowledged the
   * `LISTEN`, so a write committed after it is answered is heard. The
   * stream carries every payload from then on, in commit order, and fails
   * with the connection's error once the connection is lost; closing the
   * scope ends the listen and its connection.
   */
  readonly listen: Effect.Effect<Stream.Stream<string, SqlError>, SqlError, Scope.Scope>;
}

export class SyncListener extends Context.Service<SyncListener, SyncListenerShape>()(
  "@luke/database/SyncListener",
) {}

export interface SyncListenerConnection {
  /** The database's unpooled URL. */
  readonly url: Redacted.Redacted;
  /** How long a connection may take to open, on the caller's clock; `@effect/sql-pg`'s default where left out. */
  readonly connectTimeout?: Duration.Input;
}

/** A listener opening a connection of its own to the URL for each listen. */
export const syncListenerOverUrl = ({
  url,
  connectTimeout,
}: SyncListenerConnection): Layer.Layer<SyncListener> =>
  Layer.succeed(SyncListener, {
    listen: Effect.gen(function* () {
      const client = yield* PgClient.makeClient({ url, connectTimeout }).pipe(
        Effect.provide(Reactivity.layer),
      );
      const notifications = yield* client.listen(SYNC_CHANNEL);
      return Stream.map(Stream.fromQueue(notifications), (notification) => notification.payload);
    }),
  });
