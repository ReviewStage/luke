/**
 * listener.ts -- `LISTEN` on Luke Sync's channel, over a connection of the listener's own.
 *
 * A pooler can't hold a `LISTEN`, since the session it would be registered
 * on is handed to another client after each transaction, and the pooled
 * client's connections are the requests' own (the store tests' Postgres pool
 * holds one), so a listen opens a single connection to the unpooled URL it is
 * handed and holds it for as long as its scope stands. What arrives is handed
 * on as the payload's text: `SyncNotificationSchema` reads it, and what to do
 * with one that does not decode is the reader's to decide. A listen also
 * notifies over its own connection, so the reader can prove the connection
 * with a round trip that is a statement of the listening session itself:
 * where the session is given an idle timeout, a listener that keeps proving
 * it keeps it, and one whose process stopped is closed by Postgres. The
 * store's tests listen on their PGlite instead (`@luke/database/testing`).
 */
import { PgConnection } from "@effect/sql-pg";
import {
  Context,
  Duration,
  Effect,
  Layer,
  type Redacted,
  Schema,
  type Scope,
  Stream,
} from "effect";
import type { SqlError } from "effect/sql/SqlError";
import { SYNC_CHANNEL } from "./notification.js";

/** Notifies the channel (`$1`) with the payload (`$2`), reading the share of the notification queue in use in the same statement. */
const NOTIFY_STATEMENT = "select pg_notify($1, $2), pg_notification_queue_usage() as usage";

const queueUsageRowsSchema = Schema.Tuple([Schema.Struct({ usage: Schema.Number })]);

/** One standing listen: what its connection hears, and a notification sent over that same connection. */
export interface SyncListening {
  /**
   * Every payload from the `LISTEN` on, in commit order, failing with the
   * connection's error once the connection is lost.
   */
  readonly payloads: Stream.Stream<string, SqlError>;
  /**
   * Notifies the channel with the payload on the listening connection
   * itself, answering the share of the notification queue in use.
   */
  readonly notify: (payload: string) => Effect.Effect<number, SqlError | Schema.SchemaError>;
}

export interface SyncListenerShape {
  /**
   * Listens on `luke_sync`, answering once Postgres has acknowledged the
   * `LISTEN`, so a write committed after it is answered is heard; closing
   * the scope ends the listen and its connection.
   */
  readonly listen: Effect.Effect<SyncListening, SqlError, Scope.Scope>;
}

export class SyncListener extends Context.Service<SyncListener, SyncListenerShape>()(
  "@luke/database/SyncListener",
) {}

export interface SyncListenerConnection {
  /** The database's unpooled URL. */
  readonly url: Redacted.Redacted;
  /** How long a connection may take to open, on the caller's clock; `@effect/sql-pg`'s default where left out. */
  readonly connectTimeout?: Duration.Input;
  /** How long Postgres keeps the session while it runs no statement (`idle_session_timeout`); Postgres's own setting where left out. */
  readonly idleSessionTimeout?: Duration.Duration;
}

/** Sends the notification with the statement runner of the listening connection, answering the queue's usage. */
export const syncNotifyOver =
  (
    query: (
      statement: string,
      params: readonly unknown[],
    ) => Effect.Effect<readonly unknown[], SqlError>,
  ) =>
  (payload: string) =>
    Effect.flatMap(query(NOTIFY_STATEMENT, [SYNC_CHANNEL, payload]), (rows) =>
      Effect.map(Schema.decodeUnknownEffect(queueUsageRowsSchema)(rows), ([row]) => row.usage),
    );

/**
 * A listener opening a connection of its own to the URL for each listen.
 * Note that the session is pinned for the whole listen, and the `LISTEN`
 * and every notification run on the pinned view, because a listen pins the
 * session itself and a statement through the session's other door would
 * wait behind it for as long as the listen stands.
 */
export const syncListenerOverUrl = ({
  url,
  connectTimeout,
  idleSessionTimeout,
}: SyncListenerConnection): Layer.Layer<SyncListener> =>
  Layer.succeed(SyncListener, {
    listen: Effect.gen(function* () {
      const connection = yield* PgConnection.make({ url, connectTimeout });
      const session = yield* connection.pin;
      if (idleSessionTimeout !== undefined) {
        yield* session.query("select set_config('idle_session_timeout', $1, false)", [
          `${Duration.toMillis(idleSessionTimeout)}ms`,
        ]);
      }
      const notifications = yield* session.listen(SYNC_CHANNEL);
      return {
        payloads: Stream.map(
          Stream.fromQueue(notifications),
          (notification) => notification.payload,
        ),
        notify: syncNotifyOver((statement, params) =>
          Effect.map(session.query(statement, params), (result) => result.rows),
        ),
      };
    }),
  });
