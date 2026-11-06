import { LIVE_POLL_URL, type SealedLiveQueryWire } from "@repo/features/live-wire";
import { Deferred, Effect } from "effect";

export function polledLive<
  Part extends string,
  Refused extends { readonly failure: string } = never,
>(parts: readonly Part[], derive?: () => Partial<Record<Part, readonly unknown[]>>) {
  let version = 0;
  const rows = new Map<Part, readonly unknown[]>();
  let woken: readonly string[] | undefined;
  let moved = Deferred.makeUnsafe<void>();
  let refusal: Refused | undefined;
  let polls = 0;
  let held = 0;
  const wake = () => {
    Deferred.doneUnsafe(moved, Effect.void);
    moved = Deferred.makeUnsafe<void>();
  };
  const answer = () => ({
    url: LIVE_POLL_URL,
    queries: Object.fromEntries(
      parts.map((part) => {
        const carried = rows.get(part) ?? derive?.()[part];
        const query: SealedLiveQueryWire = {
          capability: LIVE_POLL_URL,
          queryFingerprint: LIVE_POLL_URL,
          expiresAt: 0,
          digest: String(version),
          ...(carried === undefined ? undefined : { rows: carried }),
          ...(woken === undefined ? undefined : { txids: woken }),
        };
        return [part, query];
      }),
    ) as Record<Part, SealedLiveQueryWire>,
  });
  const standing = (after: string) => after.split(",").every((each) => each === String(version));
  const poll = (after: string | undefined): Effect.Effect<ReturnType<typeof answer> | Refused> =>
    Effect.suspend(() => {
      if (refusal !== undefined) return Effect.succeed(refusal);
      if (after === undefined || !standing(after)) return Effect.succeed(answer());
      const waiting = moved;
      held += 1;
      return Deferred.await(waiting).pipe(
        Effect.ensuring(Effect.sync(() => (held -= 1))),
        Effect.andThen(poll(after)),
      );
    });
  return {
    first: (): ReturnType<typeof answer> | Refused => refusal ?? answer(),
    poll: (after: string | undefined) =>
      Effect.andThen(
        Effect.sync(() => {
          polls += 1;
        }),
        poll(after),
      ),
    set: (next: Partial<Record<Part, readonly unknown[]>>, txids?: readonly string[]) => {
      for (const part of parts) {
        const carried = next[part];
        if (carried !== undefined) rows.set(part, carried);
      }
      woken = txids;
      version += 1;
      wake();
    },
    move: () => {
      rows.clear();
      woken = undefined;
      version += 1;
      wake();
    },
    refuse: (next: Refused | undefined) => {
      refusal = next;
      wake();
    },
    polls: () => polls,
    held: () => held,
  };
}

export type PolledLive<
  Part extends string,
  Refused extends { readonly failure: string } = never,
> = ReturnType<typeof polledLive<Part, Refused>>;
