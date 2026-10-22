import type { AccountSnapshot } from "@luke/credentials/snapshot";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS, type AccountProvider } from "@luke/credentials/snapshot";
import {
  AuthPage,
  PROVIDER_BUTTON_SIZE,
  ProviderButton,
  TEXT_BUTTON_TONE,
  TEXT_LINK_LOOK,
  TextButton,
  TextLink,
  WingFace,
} from "@luke/ui";

/** Each way in, in the order the gate stands them, with the name it says. */
const WAYS_IN = [
  { provider: ACCOUNT_PROVIDER.GOOGLE, name: "Google" },
  { provider: ACCOUNT_PROVIDER.GITHUB, name: "GitHub" },
] as const;

/**
 * The sign-in, alone in the window on an AuthPage card: Luke's resting face over the two ways in.
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
  macAppLink,
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
  /** The link that opens the Mac app instead, which a shell that is not the Mac app offers; absent in the Mac app. */
  macAppLink?: string;
  /** Sends the browser to the provider; the gate then waits on it. */
  onBegin: (provider: AccountProvider) => void;
  onCancel: () => void;
}): React.JSX.Element {
  // A sign-in begun from no press of this gate still holds both buttons.
  const busy = waiting !== undefined || account.status === ACCOUNT_STATUS.SIGNING_IN;
  const primary = lastUsed ?? ACCOUNT_PROVIDER.GOOGLE;
  return (
    <AuthPage
      mark={<WingFace />}
      title="Welcome to Luke"
      error={failure}
      footnote={
        waiting || macAppLink !== undefined ? (
          <>
            {waiting ? (
              <span role="status">
                Finish in your browser.{" "}
                <TextButton tone={TEXT_BUTTON_TONE.LINK} onClick={onCancel}>
                  Cancel
                </TextButton>
              </span>
            ) : null}
            {macAppLink === undefined ? null : (
              <TextLink href={macAppLink} look={TEXT_LINK_LOOK.UNDERLINED}>
                Open in the Mac app
              </TextLink>
            )}
          </>
        ) : undefined
      }
    >
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
    </AuthPage>
  );
}
