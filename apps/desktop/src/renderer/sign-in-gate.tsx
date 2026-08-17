import { useState } from "react";
import {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  type AccountProvider,
  type AccountSnapshot,
} from "../shared/contracts";

export function SignInGate({
  account,
  onQuit,
}: {
  account: AccountSnapshot;
  onQuit: () => void;
}): React.JSX.Element {
  const [chosen, setChosen] = useState<AccountProvider>();
  const [failure, setFailure] = useState<string>();
  const pending = account.status === ACCOUNT_STATUS.SIGNING_IN || chosen !== undefined;

  const begin = async (provider: AccountProvider) => {
    if (pending) return;
    setChosen(provider);
    setFailure(undefined);
    try {
      await window.sidecar.beginSignIn(provider);
    } catch {
      setChosen(undefined);
      setFailure("Sign-in did not finish. Try again when you’re ready.");
    }
  };

  return (
    <section className="sign-in-gate" aria-labelledby="sign-in-title">
      <div className="sign-in-eyes" aria-hidden="true">
        <span />
        <span />
      </div>
      <h1 id="sign-in-title">Meet Luke</h1>
      <p>Sign in before Luke starts watching your coding agents.</p>
      <div className="sign-in-actions">
        <button
          type="button"
          disabled={pending}
          onClick={() => void begin(ACCOUNT_PROVIDER.GOOGLE)}
        >
          {chosen === ACCOUNT_PROVIDER.GOOGLE ? "Waiting for Google…" : "Continue with Google"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => void begin(ACCOUNT_PROVIDER.GITHUB)}
        >
          {chosen === ACCOUNT_PROVIDER.GITHUB ? "Waiting for GitHub…" : "Continue with GitHub"}
        </button>
      </div>
      {failure ? <small className="sign-in-error">{failure}</small> : null}
      {pending ? <small>Finish signing in in your browser.</small> : null}
      <button type="button" className="quit-button sign-in-quit" onClick={onQuit}>
        Quit Luke
      </button>
    </section>
  );
}
