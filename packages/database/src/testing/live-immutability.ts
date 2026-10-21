import { Effect, Predicate } from "effect";
import { SqlClient } from "effect/sql";
import type { SqlError } from "effect/sql/SqlError";

/**
 * live-immutability.ts -- the functions a live statement calls that Postgres does not mark immutable, which Neon Realtime refuses.
 *
 * Realtime refuses a statement that calls any function, operator, or
 * aggregate whose `provolatile` is not `i` ("unsupported query: scalar
 * expression uses a mutable function"), while plain Postgres and PGlite run
 * the same statement without a word. So the statement is made a view, its
 * placeholders written as literals, and what the view's rule calls is read
 * from the rule's own tree in `pg_rewrite`: every function, aggregate, and
 * window function it names, and the function behind every operator, each
 * with its volatility, its subqueries included. Note that `pg_depend` would
 * not do, since Postgres records no dependency on a built-in, which every
 * function Realtime could refuse is.
 *
 * A cast through a type's text form (`CoerceViaIO`, such as
 * `max(at)::text` or `text::timestamptz`) names no function in the tree, so
 * each is read from the tree itself: the input function of the type it casts
 * to, and the output function of the type it casts from, where the node it
 * casts says its type, a scalar subquery's by its one column. A cast from
 * a type the tree does not say is answered as one, since its output function
 * cannot be read. A literal cast (`'-infinity'::timestamptz`) is folded to a
 * constant first and calls nothing.
 */

/** A statement as Realtime takes it: SQL with `$n` placeholders, and their values in order. */
export interface ImmutabilityProbe {
  readonly sql: string;
  readonly params: readonly (string | number | boolean | null)[];
}

/** The view a probe is made, for as long as it is read. */
const PROBE_VIEW = "luke_live_immutability_probe";

/** The field each node a cast may read from says its type in, at its own depth. */
const TYPE_FIELD = new Map([
  ["VAR", "vartype"],
  ["CONST", "consttype"],
  ["PARAM", "paramtype"],
  ["FUNCEXPR", "funcresulttype"],
  ["OPEXPR", "opresulttype"],
  ["AGGREF", "aggtype"],
  ["WINDOWFUNC", "wintype"],
  ["COERCEVIAIO", "resulttype"],
  ["RELABELTYPE", "resulttype"],
  ["CASE", "casetype"],
  ["COALESCEEXPR", "coalescetype"],
  ["MINMAXEXPR", "minmaxtype"],
]);

/** What a statement's casts through text read: the types cast to, the types cast from, and how many casts' source type the tree does not say. */
interface TextCasts {
  readonly to: readonly number[];
  readonly from: readonly number[];
  readonly unread: number;
}

/** The node starting at `start`, a `{`, through its matching `}`. */
function nodeAt(tree: string, start: number): string {
  let depth = 0;
  for (let at = start; at < tree.length; at++) {
    if (tree[at] === "{") depth++;
    if (tree[at] === "}") depth--;
    if (depth === 0) return tree.slice(start, at + 1);
  }
  return tree.slice(start);
}

/** A node with every node nested in it left out, so a field read is its own. */
function ownFields(node: string): string {
  let depth = 0;
  let own = "";
  for (const character of node) {
    if (character === "{") depth++;
    if (depth <= 1) own += character;
    if (character === "}") depth--;
  }
  return own;
}

/** The type a node says it answers, where it says one; a scalar subquery's is its one column's. */
function typeOf(node: string): number | undefined {
  const name = /^\{(\w+)/.exec(node)?.[1];
  if (name === "SUBLINK") {
    const column = node.indexOf("{TARGETENTRY :expr ");
    const expression = column === -1 ? -1 : node.indexOf("{", column + 1);
    return expression === -1 ? undefined : typeOf(nodeAt(node, expression));
  }
  const field = name === undefined ? undefined : TYPE_FIELD.get(name);
  if (field === undefined) return undefined;
  const read = new RegExp(`:${field} (\\d+)`).exec(ownFields(node))?.[1];
  return read === undefined ? undefined : Number(read);
}

/** Every cast through text in a rule's tree. */
function textCastsOf(tree: string): TextCasts {
  const to: number[] = [];
  const from: number[] = [];
  let unread = 0;
  for (
    let at = tree.indexOf("{COERCEVIAIO");
    at !== -1;
    at = tree.indexOf("{COERCEVIAIO", at + 1)
  ) {
    const cast = nodeAt(tree, at);
    const target = typeOf(cast);
    if (target !== undefined) to.push(target);
    const argument = cast.indexOf("{", cast.indexOf(":arg "));
    const source = argument === -1 ? undefined : typeOf(nodeAt(cast, argument));
    if (source === undefined) unread++;
    else from.push(source);
  }
  return { to, from, unread };
}

/** A value written as the literal it stands for: text left untyped, so Postgres types it from where it stands, as it types a placeholder. */
function literalOf(value: string | number | boolean | null): string {
  return Predicate.isString(value) ? `'${value.replaceAll("'", "''")}'` : String(value);
}

/** The statement with each placeholder written as its value; one naming no value is left for Postgres to refuse. */
function inlined(probe: ImmutabilityProbe): string {
  return probe.sql.replace(/\$(\d+)\b/g, (placeholder, position: string) => {
    const value = probe.params[Number(position) - 1];
    return value === undefined ? placeholder : literalOf(value);
  });
}

/**
 * Every function, aggregate, and operator's function the statement calls
 * that is not immutable, as `name(arguments) volatility`, sorted; empty
 * where Realtime would take the statement.
 */
export function mutableFunctionsOf(
  probe: ImmutabilityProbe,
): Effect.Effect<readonly string[], SqlError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql.unsafe(`create or replace temporary view ${PROBE_VIEW} as ${inlined(probe)}`);
    const rows = yield* sql.unsafe<{ readonly called: string }>(
      `with rule as (
         select ev_action::text as tree from pg_rewrite where ev_class = '${PROBE_VIEW}'::regclass
       ), called as (
         select called[2]::oid as proc
           from rule, regexp_matches(tree, ':(funcid|aggfnoid|winfnoid) (\\d+)', 'g') as called
         union
         select operator.oprcode::oid
           from rule, regexp_matches(tree, ':opno (\\d+)', 'g') as called
           join pg_operator as operator on operator.oid = called[1]::oid
       )
       select distinct p.oid::regprocedure::text || ' ' || p.provolatile::text as called
         from called join pg_proc as p on p.oid = called.proc
        where p.provolatile <> 'i'
        order by 1`,
    );
    const trees = yield* sql.unsafe<{ readonly tree: string }>(
      `select ev_action::text as tree from pg_rewrite where ev_class = '${PROBE_VIEW}'::regclass`,
    );
    const casts = textCastsOf(trees.map((row) => row.tree).join(""));
    const castsCall = yield* sql.unsafe<{ readonly called: string }>(
      `select distinct p.oid::regprocedure::text || ' ' || p.provolatile::text as called
         from pg_type as t join pg_proc as p
           on (t.oid = any('{${casts.to.join(",")}}'::oid[]) and p.oid = t.typinput::oid)
           or (t.oid = any('{${casts.from.join(",")}}'::oid[]) and p.oid = t.typoutput::oid)
        where p.provolatile <> 'i'
        order by 1`,
    );
    yield* sql.unsafe(`drop view ${PROBE_VIEW}`);
    const unread =
      casts.unread === 0 ? [] : ["a cast through text from a type the tree does not say"];
    return [...new Set([...rows, ...castsCall].map((row) => row.called))].toSorted().concat(unread);
  });
}
