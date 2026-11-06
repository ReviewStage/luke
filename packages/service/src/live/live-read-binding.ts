/**
 * live-read-binding.ts -- a declared live read (`@repo/features/live-read`) bound to the statements that answer it: the tables they read, the topics that wake it, who it admits, and what its answer carries beside them.
 *
 * A read is declared once in features, which can name no table, and bound
 * once here, in its own file under `reads/`, which holds its statements and
 * its binding and nothing else. A binding is a live read Sync wakes
 * (`defineLiveQuery`) beside its declaration, so the registry
 * (`../sync/live-queries.ts`) holds it as it holds every other definition,
 * and one handler answers every bound read (`answerBoundRead`,
 * `live-procedures.ts`): the caller admitted, the params bound, the parts
 * sealed, and the fields beside them read.
 *
 * Each part's statement is built through `liveRowsStatement`, whose
 * selection compiles only where its columns are the part's declared row on
 * its encoded side: the same keys, each column's type assignable to its
 * field's, and null on both or neither. Its order is the part's own,
 * appended to the statement as the declaration names it, so the rows a poll
 * answers stand as the reader orders the ones it holds.
 */

import {
  type LiveSelect,
  type LiveSelection,
  type LiveStatement,
  liveSelection,
  liveStatementOf,
} from "@repo/database/core/live-statement";
import type { SyncTable } from "@repo/database/sync/sync-table";
import {
  type AnyLiveRead,
  type AnyLiveRows,
  LIVE_PARAM,
  type LiveReadParams,
  ORDER,
} from "@repo/features/live-read";
import { asc, desc, type SQL, type SQLWrapper } from "drizzle-orm";
import { Duration, type Effect, Option, type Schema } from "effect";
import type { HostedRefusal } from "../http/http-effect.js";
import type { WebServices } from "../runtime.js";
import {
  defineLiveQuery,
  type LiveQuery,
  type LiveReadName,
  type LiveTopics,
} from "../sync/live-query.js";

/** How often a held poll looks at a read a surface watches closely, such as a Mac's commands or an agent's browser tabs. */
export const WATCHED_LOOK = Duration.seconds(1);

/** A selection's columns: each a column or a typed expression, under the key its row names it by. */
type LiveColumns = Readonly<Record<string, SQLWrapper>>;

/** No instants. */
type NoInstants = Readonly<Record<never, SQLWrapper>>;

/** What a selection's rows answer, by key. */
type SelectedRow<Columns, Instants> = {
  readonly [Key in keyof LiveSelection<Columns, Instants>]: LiveSelection<
    Columns,
    Instants
  >[Key] extends SQL.Aliased<infer Value>
    ? Value
    : never;
};

/** Whether a selected value may stand for a declared field: its type assignable to the field's, and null on both or neither. */
type Agrees<Selected, Declared> = [Selected] extends [Declared]
  ? (null extends Selected ? true : false) extends (null extends Declared ? true : false)
    ? true
    : false
  : false;

/** The keys where a selection and a declared row disagree: one only either names, or one whose value does not agree. */
type Disagreeing<Selected, Declared> = {
  readonly [Key in keyof Selected | keyof Declared]-?: Key extends keyof Selected
    ? Key extends keyof Declared
      ? Agrees<Selected[Key], Declared[Key]> extends true
        ? never
        : Key
      : Key
    : Key;
}[keyof Selected | keyof Declared];

/** Nothing where a selection is its part's row; otherwise a field the selection cannot satisfy, naming the keys that disagree. */
type RowTie<Part extends AnyLiveRows, Columns, Instants> = [
  Disagreeing<SelectedRow<Columns, Instants>, Part["row"]["Encoded"]>,
] extends [never]
  ? unknown
  : {
      readonly "the selection disagrees with its declared row at": Disagreeing<
        SelectedRow<Columns, Instants>,
        Part["row"]["Encoded"]
      >;
    };

/** A select built so far, which takes its order last. */
interface Orderable {
  orderBy(...columns: SQL[]): LiveSelect;
}

/** A part's columns: those selected as they are, and its instants as epoch milliseconds. */
interface LivePartColumns<Columns extends LiveColumns, Instants extends LiveColumns> {
  readonly columns: Columns;
  readonly instants?: Instants;
}

/**
 * One part's statement: its columns selected under its row's keys
 * (`liveSelection`), the select `build` makes of them, and the part's
 * declared order after it; none where it names a value a live statement
 * cannot bind. It compiles only where the columns are the part's row.
 */
export function liveRowsStatement<
  Part extends AnyLiveRows,
  const Columns extends LiveColumns,
  const Instants extends LiveColumns = NoInstants,
>(
  part: Part,
  selected: LivePartColumns<Columns, Instants> & RowTie<Part, Columns, Instants>,
  build: (selection: LiveSelection<Columns, Instants>) => Orderable,
): Option.Option<LiveStatement> {
  const instants: LiveColumns = selected.instants ?? {};
  const columns: LiveColumns = selected.columns;
  const order = part.order.map(([field, way]) => {
    const column = columns[field] ?? instants[field];
    if (column === undefined)
      throw new Error(`a live read orders by ${field}, which it does not select`);
    return way === ORDER.ASC ? asc(column) : desc(column);
  });
  return liveStatementOf(
    build(liveSelection(selected.columns, selected.instants)).orderBy(...order),
  );
}

/** What a bound read's answer carries beside its statements. */
type BesideOf<Read extends AnyLiveRead> = Schema.Struct<Read["beside"]>["Type"];

/** What a bound read's handler is handed of the request: the request itself, and the params it bound. */
interface LiveReadRequest<Read extends AnyLiveRead> {
  readonly request: Request;
  readonly params: LiveReadParams<Read>;
}

/** The params a bound read's service binds itself (`LIVE_PARAM.SERVED`), each as text. */
type ServedParams<Read extends AnyLiveRead> = Readonly<{
  [Key in keyof Read["params"] & string as Read["params"][Key] extends typeof LIVE_PARAM.SERVED
    ? Key
    : never]: string;
}>;

/** How the service answers a bound read beside its statements: who it admits, the params it binds itself, how often a held poll looks, and the fields beside its rows. */
interface LiveReadAnswering<Read extends AnyLiveRead> {
  /** Whether the caller, already the account the read names, may read it; refused otherwise. */
  admit?(params: LiveReadParams<Read>): Effect.Effect<void, HostedRefusal, WebServices>;
  /** The params it binds itself, given those its query bound; required where it declares one. */
  serve?(
    params: Omit<LiveReadParams<Read>, keyof ServedParams<Read>>,
  ): Effect.Effect<ServedParams<Read>, HostedRefusal, WebServices>;
  /** How often a held poll looks at it; every three seconds where it names none, every second for a read a surface watches closely (`WATCHED_LOOK`). */
  readonly look?: Duration.Duration;
  /** What the answer carries beside its statements. */
  beside?(asked: LiveReadRequest<Read>): Effect.Effect<BesideOf<Read>, HostedRefusal, WebServices>;
}

/** How a declared read is answered by the service. */
export interface LiveReadBinding<Read extends AnyLiveRead> extends LiveReadAnswering<Read> {
  /** The synced tables its statements read. */
  readonly reads: readonly SyncTable[];
  /** The topics a write to its rows notifies, for the params bound, or how to look them up. */
  topics(params: LiveReadParams<Read>): LiveTopics;
  /** Each part's statement, for the params bound (`liveRowsStatement`). */
  statements(params: LiveReadParams<Read>): {
    readonly [Part in keyof Read["parts"]]: Option.Option<LiveStatement>;
  };
}

/** A declared read bound: the live read Sync wakes, beside its declaration and how its caller is admitted and its answer completed. */
export interface BoundLiveRead<Read extends AnyLiveRead = AnyLiveRead>
  extends LiveQuery<keyof Read["params"] & string, keyof Read["parts"] & string>,
    LiveReadAnswering<Read> {
  readonly declaration: Read;
}

/** Any bound read, as the registry holds it beside the definitions. */
export interface AnyBoundRead extends LiveQuery {
  readonly declaration: AnyLiveRead;
}

/**
 * Binds a declared read to the statements that answer it, as a live read
 * Sync wakes under the declaration's name, params, and mode. Fails as
 * `defineLiveQuery` does.
 */
export function bindLiveRead<Read extends AnyLiveRead & { readonly name: LiveReadName }>(
  read: Read,
  binding: LiveReadBinding<Read>,
): BoundLiveRead<Read> {
  type Param = keyof Read["params"] & string;
  type Part = keyof Read["parts"] & string;
  // SAFETY: a declaration's params are its keys, each bound as text.
  const params = Object.keys(read.params) as Param[];
  const query = defineLiveQuery<Param, Part, LiveTopics>({
    name: read.name,
    params,
    reads: binding.reads,
    topics: (bound) => binding.topics(bound),
    statements: (bound) =>
      // SAFETY: every part's statement is built, under the part's own name.
      Option.all(binding.statements(bound)) as Option.Option<Readonly<Record<Part, LiveStatement>>>,
    mode: read.mode,
  });
  const served = Object.values(read.params).includes(LIVE_PARAM.SERVED);
  if (served && binding.serve === undefined)
    throw new Error(`the live read ${read.name} serves a param it binds nowhere`);
  return {
    ...query,
    declaration: read,
    ...(binding.admit === undefined ? undefined : { admit: binding.admit }),
    ...(binding.serve === undefined ? undefined : { serve: binding.serve }),
    ...(binding.look === undefined ? undefined : { look: binding.look }),
    ...(binding.beside === undefined ? undefined : { beside: binding.beside }),
  };
}
