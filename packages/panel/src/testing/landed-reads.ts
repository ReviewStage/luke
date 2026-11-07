/**
 * landed-reads.ts -- the chunks a test file has landed (a side bundle, the markdown parser), seeded into every Query client its cases make, as a window that has loaded one holds it.
 *
 * A window loads each chunk once and every surface after has it at once. A
 * test file lands the chunks it draws over once, often in a `beforeAll`,
 * while each case draws on a Query client made afresh
 * (`copy-feedback.ts`). So a chunk read here is recorded by its query key,
 * and each client made after is seeded with every chunk recorded, with
 * `setQueryData`. The record is cleared as the file finishes, so no file
 * draws over a chunk another landed. A case that wants a chunk unloaded
 * says so through the bundles it hands (`side-bundles.ts`'s
 * `unlandedBundles`), never by the order its cases run in.
 */

import type { EnsureQueryDataOptions, QueryClient, QueryKey } from "@tanstack/react-query";
import { Effect } from "effect";
import { afterAll } from "vitest";

/** A chunk landed in this file: its query's key, and what the query answered. */
interface LandedRead {
  readonly queryKey: QueryKey;
  readonly data: unknown;
}

/** Each chunk landed in this file, the latest last. */
const landed: LandedRead[] = [];

afterAll(() => {
  landed.length = 0;
});

/** Reads `query` into `client` and records what it answered, so every client made after this has it at once; a failed read fails with its error. */
export function landRead<A, Key extends QueryKey>(
  client: QueryClient,
  query: EnsureQueryDataOptions<A, Error, A, Key>,
): Effect.Effect<A, Error> {
  return Effect.tryPromise({
    try: () => client.ensureQueryData(query),
    catch: (cause) =>
      cause instanceof Error ? cause : new Error("The chunk could not be had.", { cause }),
  }).pipe(
    Effect.tap((data) =>
      Effect.sync(() => {
        landed.push({ queryKey: query.queryKey, data });
      }),
    ),
  );
}

/** Seeds `client` with every chunk landed in this file. */
export function seedLanded(client: QueryClient): void {
  for (const read of landed) client.setQueryData(read.queryKey, read.data);
}
