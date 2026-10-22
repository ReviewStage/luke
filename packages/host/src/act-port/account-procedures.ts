import type { AccountSnapshot } from "@luke/credentials/snapshot";
import { Effect } from "effect";
import { ACCOUNT_ACT_KIND } from "../contract/index.js";
import type { HostOperator } from "../host-operator.js";
import { actPort } from "./base.js";

/**
 * account-procedures.ts -- the account's asks, proxied to the host that owns the account.
 *
 * The sign-in flow, the refresh, the sign-out, and the deletion all run
 * there, and the counts of them are recorded there, ahead of the action they
 * count. What stays here is what only the client can do about them —
 * stopping the recording its renderers run before the account they file
 * under is gone.
 */
export interface AccountProceduresDependencies {
  host: Pick<
    HostOperator,
    "beginSignIn" | "signInAgain" | "cancelSignIn" | "signOut" | "deleteAccount"
  >;
  /**
   * Stops recording before either action runs. Neither can wait for its own
   * account transition to be relayed: a sign-out reports itself before the
   * store clears, and a deletion awaits the hosted erasure first — so a
   * recording still running is one filed under a person who has left, or one
   * whose erasure is already queued, which it would recreate.
   */
  haltSessionReplay: () => void;
  /**
   * Re-answers what recording may do, for an action that did not happen. A halt
   * ahead of a refused sign-out or a failed deletion is one the account
   * transition never follows, so without this the panel stays halted while the
   * user is still signed in.
   */
  resumeSessionReplay: () => void;
}

export function accountProcedures(dependencies: AccountProceduresDependencies) {
  const { host, haltSessionReplay, resumeSessionReplay } = dependencies;
  /** The halt, the host's answer, and the resume an answer that never came owes. */
  const halted = (action: Effect.Effect<AccountSnapshot>): Effect.Effect<AccountSnapshot> =>
    Effect.suspend(() => {
      haltSessionReplay();
      return Effect.tapDefect(action, () => Effect.sync(resumeSessionReplay));
    });

  return {
    [ACCOUNT_ACT_KIND.ACCOUNT_BEGIN_SIGN_IN]: actPort[
      ACCOUNT_ACT_KIND.ACCOUNT_BEGIN_SIGN_IN
    ].effect(function* ({ input }) {
      return yield* host.beginSignIn(input.provider);
    }),
    [ACCOUNT_ACT_KIND.ACCOUNT_SIGN_IN_AGAIN]: actPort[
      ACCOUNT_ACT_KIND.ACCOUNT_SIGN_IN_AGAIN
    ].effect(function* ({ input }) {
      return yield* host.signInAgain(input.provider);
    }),
    [ACCOUNT_ACT_KIND.ACCOUNT_CANCEL_SIGN_IN]: actPort[
      ACCOUNT_ACT_KIND.ACCOUNT_CANCEL_SIGN_IN
    ].effect(function* () {
      yield* host.cancelSignIn();
    }),
    [ACCOUNT_ACT_KIND.ACCOUNT_SIGN_OUT]: actPort[ACCOUNT_ACT_KIND.ACCOUNT_SIGN_OUT].effect(
      function* () {
        return yield* halted(host.signOut());
      },
    ),
    // A deletion that landed stands recording down for the run; the host says
    // so on its replay event, which follows this answer.
    [ACCOUNT_ACT_KIND.ACCOUNT_DELETE]: actPort[ACCOUNT_ACT_KIND.ACCOUNT_DELETE].effect(
      function* () {
        return yield* halted(host.deleteAccount());
      },
    ),
  };
}
