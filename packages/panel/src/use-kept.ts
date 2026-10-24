import type { Schema } from "effect";
import { useCallback, useState } from "react";
import { readKept, writeKept } from "./kept-storage.js";

/**
 * use-kept.ts -- a view choice this window remembers across launches (a fold, a filter, a sort, where a list stood scrolled), read and written through one hook.
 *
 * A view choice is this window's alone, so it is kept in the renderer's own
 * storage (`kept-storage.ts`) rather than on the account. Each is declared
 * once as a `KeptKey` (`keptKey`), beside the surface that keeps it, in an
 * `as const` set of its keys: the name it is kept under and the Schema its
 * value reads and writes through, so the value `useKept` answers is the
 * type the key was declared with. A key is one fixed name, never one put
 * together from an id: a choice kept for each task, or each group, is one
 * value kept under one key, a record or a list by that id.
 */

/** Where a view choice is kept, and how its value reads and writes there. */
export interface KeptKey<A> {
  /** The name it is kept under in the window's storage. */
  readonly name: string;
  readonly schema: Schema.Codec<A, string>;
  /** The name an earlier build kept it under, read where `name` holds none (`readKept`). */
  readonly earlier?: string | undefined;
}

/** A view choice's key: kept under `name`, its value read and written through `schema`. */
export function keptKey<A>(
  name: string,
  schema: Schema.Codec<A, string>,
  earlier?: string,
): KeptKey<A> {
  return earlier === undefined ? { name, schema } : { name, schema, earlier };
}

/**
 * The choice kept under `key`, or `initial` where none was kept, it no
 * longer reads, or storage refuses the read; and the door that chooses
 * another and keeps it. Note that it is read once, as the surface is first
 * drawn, so a surface drawn again after it went opens at the choice it
 * last kept; and that the door is the same door across draws, so a row
 * handed it draws again only when the choice does.
 */
export function useKept<A>(key: KeptKey<A>, initial: A): readonly [A, (next: A) => void] {
  const [value, setValue] = useState<A>(() => readKept(key.name, key.schema, initial, key.earlier));
  const choose = useCallback(
    (next: A) => {
      setValue(next);
      writeKept(key.name, key.schema, next);
    },
    [key],
  );
  return [value, choose];
}
