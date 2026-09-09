import { ACT_KIND } from "#shared/messages/acts";
import type { ActRows } from "../act-router";
import type { HostOperator } from "../gateway/host-operator";

/**
 * The account rows, proxied to the host that owns the account: the sign-in
 * flow, the refresh, the sign-out, and the deletion all run there, and the
 * counts of them are recorded there, ahead of the action they count. What stays
 * here is what only the client can do about them — stopping the recording
 * its renderers run before the account they file under is gone.
 */
export interface AccountSessionDependencies {
  host: Pick<HostOperator, "beginSignIn" | "cancelSignIn" | "signOut" | "deleteAccount">;
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

type AccountActKind =
  | typeof ACT_KIND.ACCOUNT_BEGIN_SIGN_IN
  | typeof ACT_KIND.ACCOUNT_CANCEL_SIGN_IN
  | typeof ACT_KIND.ACCOUNT_SIGN_OUT
  | typeof ACT_KIND.ACCOUNT_DELETE;

export function accountActRows(
  dependencies: AccountSessionDependencies,
): Pick<ActRows, AccountActKind> {
  const { host, haltSessionReplay, resumeSessionReplay } = dependencies;
  return {
    [ACT_KIND.ACCOUNT_BEGIN_SIGN_IN]: ({ provider }) => host.beginSignIn(provider),
    [ACT_KIND.ACCOUNT_CANCEL_SIGN_IN]: () => host.cancelSignIn(),
    [ACT_KIND.ACCOUNT_SIGN_OUT]: async () => {
      haltSessionReplay();
      try {
        return await host.signOut();
      } catch (error) {
        resumeSessionReplay();
        throw error;
      }
    },
    [ACT_KIND.ACCOUNT_DELETE]: async () => {
      haltSessionReplay();
      try {
        // A deletion that landed stands recording down for the run; the
        // host says so on its replay event, which follows this answer.
        return await host.deleteAccount();
      } catch (error) {
        resumeSessionReplay();
        throw error;
      }
    },
  };
}
