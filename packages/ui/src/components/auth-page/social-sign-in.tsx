import {
  SOCIAL_PROVIDER,
  SOCIAL_PROVIDER_LABEL,
  type SocialProvider,
} from "@repo/features/sign-in-provider";
import { SIGN_IN_FAILURE, SIGN_IN_FAILURE_WORDS } from "@repo/features/words";
import type { ReactNode } from "react";
import type { ReportedFailure, Unreported } from "../../reported-failure.js";
import { ProviderButton } from "../provider-button/provider-button.js";
import { AuthPage } from "./auth-page.js";

export const SIGN_IN_UNFINISHED = SIGN_IN_FAILURE_WORDS[SIGN_IN_FAILURE.UNFINISHED];

export function SocialProviderButton({
  provider,
  pending,
  onPress,
}: {
  provider: SocialProvider;
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

export function SocialSignInChoices({
  providers = Object.values(SOCIAL_PROVIDER),
  pending,
  onPress,
}: {
  providers?: readonly SocialProvider[];
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

export function SocialSignInCard({
  mark,
  title,
  description,
  footnote,
  pending,
  failed,
  onPress,
}: {
  mark?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  footnote?: ReactNode;
  pending: SocialProvider | undefined;
  failed?: ReportedFailure | Unreported | undefined;
  onPress: (provider: SocialProvider) => void;
}): React.JSX.Element {
  return (
    <AuthPage
      mark={mark}
      title={title}
      description={description}
      error={failed === undefined ? undefined : { words: SIGN_IN_UNFINISHED, failure: failed }}
      footnote={footnote}
    >
      <SocialSignInChoices pending={pending} onPress={onPress} />
    </AuthPage>
  );
}
