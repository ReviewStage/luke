import type { SocialProvider } from "@luke/features/sign-in-provider";
import type { createAuthClient } from "better-auth/react";
import { useState } from "react";

/**
 * sign-in-choices.tsx -- the one social sign-in path a page on the browser's session takes: the Better Auth call behind the `@luke/ui` sign-in card's buttons.
 */

/** The one call the buttons make, which every Better Auth client has. */
type SocialSignIn = Pick<ReturnType<typeof createAuthClient>, "signIn">;

/** Where a page's sign-in choices stand, and the press that opens one. */
interface SocialSignInState {
  /** The provider whose sign-in is opening, if one is. */
  readonly pending: SocialProvider | undefined;
  /** Whether the last sign-in could not start. */
  readonly failed: boolean;
  readonly begin: (provider: SocialProvider) => void;
}

interface SocialSignInOptions {
  /** Where the browser returns once there is a session; the address it left by default. */
  readonly callbackURL?: () => string | undefined;
  /** Called as a sign-in opens. */
  readonly onBegin?: () => void;
  /** Called once the provider's page is on its way. */
  readonly onStarted?: () => void;
}

const CURRENT_ADDRESS = () => `${window.location.pathname}${window.location.search}`;

/**
 * A page's sign-in choices. A sign-in returns the browser to this address
 * once Better Auth has a session, and one opens at a time.
 */
export function useSocialSignIn(
  client: SocialSignIn,
  { callbackURL = CURRENT_ADDRESS, onBegin, onStarted }: SocialSignInOptions = {},
): SocialSignInState {
  const [pending, setPending] = useState<SocialProvider>();
  const [failed, setFailed] = useState(false);
  const begin = async (provider: SocialProvider) => {
    if (pending) return;
    setPending(provider);
    setFailed(false);
    onBegin?.();
    const result = await client.signIn.social({ provider, callbackURL: callbackURL() });
    if (!result.error) {
      onStarted?.();
      return;
    }
    setPending(undefined);
    setFailed(true);
  };
  return { pending, failed, begin: (provider) => void begin(provider) };
}
