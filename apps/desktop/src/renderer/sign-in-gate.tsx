import type { AccountSnapshot } from "@luke/credentials/snapshot";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS, type AccountProvider } from "@luke/credentials/snapshot";
import { ProviderMark, WingFace } from "@luke/ui";
import { useId } from "react";
import { SpinnerRing } from "./spinner";

/**
 * A provider's button, which says so while it is the sign-in being waited on.
 * The one marked last used wears the badge on its top-right corner, a sibling
 * hung over the button rather than a word inside it, so the button is still
 * named by its label alone and the badge describes it.
 */
function ProviderButton({
  provider,
  name,
  primary,
  lastUsed,
  waiting,
  disabled,
  onBegin,
}: {
  provider: AccountProvider;
  name: string;
  /** The filled one of the two. */
  primary: boolean;
  /** The way in this Mac took last. */
  lastUsed: boolean;
  waiting: boolean;
  disabled: boolean;
  onBegin: (provider: AccountProvider) => void;
}): React.JSX.Element {
  const badge = useId();
  return (
    <div className="sign-in-provider-slot">
      <button
        type="button"
        className="sign-in-provider"
        data-provider={provider}
        data-primary={String(primary)}
        data-waiting={String(waiting)}
        disabled={disabled}
        aria-describedby={lastUsed ? badge : undefined}
        onClick={() => onBegin(provider)}
      >
        {waiting ? (
          <span className="sign-in-provider-wait">
            <SpinnerRing />
          </span>
        ) : (
          <ProviderMark provider={provider} />
        )}
        {waiting ? "Waiting for browser…" : `Continue with ${name}`}
      </button>
      {lastUsed ? (
        <span id={badge} className="sign-in-last-used">
          Last used
        </span>
      ) : null}
    </div>
  );
}

/**
 * The sign-in, alone in the window: Luke's resting face over the two ways in.
 * A press sends the browser to the provider and the gate waits in place —
 * the pressed button says so, the other stands disabled, and Cancel takes the
 * wait back — because the browser holds the actual work and there is nothing
 * else here to do meanwhile. The way in this Mac took last is the filled one
 * and says so; with none kept, Google is. The two never trade places, so the
 * hand that knows where GitHub is still finds it there.
 */
export function SignInGate({
  account,
  waiting,
  failure,
  lastUsed,
  onBegin,
  onCancel,
}: {
  account: AccountSnapshot;
  /** Whose sign-in the gate is waiting on; absent while none was begun here. */
  waiting?: AccountProvider;
  /** Why the last attempt ended without landing, from the flow's owner. */
  failure?: string;
  /** The provider this Mac last signed in with; absent while none is kept. */
  lastUsed?: AccountProvider;
  /** Sends the browser to the provider; the gate then waits on it. */
  onBegin: (provider: AccountProvider) => void;
  onCancel: () => void;
}): React.JSX.Element {
  // A sign-in begun from no press of this gate still holds both buttons.
  const busy = waiting !== undefined || account.status === ACCOUNT_STATUS.SIGNING_IN;
  const primary = lastUsed ?? ACCOUNT_PROVIDER.GOOGLE;
  return (
    <section className="sign-in-gate" aria-labelledby="sign-in-title" aria-busy={busy}>
      <span className="sign-in-face" aria-hidden="true">
        <WingFace />
      </span>
      <h1 id="sign-in-title">Welcome to Luke</h1>
      <div className="sign-in-actions">
        <ProviderButton
          provider={ACCOUNT_PROVIDER.GOOGLE}
          name="Google"
          primary={primary === ACCOUNT_PROVIDER.GOOGLE}
          lastUsed={lastUsed === ACCOUNT_PROVIDER.GOOGLE}
          waiting={waiting === ACCOUNT_PROVIDER.GOOGLE}
          disabled={busy}
          onBegin={onBegin}
        />
        <ProviderButton
          provider={ACCOUNT_PROVIDER.GITHUB}
          name="GitHub"
          primary={primary === ACCOUNT_PROVIDER.GITHUB}
          lastUsed={lastUsed === ACCOUNT_PROVIDER.GITHUB}
          waiting={waiting === ACCOUNT_PROVIDER.GITHUB}
          disabled={busy}
          onBegin={onBegin}
        />
      </div>
      {/* The line under the buttons is held open whether or not it says
          anything, so beginning a wait does not move the column. */}
      <div className="sign-in-note">
        {waiting ? (
          <p role="status">
            Finish in your browser.{" "}
            <button type="button" className="sign-in-cancel" onClick={onCancel}>
              Cancel
            </button>
          </p>
        ) : failure ? (
          <p className="sign-in-error" role="alert">
            {failure}
          </p>
        ) : null}
      </div>
    </section>
  );
}
