import type { AccountProvider } from "@sidecar/credentials/snapshot";
import { useCallback, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "./act";
import { useStateWithRef } from "./use-state-with-ref";

export interface SignIn {
  signInWait: AccountProvider | undefined;
  signInFailure: string | undefined;
  beginSignIn: (provider: AccountProvider) => void;
  cancelSignIn: () => void;
}

/**
 * The account sign-in the gate begins and waits on. Choosing a provider sends
 * the browser to it and the gate waits in place, the pressed button saying
 * so; the window comes back forward when the browser hands the answer back,
 * signed in or not.
 */
export function useSignIn(): SignIn {
  const { act, tell } = useAct();

  /**
   * Whose sign-in the gate is waiting on. Held as app state with a ref
   * because the attempt's own reply has to read whether it is still the one
   * being waited on.
   */
  const [signInWait, setSignInWait, signInWaitNow] = useStateWithRef<AccountProvider | undefined>(
    undefined,
  );
  /**
   * Which attempt any reply answers. Cancel advances it, so the outcome of a
   * sign-in already withdrawn is spent rather than reported.
   */
  const signInAttempt = useRef(0);
  const [signInFailure, setSignInFailure] = useState<string>();

  const beginSignIn = useCallback(
    (provider: AccountProvider) => {
      if (signInWaitNow() !== undefined) return;
      const attempt = ++signInAttempt.current;
      setSignInFailure(undefined);
      setSignInWait(provider);
      act(ACT_KIND.ACCOUNT_BEGIN_SIGN_IN, { provider }).then(
        () => {
          if (signInAttempt.current !== attempt) return;
          setSignInWait(undefined);
          // The browser has the focus the sign-in finished in, and signing in
          // is an arrival at the plans it just unlocked.
          tell(ACT_KIND.WINDOW_FOCUS_PANEL);
        },
        () => {
          if (signInAttempt.current !== attempt) return;
          setSignInWait(undefined);
          setSignInFailure("Sign-in did not finish. Try again when you’re ready.");
          tell(ACT_KIND.WINDOW_FOCUS_PANEL);
        },
      );
    },
    [setSignInWait, signInWaitNow],
  );

  /**
   * Takes the wait back. The main process withdraws the loopback and signs the
   * attempt back out; the gate is offered again at once rather than after
   * that round trip, and the attempt's eventual rejection finds itself
   * already spent.
   */
  const cancelSignIn = useCallback(() => {
    if (signInWaitNow() === undefined) return;
    signInAttempt.current += 1;
    setSignInWait(undefined);
    tell(ACT_KIND.ACCOUNT_CANCEL_SIGN_IN);
  }, [setSignInWait, signInWaitNow]);

  return { signInWait, signInFailure, beginSignIn, cancelSignIn };
}
