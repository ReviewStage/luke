/**
 * live-read.ts -- a live read declared once: its name, its path, its params, its mode, each part's rows and their order, and what its answer carries beside them.
 *
 * Every tier reads a live read from its declaration (`liveRead`), so none
 * restates its shape: the contract's procedure (`liveProcedure`), the input
 * its query is read with, the answer the service seals (`answer`), the rows
 * each part delivers (`rows`), the order those rows stand in
 * (`orderedLiveRows`), and the client's ask (`askLiveRead`,
 * `hosted-call.ts`). The service binds a declaration to its statements
 * (`packages/service/src/live/live-read-binding.ts`), whose selection must
 * match each part's row and whose order is the part's own.
 *
 * A param is the reader's account (`LIVE_PARAM.USER`), which the service
 * admits only for the session's own and binds from it, a text the query
 * names (`LIVE_PARAM.TEXT`), read as text so one of no shape is answered as
 * not found rather than refused, or may leave out (`LIVE_PARAM.OPTIONAL_TEXT`),
 * bound as empty then, or a value the service binds itself and no query
 * names (`LIVE_PARAM.SERVED`), such as an instant read from its clock. The mode adds the fields a reader polls
 * with (`LIVE_POLL`): every read takes `poll` and `after`, and a cursor read
 * `cursor` too.
 *
 * A part's rows are an Effect Schema struct, decoded on its encoded side as
 * Postgres answers them, so a field the build does not know is read
 * leniently where the row says so. Their order is a list of fields, each
 * ascending or descending, nulls last ascending and first descending as
 * Postgres orders them.
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema } from "effect";
import { ANY_PROCEDURE_REFUSALS, declaredProcedure, refuses } from "./contract/base.js";
import type { HOSTED_ERRORS } from "./contract/errors.js";
import { LIVE_POLL, sealedLiveQuerySchema } from "./live-wire.js";
import type { HOSTED_SERVICE_PATH } from "./service-paths.js";

/** How a live read answers a wake: run again and answered whole where its rows moved, or its cursor parts answered past the reader's cursor. */
export const LIVE_MODE = { SNAPSHOT: "snapshot", CURSOR: "cursor" } as const;

export type LiveMode = (typeof LIVE_MODE)[keyof typeof LIVE_MODE];

/** Which way a part's rows stand by one of their fields. */
export const ORDER = { ASC: "asc", DESC: "desc" } as const;

type Order = (typeof ORDER)[keyof typeof ORDER];

/** What a live read's param is bound to: the reader's own account, a text its query names or may leave out, or a value the service binds itself. */
export const LIVE_PARAM = {
  USER: "user",
  TEXT: "text",
  OPTIONAL_TEXT: "optionalText",
  SERVED: "served",
} as const;

type LiveParam = (typeof LIVE_PARAM)[keyof typeof LIVE_PARAM];

/** A param's field in the read's query: the account as text the service checks, or the text the reader names or may leave out. A served param has none. */
const PARAM_FIELD = {
  [LIVE_PARAM.USER]: Schema.optionalKey(Schema.String),
  [LIVE_PARAM.TEXT]: Schema.String,
  [LIVE_PARAM.OPTIONAL_TEXT]: Schema.optionalKey(Schema.String),
} as const;

/** A param the read's query names. */
type AskedParam = Exclude<LiveParam, typeof LIVE_PARAM.SERVED>;

/** The fields a reader polls with, by the read's mode (`LIVE_POLL`). */
const MODE_FIELDS = {
  [LIVE_MODE.SNAPSHOT]: {
    [LIVE_POLL.QUERY]: Schema.optionalKey(Schema.Literal(LIVE_POLL.ON)),
    [LIVE_POLL.AFTER]: Schema.optionalKey(Schema.String),
  },
  [LIVE_MODE.CURSOR]: {
    [LIVE_POLL.QUERY]: Schema.optionalKey(Schema.Literal(LIVE_POLL.ON)),
    [LIVE_POLL.AFTER]: Schema.optionalKey(Schema.String),
    [LIVE_POLL.CURSOR]: Schema.optionalKey(Schema.String),
  },
} as const;

/** A path the hosted service answers at. */
type HostedServicePath = (typeof HOSTED_SERVICE_PATH)[keyof typeof HOSTED_SERVICE_PATH];

/** One field of a row and which way the rows stand by it. */
type LiveOrderBy<Row extends Schema.Top> = readonly [keyof Row["Encoded"] & string, Order];

/** One part's rows: their schema, a struct read on the encoded side Postgres answers, the field that keys each, and the order they stand in. */
export interface LiveRows<Row extends Schema.Top> {
  readonly row: Row;
  readonly key: keyof Row["Encoded"] & string;
  readonly order: readonly LiveOrderBy<Row>[];
}

/** Any part's rows, whatever their fields. */
export interface AnyLiveRows {
  readonly row: Schema.Top;
  readonly key: string;
  readonly order: readonly (readonly [string, Order])[];
}

/** A read's parts, by name. */
type LiveParts = Readonly<Record<string, AnyLiveRows>>;

/** A read's params, by the key its query and its statements name each under. */
type LiveParams = Readonly<Record<string, LiveParam>>;

/** The read's query: its params' fields and its mode's. */
type InputFields<Params extends LiveParams, Mode extends LiveMode> = {
  readonly [Key in keyof Params as Params[Key] extends AskedParam
    ? Key
    : never]: (typeof PARAM_FIELD)[Params[Key] & AskedParam];
} & (typeof MODE_FIELDS)[Mode];

/** The read's answer: the address it was sealed at, each part's sealed statement, and the fields beside them. */
type AnswerFields<Parts extends LiveParts, Beside extends Schema.Struct.Fields> = {
  readonly url: Schema.String;
  readonly queries: Schema.Struct<{ readonly [Part in keyof Parts]: typeof sealedLiveQuerySchema }>;
} & Beside;

/** Each part's rows as its statement delivers them. */
type RowsFields<Parts extends LiveParts> = {
  readonly [Part in keyof Parts]: Schema.$Array<Parts[Part]["row"]>;
};

/** The refusals any procedure may answer, as the one map declares them. */
type AnyRefusals = Pick<typeof HOSTED_ERRORS, (typeof ANY_PROCEDURE_REFUSALS)[number]>;

/** A read as its declaration names it. */
interface LiveReadSpec<
  Name extends string,
  Params extends LiveParams,
  Mode extends LiveMode,
  Parts extends LiveParts,
  Beside extends Schema.Struct.Fields,
  Refuses extends Partial<typeof HOSTED_ERRORS>,
> {
  /** The read's key in the live contract and in app state (`LIVE_READ`). */
  readonly name: Name;
  readonly path: HostedServicePath;
  readonly params: Params;
  readonly mode: Mode;
  readonly parts: Parts;
  /** The fields the answer carries beside its statements, which no statement can, such as one read from the request. */
  readonly beside?: Beside;
  /** The refusals the read answers beyond those any procedure may (`refuses`). */
  readonly refuses?: Refuses;
}

/** A declared live read: what it names, and the schemas derived from it. */
export interface LiveReadDeclaration<
  Name extends string = string,
  Params extends LiveParams = LiveParams,
  Mode extends LiveMode = LiveMode,
  Parts extends LiveParts = LiveParts,
  Beside extends Schema.Struct.Fields = Schema.Struct.Fields,
  Refuses extends Partial<typeof HOSTED_ERRORS> = Partial<typeof HOSTED_ERRORS>,
> {
  readonly name: Name;
  readonly path: HostedServicePath;
  readonly params: Params;
  readonly mode: Mode;
  readonly parts: Parts;
  readonly beside: Beside;
  /** Every refusal the read's procedure declares: any procedure's and its own. */
  readonly errors: AnyRefusals & Refuses;
  /** The query the read is asked with. */
  readonly input: Schema.Struct<InputFields<Params, Mode>>;
  /** The answer the service seals. */
  readonly answer: Schema.Struct<AnswerFields<Parts, Beside>>;
  /** Each part's rows, as a poll delivers them inline and Realtime delivers them. */
  readonly rows: Schema.Struct<RowsFields<Parts>>;
}

/** Any declared live read, whatever it names. */
export interface AnyLiveRead {
  readonly name: string;
  readonly path: HostedServicePath;
  readonly params: LiveParams;
  readonly mode: LiveMode;
  readonly parts: LiveParts;
  readonly beside: Schema.Struct.Fields;
  readonly errors: Partial<typeof HOSTED_ERRORS>;
  readonly input: Schema.Top;
  readonly answer: Schema.Top;
  readonly rows: Schema.Top;
}

/** The params a read's statements are bound to, each as text. */
export type LiveReadParams<Read extends AnyLiveRead> = Readonly<
  Record<keyof Read["params"] & string, string>
>;

/** The params a read's query may leave out. */
type OptionalParam = typeof LIVE_PARAM.OPTIONAL_TEXT;

/** The params a reader asks a read with, each as text: every one but those the service binds itself, and those its query may leave out left out where it does. */
export type LiveReadAsked<Read extends AnyLiveRead> = Readonly<
  {
    [Key in keyof Read["params"] & string as Read["params"][Key] extends
      | typeof LIVE_PARAM.SERVED
      | OptionalParam
      ? never
      : Key]: string;
  } & {
    [Key in keyof Read["params"] & string as Read["params"][Key] extends OptionalParam
      ? Key
      : never]?: string;
  }
>;

/** A read's answer as the service hands it and the client reads it. */
export type LiveReadAnswer<Read extends AnyLiveRead> = Read["answer"]["Type"];

/** A read's query as the client asks it. */
export type LiveReadInput<Read extends AnyLiveRead> = Read["input"]["Type"];

/** One part's rows, as they stand in order. */
export type LiveRowOf<Part extends AnyLiveRows> = Part["row"]["Type"];

/** Each entry of a record mapped, its keys kept. */
function mapped<Key extends string, From, To>(
  record: Readonly<Record<Key, From>>,
  map: (value: From) => To,
): Record<Key, To> {
  // SAFETY: every key of `record` is written once, and no other.
  return Object.fromEntries(
    Object.entries<From>(record).map(([key, value]) => [key, map(value)]),
  ) as Record<Key, To>;
}

/** One part's rows declared: their schema, their key, and their order. */
export function liveRows<Row extends Schema.Top>(rows: LiveRows<Row>): LiveRows<Row> {
  return rows;
}

/**
 * Declares a live read, deriving its query, its answer, and its rows from
 * what it names. Fails where a part names no order, since its rows would
 * stand as Postgres happens to read them.
 */
export function liveRead<
  const Name extends string,
  const Params extends LiveParams,
  const Mode extends LiveMode,
  const Parts extends LiveParts,
  const Beside extends Schema.Struct.Fields = Readonly<Record<never, never>>,
  const Refuses extends Partial<typeof HOSTED_ERRORS> = Readonly<Record<never, never>>,
>(
  spec: LiveReadSpec<Name, Params, Mode, Parts, Beside, Refuses>,
): LiveReadDeclaration<Name, Params, Mode, Parts, Beside, Refuses> {
  for (const [part, rows] of Object.entries<AnyLiveRows>(spec.parts)) {
    if (rows.order.length === 0)
      throw new Error(`the live read ${spec.name}'s ${part} names no order`);
  }
  // SAFETY: an absent `beside` and `refuses` are the empty records their defaults name.
  const beside = (spec.beside ?? {}) as Beside;
  const own = (spec.refuses ?? {}) as Refuses;
  const params = Object.fromEntries(
    Object.entries<LiveParam>(spec.params).flatMap(([key, param]) =>
      param === LIVE_PARAM.SERVED ? [] : [[key, PARAM_FIELD[param]]],
    ),
  );
  const queries = mapped(spec.parts, () => sealedLiveQuerySchema);
  return {
    name: spec.name,
    path: spec.path,
    params: spec.params,
    mode: spec.mode,
    parts: spec.parts,
    beside,
    errors: { ...refuses(...ANY_PROCEDURE_REFUSALS), ...own },
    // SAFETY: the fields are those `InputFields`, `AnswerFields`, and `RowsFields` name, built from the same records.
    input: Schema.Struct({ ...params, ...MODE_FIELDS[spec.mode] }) as unknown as Schema.Struct<
      InputFields<Params, Mode>
    >,
    answer: Schema.Struct({
      url: Schema.String,
      queries: Schema.Struct(queries),
      ...beside,
    }) as unknown as Schema.Struct<AnswerFields<Parts, Beside>>,
    rows: Schema.Struct(
      mapped<string, AnyLiveRows, Schema.Top>(spec.parts, (rows) => Schema.Array(rows.row)),
    ) as unknown as Schema.Struct<RowsFields<Parts>>,
  };
}

/**
 * The read's procedure in the live contract: a GET at its path, its query
 * the declared params and the mode's poll fields, its output its answer
 * flipped (`packages/service/src/orpc/base.ts`), and the refusals it names.
 */
export function liveProcedure<Read extends AnyLiveRead>(read: Read) {
  return (
    declaredProcedure
      .errors(read.errors as Read["errors"])
      .meta(openapi({ method: HTTP_METHOD.GET, path: read.path }))
      // SAFETY: a query's fields decode with no services, so it is the codec from its `Encoded` to its `Type`.
      .input(read.input as unknown as Schema.Codec<Read["input"]["Type"], Read["input"]["Encoded"]>)
      .output(
        // SAFETY: an answer's fields decode with no services, so its flip is the codec from its `Type` to its `Encoded`.
        Schema.flip(read.answer) as unknown as Schema.Codec<
          Read["answer"]["Encoded"],
          Read["answer"]["Type"]
        >,
      )
  );
}

/** Two rows' order by one field: nulls last ascending, first descending, as Postgres orders them. */
function comparedBy(a: unknown, b: unknown, order: Order): number {
  if (a === b) return 0;
  const before = order === ORDER.ASC ? -1 : 1;
  if (a === null) return -before;
  if (b === null) return before;
  // SAFETY: a row's ordered fields are text or numbers, which compare as Postgres's C collation does.
  return (a as string) < (b as string) ? before : -before;
}

/** A part's rows in the order its statement reads them, whatever order they were held in. */
export function orderedLiveRows<Part extends AnyLiveRows>(
  part: Part,
  rows: readonly LiveRowOf<Part>[],
): readonly LiveRowOf<Part>[] {
  return rows.toSorted((a, b) => {
    // SAFETY: a part's row is a struct, whose ordered fields its declaration names.
    const left = a as Readonly<Record<string, unknown>>;
    const right = b as Readonly<Record<string, unknown>>;
    for (const [field, order] of part.order) {
      const compared = comparedBy(left[field], right[field], order);
      if (compared !== 0) return compared;
    }
    return 0;
  });
}
