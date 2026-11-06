import type { SocialProvider } from "@repo/features/sign-in-provider";
import { useMutation } from "@tanstack/react-query";
import type { createAuthClient } from "better-auth/react";

type SocialSignIn = Pick<ReturnType<typeof createAuthClient>, "signIn">;

interface SocialSignInState {
  readonly pending: SocialProvider | undefined;
  readonly failed: boolean;
  readonly begin: (provider: SocialProvider) => void;
}

interface SocialSignInOptions {
  readonly callbackURL?: () => string | undefined;
  readonly onBegin?: () => void;
  readonly onStarted?: () => void;
}

const CURRENT_ADDRESS = () => `${window.location.pathname}${window.location.search}`;

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
