import type { AccountSnapshot } from "@repo/credentials/snapshot";
import { Cause, Effect, Option } from "effect";
import { ACCOUNT_ACT_KIND, ACCOUNT_ACTS } from "../contract/index.js";
import type { HostActTable } from "../host-acts.js";
import type { HostOperator } from "../host-operator.js";
import { actPort } from "./base.js";
import { declaredAnswer } from "./declared-acts.js";

/**
 * account-procedures.ts -- the sign-out and the deletion, answered by hand around their declared handlers.
 *
 * Both run on the host that owns the account, and the counts of them are
 * recorded there, ahead of the action they count; every other account ask
 * is relayed as declared (`contract/account.ts`). What stays here is what
 * only the client can do about these two: asking before a sign-out loses
 * something, and stopping the recording its renderers run before the
 * account they file under is gone.
 */
export interface AccountProceduresDependencies {
  host: Pick<HostOperator, "accountSnapshot">;
  /** The sign-out's and the deletion's handlers, which these procedures answer around. */
  acts: Pick<HostActTable, "ACCOUNT_SIGN_OUT" | "ACCOUNT_DELETE">;
  /**
   * Asks before a sign-out while something would be lost, unsaved work,
   * answering whether to sign out. A shell that asks nothing
   * first, a browser tab, leaves this out.
   */
  askBeforeSignOut?: () => Promise<boolean>;
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
  const { host, acts, haltSessionReplay, resumeSessionReplay, askBeforeSignOut } = dependencies;
  /** The halt, the host's answer, and the resume an answer that never came owes. */
  const halted = (
    action: Effect.Effect<AccountSnapshot, unknown>,
  ): Effect.Effect<AccountSnapshot, unknown> =>
    Effect.suspend(() => {
      haltSessionReplay();
      return Effect.tapCause(action, (cause) =>
        Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.sync(resumeSessionReplay),
      );
    });

  return {
    // A sign-out the developer canceled answers the account as it still
    // stands and stops nothing; where none stands, nobody is signed in and
    // the sign-out loses nothing.
    [ACCOUNT_ACT_KIND.ACCOUNT_SIGN_OUT]: actPort[ACCOUNT_ACT_KIND.ACCOUNT_SIGN_OUT].effect(
      function* ({ input }) {
        if (askBeforeSignOut !== undefined && !(yield* Effect.promise(askBeforeSignOut))) {
          const standing = yield* host.accountSnapshot();
          if (Option.isSome(standing)) return standing.value;
        }
        return yield* halted(
          declaredAnswer(ACCOUNT_ACTS.ACCOUNT_SIGN_OUT, acts.ACCOUNT_SIGN_OUT, input),
        );
      },
    ),
    // A deletion that landed stands recording down for the run; the host says
    // so on its replay event, which follows this answer.
    [ACCOUNT_ACT_KIND.ACCOUNT_DELETE]: actPort[ACCOUNT_ACT_KIND.ACCOUNT_DELETE].effect(function* ({
      input,
    }) {
      return yield* halted(declaredAnswer(ACCOUNT_ACTS.ACCOUNT_DELETE, acts.ACCOUNT_DELETE, input));
    }),
  };
}
