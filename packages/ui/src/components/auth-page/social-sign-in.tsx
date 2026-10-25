import {
  SOCIAL_PROVIDER,
  SOCIAL_PROVIDER_LABEL,
  type SocialProvider,
} from "@luke/features/sign-in-provider";
import { SIGN_IN_FAILURE, SIGN_IN_FAILURE_WORDS } from "@luke/features/words";
import type { ReactNode } from "react";
import { ProviderButton } from "../provider-button/provider-button.js";
import { AuthPage } from "./auth-page.js";

/**
 * social-sign-in.tsx -- the one sign-in card: an AuthPage whose body is a button for every social provider.
 *
 * The card knows nothing of the auth client. A caller hands it which provider
 * is opening, whether the last attempt could not start, and the press that
 * begins one; one opens at a time, so every other choice stands unavailable
 * while one does.
 *
 * It draws nothing of its own: each choice is a `ProviderButton` (shadcn/ui's
 * button beneath), and the card is the AuthPage's, whose body stretches each
 * to the card's inner width.
 */

/** What the card says when a sign-in could not start: the sign-in gate's own sentence for one that did not finish. */
export const SIGN_IN_UNFINISHED = SIGN_IN_FAILURE_WORDS[SIGN_IN_FAILURE.UNFINISHED];

/**
 * One provider's button: its mark and "Continue with" its name, or the ring
 * while its sign-in is opening, named for the provider it is opening.
 */
export function SocialProviderButton({
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
    <ProviderButton
      provider={provider}
      name={label}
      busy={pending === provider}
      busyLabel={`Opening ${label}`}
      disabled={pending !== undefined && pending !== provider}
      onPress={onPress}
    />
  );
}

/** A button for every provider (or just `providers`), one after another, for a container that lays them out. */
export function SocialSignInChoices({
  providers = Object.values(SOCIAL_PROVIDER),
  pending,
  onPress,
}: {
  /** The choices offered, in order; every provider where left out. */
  providers?: readonly SocialProvider[];
  /** The provider whose sign-in is opening, if one is. */
  pending: SocialProvider | undefined;
  onPress: (provider: SocialProvider) => void;
}): React.JSX.Element {
  return (
    <>
      {providers.map((provider) => (
        <SocialProviderButton
          key={provider}
          provider={provider}
          pending={pending}
          onPress={() => onPress(provider)}
        />
      ))}
    </>
  );
}

/** A sign-in card: `title` under `mark`, the provider choices, and the failure when the last one could not start. */
export function SocialSignInCard({
  mark,
  title,
  description,
  footnote,
  pending,
  failed = false,
  onPress,
}: {
  mark?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  footnote?: ReactNode;
  /** The provider whose sign-in is opening, if one is. */
  pending: SocialProvider | undefined;
  /** Whether the last sign-in could not start. */
  failed?: boolean;
  onPress: (provider: SocialProvider) => void;
}): React.JSX.Element {
  return (
    <AuthPage
      mark={mark}
      title={title}
      description={description}
      error={failed ? SIGN_IN_UNFINISHED : undefined}
      footnote={footnote}
    >
      <SocialSignInChoices pending={pending} onPress={onPress} />
    </AuthPage>
  );
}
