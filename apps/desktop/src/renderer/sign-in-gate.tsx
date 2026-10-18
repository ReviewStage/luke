import type { AccountSnapshot } from "@luke/credentials/snapshot";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS, type AccountProvider } from "@luke/credentials/snapshot";
import {
  PROVIDER_BUTTON_SIZE,
  ProviderButton,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  WingFace,
} from "@luke/ui";

/** Each way in, in the order the gate stands them, with the name it says. */
const WAYS_IN = [
  { provider: ACCOUNT_PROVIDER.GOOGLE, name: "Google" },
  { provider: ACCOUNT_PROVIDER.GITHUB, name: "GitHub" },
] as const;

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
      <Text variant={TEXT_VARIANT.TITLE} as={TEXT_ELEMENT.H1} id="sign-in-title">
        Welcome to Luke
      </Text>
      <div className="sign-in-actions">
        {WAYS_IN.map(({ provider, name }) => (
          <ProviderButton
            key={provider}
            provider={provider}
            name={name}
            size={PROVIDER_BUTTON_SIZE.GATE}
            primary={primary === provider}
            lastUsed={lastUsed === provider}
            pending={waiting === provider}
            pendingLabel="Waiting for browser…"
            disabled={busy}
            onPress={() => onBegin(provider)}
          />
        ))}
      </div>
      {/* The line under the buttons is held open whether or not it says
          anything, so beginning a wait does not move the column. */}
      <div className="sign-in-note">
        {waiting ? (
          <div role="status">
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              Finish in your browser.{" "}
              <button type="button" className="sign-in-cancel" onClick={onCancel}>
                Cancel
              </button>
            </Text>
          </div>
        ) : failure ? (
          <p className="sign-in-error" role="alert">
            {failure}
          </p>
        ) : null}
      </div>
    </section>
  );
}
