import {
  SOCIAL_PROVIDER,
  SOCIAL_PROVIDER_LABEL,
  type SocialProvider,
} from "@luke/features/sign-in-provider";
import { BUTTON_VARIANT, Button, ProviderMark } from "@luke/ui";
import type { createAuthClient } from "better-auth/react";
import { useState } from "react";

/**
 * sign-in-choices.tsx -- the Google and GitHub sign-in buttons a page on the browser's session offers when it has none.
 *
 * A sign-in returns the browser to the address it left, so the page carries
 * on where it was once Better Auth hands it a session.
 */

/** The one call the buttons make, which every Better Auth client has. */
type SocialSignIn = Pick<ReturnType<typeof createAuthClient>, "signIn">;

/**
 * One provider's button: its mark and "Continue with" its name, or the ring
 * while its sign-in is opening, named for the provider it is opening. Every
 * other choice stands unavailable while one opens.
 */
export function ProviderButton({
  provider,
  pending,
  onPress,
}: {
  provider: SocialProvider;
  /** The provider whose sign-in is opening, if one is. */
  pending: SocialProvider | undefined;
  onPress: () => void;
}): React.JSX.Element {
  const label = SOCIAL_PROVIDER_LABEL[provider];
  return (
    <Button
      variant={BUTTON_VARIANT.OUTLINE}
      icon={<ProviderMark provider={provider} className="shrink-0" />}
      busy={pending === provider}
      busyLabel={`Opening ${label}`}
      disabled={pending !== undefined && pending !== provider}
      onClick={onPress}
    >
      {`Continue with ${label}`}
    </Button>
  );
}

/** What a page says when a sign-in could not start. */
export const SIGN_IN_FAILURE = "Sign-in could not start. Try again.";

/** Where a page's sign-in choices stand, and the press that opens one. */
interface SocialSignInState {
  /** The provider whose sign-in is opening, if one is. */
  readonly pending: SocialProvider | undefined;
  /** Whether the last sign-in could not start. */
  readonly failed: boolean;
  readonly begin: (provider: SocialProvider) => void;
}

/**
 * A page's sign-in choices. A sign-in returns the browser to this address
 * once Better Auth has a session, and one opens at a time.
 */
export function useSocialSignIn(client: SocialSignIn): SocialSignInState {
  const [pending, setPending] = useState<SocialProvider>();
  const [failed, setFailed] = useState(false);
  const begin = async (provider: SocialProvider) => {
    if (pending) return;
    setPending(provider);
    setFailed(false);
    const result = await client.signIn.social({
      provider,
      callbackURL: `${window.location.pathname}${window.location.search}`,
    });
    if (!result.error) return;
    setPending(undefined);
    setFailed(true);
  };
  return { pending, failed, begin: (provider) => void begin(provider) };
}

/** A button for every provider, one after another, for a container that lays them out. */
export function ProviderChoices({
  pending,
  onPress,
}: {
  pending: SocialProvider | undefined;
  onPress: (provider: SocialProvider) => void;
}): React.JSX.Element {
  return (
    <>
      {Object.values(SOCIAL_PROVIDER).map((provider) => (
        <ProviderButton
          key={provider}
          provider={provider}
          pending={pending}
          onPress={() => onPress(provider)}
        />
      ))}
    </>
  );
}
