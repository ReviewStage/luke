import { Option, Schema } from "effect";

/**
 * kept-storage.ts -- a value the window keeps in its own storage across launches, read through a Schema and written back through it.
 *
 * What only this window chooses (a fold, a width, a provider last signed in
 * with) is kept in the renderer's storage rather than on the account. Storage
 * may refuse a read or a write, and a kept value may no longer read as the
 * build that wrote it meant: either way the caller's default stands, and a
 * write that fails costs only the choice, so neither is worth a word.
 */

/**
 * A kept value, or none where none was kept, it no longer reads, or storage
 * refuses the read. Note that a value an earlier version kept under
 * `earlier` is read where `key` holds none that reads, because the key was
 * renamed and the developer's choice should not be forgotten for it; the
 * next write keeps it under `key`.
 */
export function readKeptOption<A>(
  key: string,
  schema: Schema.Codec<A, string>,
  earlier?: string,
): Option.Option<A> {
  try {
    const decode = Schema.decodeUnknownOption(schema);
    const kept = decode(window.localStorage.getItem(key));
    if (Option.isSome(kept) || earlier === undefined) return kept;
    return decode(window.localStorage.getItem(earlier));
  } catch {
    return Option.none();
  }
}

/** What storage holds under `key` as text, or none where nothing is held or storage refuses the read. */
export function readKeptText(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** A kept value, or `fallback` where none reads (`readKeptOption`). */
export function readKept<A>(
  key: string,
  schema: Schema.Codec<A, string>,
  fallback: A,
  earlier?: string,
): A {
  return Option.getOrElse(readKeptOption(key, schema, earlier), () => fallback);
}

/** Keeps a value and says whether it was kept; a write that fails leaves the one kept before. */
export function writeKept<A>(key: string, schema: Schema.Codec<A, string>, value: A): boolean {
  try {
    window.localStorage.setItem(key, Schema.encodeSync(schema)(value));
    return true;
  } catch {
    // The choice opens at what was kept before on the next launch.
    return false;
  }
}

/** Forgets a kept value, so the next read answers its default. */
export function forgetKept(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // The value kept stands until a write takes.
  }
}
