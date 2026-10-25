import { SIGN_IN_CHOSEN } from "@luke/panel/admin/prefs";
import { AuthPage, BUTTON_VARIANT, Button, FaceMark, SocialSignInCard } from "@luke/ui";
import { useSocialSignIn } from "../../sign-in-choices";
import { authClient } from "../auth-client";

/** Luke's mark at the head of the gate's cards. */
function AdminMark(): React.JSX.Element {
  return (
    <span className="inline-flex w-13">
      <FaceMark />
    </span>
  );
}

export function SignInCard(): React.JSX.Element {
  const { pending, failed, begin } = useSocialSignIn(authClient, {
    callbackURL: () => window.location.pathname,
    onStarted: () => SIGN_IN_CHOSEN.write(true),
  });
  return (
    <SocialSignInCard
      mark={<AdminMark />}
      title="Luke admin"
      pending={pending}
      failed={failed}
      onPress={begin}
    />
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
