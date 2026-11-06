import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { Effect, type Scope, Stream } from "effect";
import type { AppStateStore } from "./app-state-store.js";

export interface SessionReloadDependencies {
  state: Pick<AppStateStore, "changes">;
  reload: () => void;
}

export const linkSessionReload = Effect.fn("client/linkSessionReload")(function* (
  dependencies: SessionReloadDependencies,
): Effect.fn.Return<void, never, Scope.Scope> {
  let loadedFor: string | undefined;
  const left = Stream.filter(
    Stream.map(dependencies.state.changes, ({ account }) =>
      account.status === ACCOUNT_STATUS.SIGNED_IN ? account.id : undefined,
    ),
    (signedIn) => {
      if (loadedFor === undefined) {
        loadedFor = signedIn;
        return false;
      }
      return signedIn !== loadedFor;
    },
  );
  yield* Effect.forkScoped(
    Effect.flatMap(Stream.runHead(left), () => Effect.sync(dependencies.reload)),
  );
});
