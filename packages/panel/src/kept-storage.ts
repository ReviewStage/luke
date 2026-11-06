import { Option, Schema } from "effect";

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

export function readKeptText(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readKept<A>(
  key: string,
  schema: Schema.Codec<A, string>,
  fallback: A,
  earlier?: string,
): A {
  return Option.getOrElse(readKeptOption(key, schema, earlier), () => fallback);
}

export function writeKept<A>(key: string, schema: Schema.Codec<A, string>, value: A): boolean {
  try {
    window.localStorage.setItem(key, Schema.encodeSync(schema)(value));
    return true;
  } catch {
    return false;
  }
}

export function forgetKept(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {}
}
