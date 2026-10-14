import {
  SOCIAL_PROVIDER,
  SOCIAL_PROVIDER_LABEL,
  type SocialProvider,
} from "@luke/features/sign-in-provider";
import { ProviderMark } from "@luke/ui";
import { AUTH_BUTTON } from "@luke/ui/auth-surface";
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

export function SignInChoices({ client }: { readonly client: SocialSignIn }): React.JSX.Element {
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
  return (
    <>
      <div className="mt-8 mb-4 grid gap-3">
        {Object.values(SOCIAL_PROVIDER).map((provider) => {
          return (
            <button
              key={provider}
              type="button"
              className={`${AUTH_BUTTON} inline-flex items-center justify-center gap-2.5`}
              disabled={pending !== undefined}
              onClick={() => void begin(provider)}
            >
              <ProviderMark provider={provider} className="size-[15px] shrink-0" />
              {pending === provider
                ? "Opening…"
                : `Continue with ${SOCIAL_PROVIDER_LABEL[provider]}`}
            </button>
          );
        })}
      </div>
      {failed ? (
        <p className="m-0 text-attention" role="alert">
          Sign-in could not start. Try again.
        </p>
      ) : null}
    </>
  );
}
