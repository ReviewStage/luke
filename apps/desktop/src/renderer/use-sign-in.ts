import type { AccountProvider } from "@sidecar/credentials/snapshot";
import { useCallback, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "./act";
import { PANEL_PRESENTATION } from "./panel-state";
import type { PanelEntrySurface } from "./use-panel-entry";
import { useStateWithRef } from "./use-state-with-ref";

interface UseSignInOptions {
  surface: Pick<PanelEntrySurface, "presentation" | "applyPresentation" | "cancelHover">;
  /** Brings the panel forward around what a landed sign-in just unlocked. */
  expand: () => void;
}

export interface SignIn {
  signInWait: AccountProvider | undefined;
  signInWaitNow: () => AccountProvider | undefined;
  signInFailure: string | undefined;
  beginSignIn: (provider: AccountProvider) => void;
  cancelSignIn: () => void;
}

/**
 * The account sign-in the gate begins, and the slot it waits in. Choosing a
 * provider on the gate sends the browser to it and stands the panel down to
 * a small waiting popup: the real work is in the browser, and Luke floats
 * above the page it needs.
 */
export function useSignIn(options: UseSignInOptions): SignIn {
  const { act, tell } = useAct();
  const { surface, expand } = options;
  const { presentation: presentationOf, applyPresentation, cancelHover } = surface;

  /**
   * Whose sign-in the surface is waiting on. Held as app state with a ref
   * because the attempt's own reply has to read whether it is still the one
   * being waited on.
   */
  const [signInWait, setSignInWait, signInWaitNow] = useStateWithRef<AccountProvider | undefined>(
    undefined,
  );
  /**
   * Which attempt any reply answers. Cancel advances it, so the outcome of a
   * sign-in already withdrawn is spent rather than moving the shape again.
   */
  const signInAttempt = useRef(0);
  const [signInFailure, setSignInFailure] = useState<string>();

  const beginSignIn = useCallback(
    (provider: AccountProvider) => {
      if (signInWaitNow() !== undefined) return;
      const attempt = ++signInAttempt.current;
      setSignInFailure(undefined);
      setSignInWait(provider);
      cancelHover();
      applyPresentation(PANEL_PRESENTATION.SLOT);
      act(ACT_KIND.ACCOUNT_BEGIN_SIGN_IN, { provider }).then(
        () => {
          if (signInAttempt.current !== attempt) return;
          setSignInWait(undefined);
          if (presentationOf() !== PANEL_PRESENTATION.SLOT) return;
          // The panel comes forward around what was just unlocked — the
          // plans — and stays open like any other opened panel: signing in
          // is an arrival, not an errand to settle and leave.
          expand();
        },
        () => {
          if (signInAttempt.current !== attempt) return;
          setSignInWait(undefined);
          setSignInFailure("Sign-in did not finish. Try again when you’re ready.");
          if (presentationOf() === PANEL_PRESENTATION.SLOT) expand();
        },
      );
    },
    [applyPresentation, cancelHover, expand, presentationOf, setSignInWait, signInWaitNow],
  );

  /**
   * Takes the wait back. The main process withdraws the loopback and signs the
   * attempt back out; the panel returns to the gate at once rather than
   * waiting for that round trip, and the attempt's eventual rejection finds
   * itself already spent.
   */
  const cancelSignIn = useCallback(() => {
    if (signInWaitNow() === undefined) return;
    signInAttempt.current += 1;
    setSignInWait(undefined);
    tell(ACT_KIND.ACCOUNT_CANCEL_SIGN_IN);
    if (presentationOf() === PANEL_PRESENTATION.SLOT) expand();
  }, [expand, presentationOf, setSignInWait, signInWaitNow]);

  return { signInWait, signInWaitNow, signInFailure, beginSignIn, cancelSignIn };
}
