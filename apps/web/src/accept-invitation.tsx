import { browserClient } from "@repo/features/contract/browser-client";
import { LANDING_TONE, type LandingTone } from "@repo/features/landing-outcome";
import {
  INVITATION_OFFER_QUERY,
  INVITATION_OFFER_REFUSAL,
  INVITATION_ROLE,
  type InvitationAcceptQuery,
  invitationAcceptQuery,
  type WorkspaceInvitation,
} from "@repo/features/workspace-invitation-wire";
import { QUERY_ROOT } from "@repo/panel/query-keys";
import {
  type AuthAction,
  AuthMark,
  AuthPage,
  AVATAR_SHAPE,
  AVATAR_SIZE,
  Avatar,
  BUTTON_VARIANT,
  Button,
  SocialSignInCard,
} from "@repo/ui";
import { queryOptions, skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { useState } from "react";
import { openAppFromMac } from "./open-app";
import { WEB_APP_URL } from "./SiteChrome";
import { useSocialSignIn } from "./sign-in-choices";
import "./styles.css";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { UNREPORTED } from "@repo/ui/reported-failure";
import { mountPrerenderedPage } from "./mount-page";

const authClient = createAuthClient({ plugins: [organizationClient()] });

const INVITATION_ERROR = {
  NOT_RECIPIENT: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION",
  UNVERIFIED_ACCEPT: "EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION",
} as const;

const SPENT_STATUS = 400;

const VIEW = {
  WORKING: "working",
  SIGN_IN: "sign-in",
  OFFER: "offer",
  SAID: "said",
} as const;

type View =
  | { readonly kind: typeof VIEW.WORKING }
  | {
      readonly kind: typeof VIEW.SIGN_IN;
      readonly title: string;
      readonly body: string;
      readonly footnote?: string;
    }
  | {
      readonly kind: typeof VIEW.SAID;
      readonly title: string;
      readonly body: string;
      readonly tone: LandingTone | undefined;
      readonly action: AuthAction | undefined;
    }
  | {
      readonly kind: typeof VIEW.OFFER;
      readonly id: string;
      readonly name: string;
      readonly inviter: string | undefined;
      readonly role: WorkspaceInvitation["role"];
    };

const WORKING: View = { kind: VIEW.WORKING };

const OPEN_ON_THE_WEB = { label: `Open ${PRODUCT_NAME} on the web`, href: WEB_APP_URL } as const;

const ROLE_WORDS = {
  [INVITATION_ROLE.MEMBER]: "a member",
  [INVITATION_ROLE.ADMIN]: "an admin",
} as const satisfies Record<WorkspaceInvitation["role"], string>;

function openTheWorkspace(): AuthAction {
  return openAppFromMac() ?? OPEN_ON_THE_WEB;
}

const SPENT: View = said(
  "This invitation is no longer valid",
  "It has expired, already been used, or been canceled. Ask whoever invited you for a new link.",
  LANDING_TONE.DANGER,
  OPEN_ON_THE_WEB,
);

function said(title: string, body: string, tone?: LandingTone, action?: AuthAction): View {
  return { kind: VIEW.SAID, title, body, tone, action };
}

function signIn(title: string, body: string, footnote?: string): View {
  return footnote === undefined
    ? { kind: VIEW.SIGN_IN, title, body }
    : { kind: VIEW.SIGN_IN, title, body, footnote };
}

function inWorkspace(title: string, body: string): View {
  return said(title, body, LANDING_TONE.COMPLETE, openTheWorkspace());
}

interface Addresses {
  readonly invited: string | undefined;
  readonly signedIn: string;
}

function otherAddress({ invited, signedIn }: Addresses): View {
  if (invited === undefined) {
    return signIn(
      "This invitation is for someone else",
      `You're signed in as ${signedIn}. Sign in with the account at the address you were invited at.`,
    );
  }
  return signIn(
    `This invitation is for ${invited}`,
    `You're signed in as ${signedIn}. Sign in with the account that uses ${invited}: your Google and GitHub accounts may use different addresses.`,
  );
}

function unverified(email: string): View {
  return signIn(
    "Your address isn't verified",
    `Google or GitHub has not verified ${email}. Verify it there, or sign in with an account whose address is verified.`,
  );
}

const UNREACHED: View = said(
  `${PRODUCT_NAME} could not be reached`,
  "Reload this page to try again.",
  LANDING_TONE.DANGER,
);

function refused(
  error: { readonly status: number; readonly code?: string | undefined },
  addresses: Addresses,
): View {
  if (error.code === INVITATION_ERROR.NOT_RECIPIENT) return otherAddress(addresses);
  if (error.code === INVITATION_ERROR.UNVERIFIED_ACCEPT) return unverified(addresses.signedIn);
  if (error.status === SPENT_STATUS) return SPENT;
  return UNREACHED;
}

function invitationOfferQuery(
  id: string | undefined,
  signedIn: string | undefined,
  verified: boolean | undefined,
) {
  return queryOptions({
    queryKey: [QUERY_ROOT.INVITATION_OFFER, id, signedIn, verified],
    queryFn:
      id === undefined || signedIn === undefined
        ? skipToken
        : () => browserClient.workspaceInvitations.offer({ [INVITATION_OFFER_QUERY.ID]: id }),
    staleTime: Infinity,
    retry: false,
  });
}

type OfferAnswer = Awaited<ReturnType<typeof browserClient.workspaceInvitations.offer>>;

function offerView(
  answer: OfferAnswer,
  id: string,
  query: InvitationAcceptQuery,
  signedIn: string,
): View {
  if ("member" in answer) {
    const { workspaceName } = answer.member;
    return inWorkspace(
      `You're already in ${workspaceName}`,
      `It's in your sidebar in ${PRODUCT_NAME}.`,
    );
  }
  if ("refused" in answer) {
    if (answer.refused === INVITATION_OFFER_REFUSAL.NOT_RECIPIENT) {
      return otherAddress({ invited: query.email, signedIn });
    }
    if (answer.refused === INVITATION_OFFER_REFUSAL.UNVERIFIED) return unverified(signedIn);
    return SPENT;
  }
  return {
    kind: VIEW.OFFER,
    id,
    name: answer.offer.workspaceName,
    inviter: answer.offer.inviter?.name,
    role: answer.offer.role,
  };
}

function readView(
  query: InvitationAcceptQuery,
  signedIn: string | undefined,
  failed: boolean,
  answer: OfferAnswer | undefined,
): View {
  if (signedIn === undefined) {
    return signIn(
      "Sign in to accept your invitation",
      `Use the Google or GitHub account at ${query.email ?? "the address you were invited at"}.`,
    );
  }
  if (query.id === undefined) {
    return said(
      "Nothing to accept",
      "Open the invitation link you were sent.",
      LANDING_TONE.DANGER,
    );
  }
  if (failed) return UNREACHED;
  if (answer === undefined) return WORKING;
  return offerView(answer, query.id, query, signedIn);
}

async function accept(offer: { id: string; name: string }, addresses: Addresses): Promise<View> {
  const accepted = await authClient.organization.acceptInvitation({ invitationId: offer.id });
  if (accepted.error) return refused(accepted.error, addresses);
  return inWorkspace(
    `You joined ${offer.name}`,
    `${offer.name} is in your sidebar in ${PRODUCT_NAME}. You can close this tab.`,
  );
}

function titleOf(view: View): string {
  if (view.kind === VIEW.WORKING) return "Opening your invitation…";
  if (view.kind === VIEW.OFFER) return `Join ${view.name}`;
  return view.title;
}

function descriptionOf(view: View): string | undefined {
  if (view.kind === VIEW.WORKING) return undefined;
  if (view.kind !== VIEW.OFFER) return view.body;
  const as = ROLE_WORDS[view.role];
  if (view.inviter === undefined) {
    return `You're invited to work in ${view.name} on ${PRODUCT_NAME}, as ${as}.`;
  }
  return `${view.inviter} invited you to work in ${view.name} on ${PRODUCT_NAME}, as ${as}.`;
}

function markOf(view: View): React.JSX.Element {
  if (view.kind === VIEW.OFFER) {
    return <Avatar name={view.name} size={AVATAR_SIZE.PAGE} shape={AVATAR_SHAPE.TILE} decorative />;
  }
  return <AuthMark tone={view.kind === VIEW.SAID ? view.tone : undefined} />;
}

function SignInCard({
  title,
  body,
  footnote,
}: {
  title: string;
  body: string;
  footnote: string | undefined;
}): React.JSX.Element {
  const { pending, failed, begin } = useSocialSignIn(authClient);
  return (
    <SocialSignInCard
      mark={<AuthMark />}
      title={title}
      description={body}
      footnote={footnote}
      pending={pending}
      failed={failed ? UNREPORTED.NO_REPORTER : undefined}
      onPress={begin}
    />
  );
}

function AcceptInvitation(): React.JSX.Element {
  const [query] = useState(() => invitationAcceptQuery(window.location.search));
  const session = authClient.useSession();
  const signedIn = session.data?.user.email;
  const verified = session.data?.user.emailVerified;
  const offer = useQuery(invitationOfferQuery(query.id, signedIn, verified));
  const joining = useMutation({
    mutationFn: (invitation: { id: string; name: string }) =>
      accept(invitation, { invited: query.email, signedIn: signedIn ?? "" }),
  });
  const view =
    joining.data ??
    (session.isPending ? WORKING : readView(query, signedIn, offer.isError, offer.data));

  const join = (invitation: { id: string; name: string }) => {
    if (joining.isPending) return;
    joining.mutate(invitation);
  };

  if (view.kind === VIEW.SIGN_IN) {
    return <SignInCard title={view.title} body={view.body} footnote={view.footnote} />;
  }
  return (
    <AuthPage
      mark={markOf(view)}
      title={titleOf(view)}
      description={descriptionOf(view)}
      action={view.kind === VIEW.SAID ? view.action : undefined}
      footnote={view.kind === VIEW.OFFER ? `You'll join as ${signedIn ?? ""}.` : undefined}
    >
      {view.kind === VIEW.OFFER ? (
        <Button
          variant={BUTTON_VARIANT.PRIMARY}
          busy={joining.isPending}
          busyLabel="Joining"
          onClick={() => join(view)}
        >
          Accept invitation
        </Button>
      ) : null}
    </AuthPage>
  );
}

mountPrerenderedPage(<AcceptInvitation />);
