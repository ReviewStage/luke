import { AsyncLocalStorage } from "node:async_hooks";
import type { ColumnsSelection, DrizzleConfig, Relations } from "drizzle-orm";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { PgSelectBase, type PgTable } from "drizzle-orm/pg-core";
import { drizzle, type PgRemoteDatabase } from "drizzle-orm/pg-proxy";
import type { JoinNullability, SelectMode } from "drizzle-orm/query-builders/select.types";
import { QueryPromise } from "drizzle-orm/query-promise";
import { Cause, type Context, Effect, Effectable, Exit, MutableRef } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { isSqlError, SqlError, UnknownError } from "effect/unstable/sql/SqlError";

/**
 * The Drizzle query builder as an Effect, ported from `@effect/sql-drizzle`'s
 * `Pg` module and its `internal/patch`.
 *
 * The first-party bridge peers `effect ^3.22` and `@effect/sql`, and this
 * repository pins `effect 4.0.0-rc.115`, where `@effect/sql` is folded into
 * `effect/unstable/sql`; satisfying the peer would put a second copy of
 * `effect` in the tree, and a `Context.Service` minted in one copy is not the
 * same service in the other. So the mechanism is copied rather than depended
 * on. It is small and it is all here: Drizzle renders the statement, this
 * module runs it on the `SqlClient` the asking fiber already carries, and
 * Drizzle maps the rows back.
 *
 * Two things the port does not copy. It mints no service and builds no
 * layer: the handle below carries no capability, so making it one would add a
 * requirement to every query module for nothing, and this repository's
 * modules answer `Effect<A, SqlError | Schema.SchemaError, SqlClient>` and
 * keep answering it. And a query's client is read from the fiber's own
 * context at the moment it runs rather than captured when the handle is
 * built, which is what puts a bridged statement inside an enclosing
 * `sql.withTransaction`: that transaction's connection is a service of the
 * running fiber's context and of nothing else.
 */

/**
 * What the patch below is, said in types: every builder on one of the two
 * prototypes it mixes into is an Effect answering the rows it would have
 * settled as a promise, failing as a `SqlError`, and asking for the
 * `SqlClient` it reads out of the fiber running it. The first-party plugin
 * declares the same merge for `QueryPromise` alone and requires nothing,
 * because its client comes from a layer; here the requirement is the point.
 */
declare module "drizzle-orm/query-promise" {
  interface QueryPromise<T> extends Effect.Effect<T, SqlError, SqlClient.SqlClient> {}
}

declare module "drizzle-orm/pg-core/query-builders/select" {
  interface PgSelectBase<
    TTableName extends string | undefined,
    TSelection extends ColumnsSelection,
    TSelectMode extends SelectMode,
    TNullabilityMap extends Record<string, JoinNullability>,
    TDynamic extends boolean,
    TExcludedMethods extends string,
    TResult,
    TSelectedFields,
  > extends Effect.Effect<TResult, SqlError, SqlClient.SqlClient> {}
}

/**
 * The methods Drizzle's proxy drivers ask a remote callback for. The Postgres
 * proxy asks for two of them — `all` for a statement whose fields it maps
 * itself, `execute` for one it hands back whole — and the other two are what
 * a driver reached through `.get()` or `.values()` would ask for.
 */
export const DRIZZLE_METHOD = {
  ALL: "all",
  GET: "get",
  VALUES: "values",
  EXECUTE: "execute",
} as const;

type DrizzleMethod = (typeof DRIZZLE_METHOD)[keyof typeof DRIZZLE_METHOD];

/** What a bridged query calls itself where a fiber names the work it is running. */
const BRIDGE_LABEL = "DrizzleQuery";

/** What the proxy driver reads back from one call of the callback. */
interface BridgedRows {
  readonly rows: Array<unknown>;
}

/** A Drizzle builder as the bridge reads it: the promise its execution settles. */
interface DrizzleBuilder<TResult> {
  execute(...args: ReadonlyArray<never>): Promise<TResult>;
}

/** A Drizzle builder once patched, which is the Effect it has also become. */
type BridgedQuery = Effect.Effect<unknown, SqlError, SqlClient.SqlClient> & DrizzleBuilder<unknown>;

/**
 * What a schema module holds, which is what a handle below may be built over:
 * the tables statements are rendered against and the relations a relational
 * query walks. Drizzle states the same constraint as a record of anything at
 * all; naming the two things it can actually be costs nothing and says more.
 */
type DrizzleSchema = Record<string, PgTable | Relations>;

/**
 * How a caller is put back where the statement's own run left it: what
 * `AsyncLocalStorage.snapshot()` hands back, which is the one way to enter an
 * async context a callback did not itself create.
 */
type StandingAsyncContext = <A>(resume: () => A) => A;

/** Where a query whose statement has not run yet stands, which is where it already is. */
const whereItStands: StandingAsyncContext = (resume) => resume();

/**
 * One bridged query's passage through the proxy driver: the Effect context
 * the fiber that yielded it is running in, and the async context that query's
 * own run left standing, written back by the door below.
 *
 * Why the second half is here at all: a `SqlClient` statement is a wait for
 * the pool's connection, and Effect resumes whoever was waiting inside the
 * stack of whoever released it, so the async context a statement leaves its
 * caller in is the releasing caller's and not the asking caller's. That is
 * what a raw `sql` tagged template does to the fiber that yields it, and a
 * bridged statement has to do the same thing: the bridge renders the
 * statement and nothing else, and a statement converted onto it leaves its
 * caller exactly where the raw one would have. Without this the door's own
 * root fiber absorbs the handoff and the asking fiber resumes in the
 * context it registered its `then` in. Note that no authored file reads
 * eve's session container out of the context a statement leaves standing:
 * under two sessions in one process that context is the other session's,
 * so each pins its own where it is entered (`eve/pinned-state.ts`), and
 * what the bridge owes is parity with the raw statement and nothing more.
 */
interface StandingQuery {
  readonly context: Context.Context<SqlClient.SqlClient>;
  leftStanding: StandingAsyncContext;
}

/**
 * The query standing for exactly as long as its own `execute()` runs.
 *
 * A module-level cell is the only channel there is: `drizzle`'s remote
 * callback takes the rendered SQL and nothing else, so the asking fiber
 * cannot hand its context down the call it makes. It is sound because the
 * proxy driver calls the callback synchronously inside `execute()`, before
 * the first await either of them reaches, so the cell is read on the same
 * tick it was written on and no second query can be between them. It is a
 * `MutableRef` rather than a `let` because that is the fence: it is up before
 * the `execute()` on the next line, and down before the effect around it
 * yields. The record it holds outlives the fence, because the door writes
 * the context it left standing back into the one record its caller kept.
 */
const standingQuery = MutableRef.make<StandingQuery | undefined>(undefined);

/** A query that reached no client at all, which is a query awaited as the promise it also is. */
const AWAITED_OUTSIDE = "A Drizzle query was executed outside the Effect that yielded it";

/**
 * The failure a rejected bridged query stands for. Drizzle wraps whatever the
 * callback threw in a `DrizzleQueryError` carrying the statement's text, so
 * the `SqlError` this bridge already squashed out of the run is one layer
 * down; unwrapping it is what keeps a unique violation a unique violation
 * rather than one more unknown cause.
 */
function asSqlError(cause: unknown): SqlError {
  const failure = cause instanceof DrizzleQueryError ? cause.cause : cause;
  if (isSqlError(failure)) return failure;
  return new SqlError({
    reason: new UnknownError({ cause: failure, message: "Failed to execute a Drizzle query" }),
  });
}

/**
 * One statement of a bridged query, dispatched on the method the driver asked
 * for, and the dispatch as the Effect it is before the promise door below
 * turns it into the promise Drizzle awaits. Exported at that seam because the
 * Postgres proxy asks for two of the four methods and a test reaches the rest
 * here. `execute` is the driver's own result object rather than rows, which
 * the proxy reads back as a single header row. The other three are positional
 * rows, because mapping a row onto the selected fields is Drizzle's own work
 * and it does that from a row of values; `get` is the first of them.
 *
 * `get` is the one place the port does not copy the plugin, which reads it as
 * transformed objects and hands back the first of those. A proxy driver's
 * `get` is a row of values — the same thing `all` answers, one row of it —
 * and an object where the driver indexes positions is a row it cannot map.
 * No Postgres proxy call reaches `get` either way.
 */
export function bridgedRows(
  sql: string,
  params: ReadonlyArray<unknown>,
  method: DrizzleMethod,
): Effect.Effect<BridgedRows, SqlError, SqlClient.SqlClient> {
  return Effect.flatMap(Effect.service(SqlClient.SqlClient), (client) => {
    const statement = client.unsafe(sql, params);
    if (method === DRIZZLE_METHOD.EXECUTE) {
      return Effect.map(statement.raw, (header) => ({ rows: [header] }));
    }
    if (method === DRIZZLE_METHOD.GET) {
      return Effect.map(statement.values, (rows) => ({ rows: [...(rows[0] ?? [])] }));
    }
    return Effect.map(statement.values, (rows) => ({ rows: [...rows] }));
  });
}

/**
 * The promise door. The statement runs on the context the yielding fiber was
 * carrying, which is how it lands inside an enclosing `sql.withTransaction`,
 * and a failure leaves as `Cause.squash` of what the run ended with, so what
 * Drizzle catches and re-wraps is the `SqlError` itself rather than a fiber's
 * own representation of a cause.
 *
 * The snapshot is taken inside the run rather than after its promise, because
 * a `then` callback is restored to the async context it was registered in and
 * the context wanted is the one the statement's own completion left standing.
 * A finalizer is where that instant is: it runs in the fiber's own loop on
 * the tick the statement settled, before the exit reaches an observer, and it
 * runs whether the statement answered rows or refused.
 */
function throughStandingContext(
  rows: Effect.Effect<BridgedRows, SqlError, SqlClient.SqlClient>,
): Promise<BridgedRows> {
  const standing = MutableRef.get(standingQuery);
  // Guard: only the patched `evaluate` below puts a query up.
  if (standing === undefined) {
    return Promise.reject(
      new SqlError({
        reason: new UnknownError({ cause: new Error(AWAITED_OUTSIDE), message: AWAITED_OUTSIDE }),
      }),
    );
  }
  const leaving = Effect.ensuring(
    rows,
    Effect.sync(() => {
      standing.leftStanding = AsyncLocalStorage.snapshot();
    }),
  );
  return Effect.runPromiseExitWith(standing.context)(leaving).then((exit) =>
    Exit.isSuccess(exit) ? exit.value : Promise.reject(Cause.squash(exit.cause)),
  );
}

/**
 * The prototype the bridge mixes into Drizzle's builders. Yielding a builder
 * evaluates this: it reads the running fiber's context, stands it up for the
 * length of the builder's own `execute()`, and resumes the fiber that yielded
 * it where the statement's own run left off — in that run's async context,
 * which is where a raw `sql` tagged template on the same client would have
 * left it. `Effect.callback` rather than `Effect.tryPromise` for that one
 * reason: `resume` continues the asking fiber's loop on the stack it is
 * called from, so entering the standing context around it is what carries
 * that context into everything the fiber does next.
 */
const bridgePrototype = Effectable.Prototype<BridgedQuery>({
  label: BRIDGE_LABEL,
  evaluate() {
    return Effect.flatMap(Effect.context<SqlClient.SqlClient>(), (context) => {
      const standing: StandingQuery = { context, leftStanding: whereItStands };
      return Effect.callback<unknown, SqlError>((resume) => {
        // Note that the previous query is restored rather than cleared,
        // because a query built and executed from inside another query's
        // mapping would otherwise leave the outer one with none.
        const outer = MutableRef.get(standingQuery);
        MutableRef.set(standingQuery, standing);
        try {
          this.execute().then(
            (rows) => standing.leftStanding(() => resume(Effect.succeed(rows))),
            (cause) => standing.leftStanding(() => resume(Effect.fail(asSqlError(cause)))),
          );
        } catch (thrown) {
          // Guard: a builder that refuses to render throws where it stands.
          resume(Effect.fail(asSqlError(thrown)));
        } finally {
          MutableRef.set(standingQuery, outer);
        }
      });
    });
  },
});

/**
 * Mixes the prototype in, in place and once. `Object.defineProperties` rather
 * than `Object.assign` for the same reason `Effectable.Mixin` uses it: the
 * descriptors are copied as they stand rather than set through whatever the
 * target's own prototype chain answers for the name.
 */
function patch(prototype: DrizzleBuilder<unknown>): void {
  if (Effect.TypeId in prototype) return;
  Object.defineProperties(prototype, Object.getOwnPropertyDescriptors(bridgePrototype));
}

/** The remote callback Drizzle's proxy driver renders each statement into. */
function bridgedRemoteCallback(
  sql: string,
  params: ReadonlyArray<unknown>,
  method: DrizzleMethod,
): Promise<BridgedRows> {
  return throughStandingContext(bridgedRows(sql, params, method));
}

/**
 * A Drizzle handle over whichever `SqlClient` the fiber running a query
 * carries. One handle renders statements for every caller: it holds no
 * connection, no client, and no context of its own, so there is nothing in it
 * for two callers to contend over and nothing to build per request.
 */
export function drizzleOverSqlClient<TSchema extends DrizzleSchema>(
  config?: DrizzleConfig<TSchema>,
): PgRemoteDatabase<TSchema> {
  return drizzle(bridgedRemoteCallback, config);
}

// The two prototypes every Postgres builder settles through: `PgSelectBase`
// stands outside `QueryPromise`'s own chain, and every other builder —
// insert, update, delete, the relational queries, the raw ones — is on it.
// Patched as this module loads, which is before any caller of the handle
// above has built a query to patch.
patch(QueryPromise.prototype);
patch(PgSelectBase.prototype);
