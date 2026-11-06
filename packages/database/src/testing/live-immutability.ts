import { Effect, Predicate } from "effect";
import { SqlClient } from "effect/sql";
import type { SqlError } from "effect/sql/SqlError";

export interface ImmutabilityProbe {
  readonly sql: string;
  readonly params: readonly (string | number | boolean | null)[];
}

const PROBE_VIEW = "luke_live_immutability_probe";

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

interface TextCasts {
  readonly to: readonly number[];
  readonly from: readonly number[];
  readonly unread: number;
}

function nodeAt(tree: string, start: number): string {
  let depth = 0;
  for (let at = start; at < tree.length; at++) {
    if (tree[at] === "{") depth++;
    if (tree[at] === "}") depth--;
    if (depth === 0) return tree.slice(start, at + 1);
  }
  return tree.slice(start);
}

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

function literalOf(value: string | number | boolean | null): string {
  return Predicate.isString(value) ? `'${value.replaceAll("'", "''")}'` : String(value);
}

function inlined(probe: ImmutabilityProbe): string {
  return probe.sql.replace(/\$(\d+)\b/g, (placeholder, position: string) => {
    const value = probe.params[Number(position) - 1];
    return value === undefined ? placeholder : literalOf(value);
  });
}

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
