import { Schema, SchemaTransformation } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import { readKept, readKeptText, writeKept } from "./kept-storage.js";

export interface KeptKey<A> {
  readonly name: string;
  readonly schema: Schema.Codec<A, string>;
  readonly earlier?: string | undefined;
}

export function keptKey<A>(
  name: string,
  schema: Schema.Codec<A, string>,
  earlier?: string,
): KeptKey<A> {
  return earlier === undefined ? { name, schema } : { name, schema, earlier };
}

export const keptFlag = Schema.Literals(["true", "false"]).pipe(
  Schema.decodeTo(
    Schema.Boolean,
    SchemaTransformation.transform({
      decode: (kept) => kept === "true",
      encode: (flag) => (flag ? "true" : "false"),
    }),
  ),
);

const UNWRITTEN = new Map<string, string | null>();

const HOLDERS = new Map<string, Set<(kept: unknown) => void>>();

export function useKept<A>(
  key: KeptKey<A>,
  initial: A,
): readonly [A, (next: A) => void, (change: (kept: A) => A) => void] {
  const [value, setValue] = useState<A>(() => readKept(key.name, key.schema, initial, key.earlier));
  const drawn = useRef(value);
  useEffect(() => {
    const held = (next: unknown) => {
      const kept = next as A;
      drawn.current = kept;
      setValue(kept);
    };
    const holders = HOLDERS.get(key.name) ?? new Set();
    holders.add(held);
    HOLDERS.set(key.name, holders);
    return () => {
      holders.delete(held);
    };
  }, [key.name]);
  const choose = useCallback(
    (next: A) => {
      drawn.current = next;
      setValue(next);
      if (writeKept(key.name, key.schema, next)) UNWRITTEN.delete(key.name);
      else UNWRITTEN.set(key.name, readKeptText(key.name));
      for (const holder of HOLDERS.get(key.name) ?? []) holder(next);
    },
    [key],
  );
  const change = useCallback(
    (changed: (kept: A) => A) => {
      const refused = UNWRITTEN.has(key.name) && UNWRITTEN.get(key.name) === readKeptText(key.name);
      const was = refused
        ? drawn.current
        : readKept(key.name, key.schema, drawn.current, key.earlier);
      const next = changed(was);
      if (!Object.is(next, was)) choose(next);
    },
    [key, choose],
  );
  return [value, choose, change];
}
