import { PRODUCT_NAME } from "@repo/features/product-name";
import { SIGN_IN_CHOSEN } from "@repo/panel/admin/prefs";
import {
  AuthPage,
  BUTTON_VARIANT,
  Button,
  ProductMark,
  SocialSignInCard,
  ViewingAsBanner,
} from "@repo/ui";
import { UNREPORTED } from "@repo/ui/reported-failure";
import { authClient, stopImpersonating } from "../../auth-client";
import { useSocialSignIn } from "../../sign-in-choices";

/** The app's mark at the head of the gate's cards. */
function AdminMark(): React.JSX.Element {
  return (
    <span className="inline-flex w-13">
      <ProductMark fill inherit />
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
      title={`${PRODUCT_NAME} admin`}
      pending={pending}
      failed={failed ? UNREPORTED.NO_REPORTER : undefined}
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

/**
 * The gate's one non-admin refusal, worded the same on both views. A
 * maintainer signed in as a member is refused here as any non-admin is, so
 * the Viewing as strip stands over it then, whose Stop takes them back to
 * that member's page as themselves.
 */
export function ForbiddenCard({
  email,
  onSignOut,
}: {
  email: string | undefined;
  onSignOut: () => void;
}): React.JSX.Element {
  const session = authClient.useSession().data;
  const card = (
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
  if (!session?.session.impersonatedBy) return card;
  return (
    <>
      <ViewingAsBanner
        member={{ name: session.user.name, email: session.user.email }}
        onStop={() => stopImpersonating(session.user.id)}
      />
      {card}
    </>
  );
}
