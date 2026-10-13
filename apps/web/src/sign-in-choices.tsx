import type { createAuthClient } from "better-auth/react";
import { useState } from "react";
import { GitHubMark, GoogleMark } from "./account-marks";
import { AUTH_BUTTON } from "./auth-surface";
import { SOCIAL_PROVIDER, SOCIAL_PROVIDER_LABEL, type SocialProvider } from "./sign-in-provider";

/**
 * sign-in-choices.tsx -- the Google and GitHub sign-in buttons a page on the browser's session offers when it has none.
 *
 * A sign-in returns the browser to the address it left, so the page carries
 * on where it was once Better Auth hands it a session.
 */

const PROVIDER_MARK = {
  [SOCIAL_PROVIDER.GOOGLE]: GoogleMark,
  [SOCIAL_PROVIDER.GITHUB]: GitHubMark,
} as const satisfies Record<SocialProvider, typeof GitHubMark>;

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
          const Mark = PROVIDER_MARK[provider];
          return (
            <button
              key={provider}
              type="button"
              className={`${AUTH_BUTTON} inline-flex items-center justify-center gap-2.5`}
              disabled={pending !== undefined}
              onClick={() => void begin(provider)}
            >
              <Mark className="size-[15px] shrink-0" />
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
