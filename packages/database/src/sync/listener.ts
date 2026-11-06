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

const NOTIFY_STATEMENT = "select pg_notify($1, $2), pg_notification_queue_usage() as usage";

const queueUsageRowsSchema = Schema.Tuple([Schema.Struct({ usage: Schema.Number })]);

export interface SyncListening {
  readonly payloads: Stream.Stream<string, SqlError>;
  readonly notify: (payload: string) => Effect.Effect<number, SqlError | Schema.SchemaError>;
}

export interface SyncListenerShape {
  readonly listen: Effect.Effect<SyncListening, SqlError, Scope.Scope>;
}

export class SyncListener extends Context.Service<SyncListener, SyncListenerShape>()(
  "@repo/database/SyncListener",
) {}

export interface SyncListenerConnection {
  readonly url: Redacted.Redacted;
  readonly connectTimeout?: Duration.Input;
  readonly idleSessionTimeout?: Duration.Duration;
}

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
