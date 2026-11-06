import type { AccountProvider } from "@repo/credentials/snapshot";
import { SIGN_IN_FAILURE, type SignInFailure } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { useStateWithRef } from "@repo/ui/use-state-with-ref";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { actMutation, pressMutation } from "./act-mutations.js";
import { appPlatform } from "./app-platform.js";

export interface SignIn {
  signInWait: AccountProvider | undefined;
  signInFailure: SignInFailure | undefined;
  beginSignIn: (provider: AccountProvider) => void;
  cancelSignIn: () => void;
}

export function useSignIn(): SignIn {
  const { mutateAsync: beginAccountSignIn } = useMutation(
    actMutation(ACT_KIND.ACCOUNT_BEGIN_SIGN_IN),
  );
  const { mutate: cancelAccountSignIn } = useMutation(
    pressMutation(ACT_KIND.ACCOUNT_CANCEL_SIGN_IN),
  );

  const [signInWait, setSignInWait, signInWaitNow] = useStateWithRef<AccountProvider | undefined>(
    undefined,
  );
  const signInAttempt = useRef(0);
  const [signInFailure, setSignInFailure] = useState<SignInFailure>();

  const beginSignIn = useCallback(
    (provider: AccountProvider) => {
      if (signInWaitNow() !== undefined) return;
      const attempt = ++signInAttempt.current;
      setSignInFailure(undefined);
      setSignInWait(provider);
      beginAccountSignIn({ provider }).then(
        (answer) => {
          if (signInAttempt.current !== attempt) return;
          setSignInWait(undefined);
          if ("failure" in answer) setSignInFailure(answer.failure);
          appPlatform().focusPanel();
        },
        () => {
          if (signInAttempt.current !== attempt) return;
          setSignInWait(undefined);
          setSignInFailure(SIGN_IN_FAILURE.UNFINISHED);
          appPlatform().focusPanel();
        },
      );
    },
    [setSignInWait, signInWaitNow, beginAccountSignIn],
  );

  const cancelSignIn = useCallback(() => {
    if (signInWaitNow() === undefined) return;
    signInAttempt.current += 1;
    setSignInWait(undefined);
    cancelAccountSignIn();
  }, [setSignInWait, signInWaitNow, cancelAccountSignIn]);

  return { signInWait, signInFailure, beginSignIn, cancelSignIn };
}
