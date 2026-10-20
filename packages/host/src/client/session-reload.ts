/**
 * session-reload.ts -- a page left with a full page load once the session it was loaded for changes, as Neon's guide says a page with live reads leaves ("When the session changes").
 *
 * A browser tab can outlive its session: the developer signs out in another
 * tab, or another tab signs in as someone else, and this tab still holds the
 * first account's Realtime client and rows. A full page load drops them, and
 * the page then loads for whoever the session names now, or for nobody.
 */
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { Effect, type Scope, Stream } from "effect";
import type { AppStateStore } from "./app-state-store.js";

export interface SessionReloadDependencies {
  /** The document whose account is watched. */
  state: Pick<AppStateStore, "changes">;
  /** A full page load: the tab's `location.reload()`. */
  reload: () => void;
}

/**
 * Loads the page again, once, the first time the account it settled on
 * signs out or becomes another, for the client's scope. Note that a sign-in
 * from signed out is no change of a held account, so the page's own first
 * settling, and a sign-in, load nothing.
 */
export const linkSessionReload = /* @__PURE__ */ Effect.fn("client/linkSessionReload")(function* (
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
