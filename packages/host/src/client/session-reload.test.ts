import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { Effect } from "effect";
import { runModeFor } from "../run-mode.js";
import { AppStateStore, initialAppState } from "./app-state-store.js";
import { linkSessionReload } from "./session-reload.js";

/**
 * A browser tab loads again once the session it settled on changes: a
 * sign-out, or another account's sign-in, each once; its own first settling
 * and a sign-in from signed out load nothing.
 *
 * Accounts are synthetic.
 */

const RUN = {
  launch: { profile: "idle", captureMode: false, fixtureMode: false },
  runMode: runModeFor({ capture: false, fixture: false }),
  appVersion: "1.2.3",
  packaged: true,
  platform: "web",
} as const;

const signedIn = (id: string) =>
  ({
    status: ACCOUNT_STATUS.SIGNED_IN,
    id,
    email: `${id}@luke.test`,
    provider: ACCOUNT_PROVIDER.GITHUB,
  }) as const;

/** Every step the watch has to take, taken. */
const settled = Effect.repeat(Effect.yieldNow, { times: 20 });

function linked() {
  return Effect.gen(function* () {
    let reloads = 0;
    const state = new AppStateStore(initialAppState(RUN, false, []), yield* Effect.context());
    yield* linkSessionReload({
      state,
      reload: () => {
        reloads += 1;
      },
    });
    yield* settled;
    return { state, reloads: () => reloads };
  });
}

it.effect("a tab settling, then signing in, loads nothing; a sign-out loads it again", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const tab = yield* linked();
      tab.state.update({ account: signedIn("user-dana") });
      yield* settled;
      assert.equal(tab.reloads(), 0);
      tab.state.update({ account: { status: ACCOUNT_STATUS.SIGNED_OUT } });
      yield* settled;
      assert.equal(tab.reloads(), 1);
    }),
  ),
);

it.effect("another account signed in under the same cookie loads the tab again, once", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const tab = yield* linked();
      tab.state.update({ account: signedIn("user-dana") });
      yield* settled;
      tab.state.update({ account: signedIn("user-eli") });
      yield* settled;
      tab.state.update({ account: signedIn("user-dana") });
      yield* settled;
      assert.equal(tab.reloads(), 1);
    }),
  ),
);
