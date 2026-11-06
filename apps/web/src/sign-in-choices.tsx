import type { SocialProvider } from "@repo/features/sign-in-provider";
import { useMutation } from "@tanstack/react-query";
import type { createAuthClient } from "better-auth/react";

/**
 * sign-in-choices.tsx -- the one social sign-in path a page on the browser's session takes: the Better Auth call behind the `@repo/ui` sign-in card's buttons.
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
 * once Better Auth has a session, and one opens at a time: a sign-in that
 * started stays pending, since the browser is on its way to the provider.
 * Better Auth answers a sign-in that cannot start as a result rather than a
 * throw, so the refusal is thrown here, and the choices offer every provider
 * again.
 */
export function useSocialSignIn(
  client: SocialSignIn,
  { callbackURL = CURRENT_ADDRESS, onBegin, onStarted }: SocialSignInOptions = {},
): SocialSignInState {
  const opening = useMutation({
    mutationFn: async (provider: SocialProvider) => {
      const result = await client.signIn.social({ provider, callbackURL: callbackURL() });
      if (result.error) throw new Error("The sign-in could not start.");
    },
    onMutate: () => onBegin?.(),
    onSuccess: () => onStarted?.(),
  });
  const begin = (provider: SocialProvider) => {
    if (opening.isPending || opening.isSuccess) return;
    opening.mutate(provider);
  };
  return {
    pending: opening.isPending || opening.isSuccess ? opening.variables : undefined,
    failed: opening.isError,
    begin,
  };
}
