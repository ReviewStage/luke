import type { SocialProvider } from "@luke/features/sign-in-provider";
import { AuthPage, BUTTON_VARIANT, Button, ERROR_STATE_PLACEMENT, ErrorState } from "@luke/ui";
import { useState } from "react";
import { LukeMark } from "../../SiteChrome";
import { ProviderChoices, SIGN_IN_FAILURE } from "../../sign-in-choices";
import { authClient } from "../auth-client";
import { SIGN_IN_CHOSEN } from "../prefs";

/** Luke's mark at the head of the gate's cards. */
function AdminMark(): React.JSX.Element {
  return (
    <span className="inline-flex w-13">
      <LukeMark className="h-auto w-full" />
    </span>
  );
}

export function SignInCard(): React.JSX.Element {
  const [pending, setPending] = useState<SocialProvider>();
  const [failed, setFailed] = useState(false);

  const begin = async (provider: SocialProvider) => {
    if (pending) return;
    setPending(provider);
    setFailed(false);
    const result = await authClient.signIn.social({
      provider,
      callbackURL: window.location.pathname,
    });
    if (result.error) {
      setPending(undefined);
      setFailed(true);
      return;
    }
    SIGN_IN_CHOSEN.write(true);
  };

  return (
    <AuthPage mark={<AdminMark />} title="Luke admin" error={failed ? SIGN_IN_FAILURE : undefined}>
      <ProviderChoices pending={pending} onPress={(provider) => void begin(provider)} />
    </AuthPage>
  );
}

/**
 * A card standing alone on the page: `title`, what it means, and the one act
 * that leads on from it.
 */
function Centered({
  title,
  description,
  action,
}: {
  title: string;
  description: React.ReactNode;
  action: { label: string; onPress: () => void };
}): React.JSX.Element {
  return (
    <AuthPage mark={<AdminMark />} title={title} description={description}>
      <Button variant={BUTTON_VARIANT.OUTLINE} onClick={action.onPress}>
        {action.label}
      </Button>
    </AuthPage>
  );
}

/** The gate's one non-admin refusal, worded the same on both views. */
export function ForbiddenCard({
  email,
  onSignOut,
}: {
  email: string | undefined;
  onSignOut: () => void;
}): React.JSX.Element {
  return (
    <Centered
      title="Not authorized"
      description={
        <>
          {email ? `${email} does not` : "This account does not"} have the{" "}
          <code className="font-mono">admin</code> role. It is set in the database.
        </>
      }
      action={{ label: "Sign out", onPress: onSignOut }}
    />
  );
}

/**
 * The failed read in the page's place, under the page's own toolbar, so the
 * title and the controls stay where they stood: the app's centred failure,
 * with the Retry every screen offers on it. Note that Retry refuses a press
 * while a read is out, because a second read would abort the first and
 * start the wait over.
 */
export function AdminErrorState({
  detail,
  refreshing,
  onRetry,
}: {
  detail: string;
  refreshing: boolean;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <ErrorState
      placement={ERROR_STATE_PLACEMENT.CENTRED}
      onRetry={() => {
        if (!refreshing) onRetry();
      }}
    >
      {detail}
    </ErrorState>
  );
}
