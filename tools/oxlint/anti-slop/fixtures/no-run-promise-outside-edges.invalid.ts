import { Effect } from "effect";

export function greeting(name: string): Promise<string> {
  return Effect.runPromise(Effect.sync(() => `hello ${name}`));
}
