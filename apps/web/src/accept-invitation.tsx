import { browserClient } from "@luke/features/contract/browser-client";
import { LANDING_TONE, type LandingTone } from "@luke/features/landing-outcome";
import {
  INVITATION_OFFER_QUERY,
  INVITATION_OFFER_REFUSAL,
  INVITATION_ROLE,
  type InvitationAcceptQuery,
  invitationAcceptQuery,
  type WorkspaceInvitation,
} from "@luke/features/workspace-invitation-wire";
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
} from "@luke/ui";
import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { useEffect, useState } from "react";
import { openLukeFromMac } from "./open-luke";
import { WEB_APP_URL } from "./SiteChrome";
import { useSocialSignIn } from "./sign-in-choices";
import "./styles.css";
import { PRODUCT_NAME } from "@luke/features/product-name";
import { UNREPORTED } from "@luke/ui/reported-failure";
import { mountPrerenderedPage } from "./mount-page";

/**
 * accept-invitation.tsx -- the page an invitee joins a workspace on, on the browser's own session.
 *
 * The invite page hands out this page's address with the invitation's id.
 * Signed in, the page reads the invitation through our own route, which
 * makes the organization plugin's checks but holds an invitation to be the
 * workspace's rather than its inviter's, so a link outlives whoever made it
 * and names them only while they are still a member; it then accepts it
 * through the plugin
 * (https://www.better-auth.com/docs/plugins/organization#accept-invitation),
 * and the Mac picks the workspace up on its next refresh. An invitation that
 * expired, was used, or was canceled is no invitation at all, so the page
 * says plainly that the link is spent rather than which of the three it
 * was, and a reader already in the workspace, as someone opening their link
 * again after joining is, is told so rather than that the link is spent. An
 * invitation is read and accepted only by an account at the invited address
 * its provider verified, so a session at another address signs in again.
 */

const authClient = createAuthClient({ plugins: [organizationClient()] });

/** Better Auth's codes for an invitation the session may not accept. */
const INVITATION_ERROR = {
  NOT_RECIPIENT: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION",
  UNVERIFIED_ACCEPT: "EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION",
} as const;

/** The HTTP status Better Auth answers an expired, used, canceled, or unknown invitation with. */
const SPENT_STATUS = 400;

/** What the page shows: the work under way, a sign-in, the invitation to accept, or how it stands now. */
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
      /** What comes after signing in, said only before any session. */
      readonly footnote?: string;
    }
  | {
      readonly kind: typeof VIEW.SAID;
      readonly title: string;
      readonly body: string;
      /** How it ended, badged on the mark: settled, failed, or neither. */
      readonly tone: LandingTone | undefined;
      readonly action: AuthAction | undefined;
    }
  | {
      readonly kind: typeof VIEW.OFFER;
      readonly id: string;
      readonly name: string;
      /** Who invited them, while still a member of the workspace. */
      readonly inviter: string | undefined;
      readonly role: WorkspaceInvitation["role"];
    };

const WORKING: View = { kind: VIEW.WORKING };

/** The way on the web app offers, to a reader with no Mac app to open. */
const OPEN_ON_THE_WEB = { label: `Open ${PRODUCT_NAME} on the web`, href: WEB_APP_URL } as const;

/** How the offer names the role it joins as. */
const ROLE_WORDS = {
  [INVITATION_ROLE.MEMBER]: "a member",
  [INVITATION_ROLE.ADMIN]: "an admin",
} as const satisfies Record<WorkspaceInvitation["role"], string>;

/** The way into the workspace once in it: the Mac app on a Mac, else the web app. */
function openTheWorkspace(): AuthAction {
  return openLukeFromMac() ?? OPEN_ON_THE_WEB;
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

/** The workspace the reader is in, as joined now or found joined already. */
function inWorkspace(title: string, body: string): View {
  return said(title, body, LANDING_TONE.COMPLETE, openTheWorkspace());
}

/** Who the invitation is for, where its link says, and who the browser is signed in as. */
interface Addresses {
  readonly invited: string | undefined;
  readonly signedIn: string;
}

/**
 * The sign-in a session at another address needs. A person's Google and
 * GitHub addresses often differ, so the page names the invited one, which
 * only the link carries: the plugin reads an invitation to its recipient
 * alone.
 */
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

/** The sign-in an address its provider has not verified needs. */
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

/** A refusal of the plugin's accept in words: a sign-in where another account would do, else what went wrong. */
function refused(
  error: { readonly status: number; readonly code?: string | undefined },
  addresses: Addresses,
): View {
  if (error.code === INVITATION_ERROR.NOT_RECIPIENT) return otherAddress(addresses);
  if (error.code === INVITATION_ERROR.UNVERIFIED_ACCEPT) return unverified(addresses.signedIn);
  if (error.status === SPENT_STATUS) return SPENT;
  return UNREACHED;
}

/** The invitation the address names, read on the signed-in session through our own route. */
async function readInvitation(query: InvitationAcceptQuery, signedIn: string): Promise<View> {
  const { id } = query;
  if (id === undefined) {
    return said(
      "Nothing to accept",
      "Open the invitation link you were sent.",
      LANDING_TONE.DANGER,
    );
  }
  const answer = await browserClient.workspaceInvitations
    .offer({ [INVITATION_OFFER_QUERY.ID]: id })
    .catch(() => undefined);
  if (answer === undefined) return UNREACHED;
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

/** The mark each view opens on: the invitation's workspace on its offer, else the app's, badged as it ended. */
function markOf(view: View): React.JSX.Element {
  if (view.kind === VIEW.OFFER) {
    return <Avatar name={view.name} size={AVATAR_SIZE.PAGE} shape={AVATAR_SHAPE.TILE} decorative />;
  }
  return <AuthMark tone={view.kind === VIEW.SAID ? view.tone : undefined} />;
}

/**
 * The card a sign-in is asked for on. The choices' state is this card's, so it
 * ends with the card: a session that comes and goes in another tab brings the
 * card back without an earlier failure.
 */
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

/**
 * The page is one AuthPage card: the mark says whose invitation it is or how
 * it ended, the title where the invitation stands, the description what it
 * means, and the body holds the one action that moves it on, accepting it or
 * signing in, with the way into the workspace once the reader is in it.
 */
function AcceptInvitation(): React.JSX.Element {
  const [query] = useState(() => invitationAcceptQuery(window.location.search));
  const [view, setView] = useState<View>(WORKING);
  const [accepting, setAccepting] = useState(false);
  const session = authClient.useSession();
  const signedIn = session.data?.user.email;
  const verified = session.data?.user.emailVerified;

  // Note that the invitation is read again only when who is signed in, or
  // whether their address is verified, changes, not whenever the session is:
  // accepting makes Better Auth read the session again, and a read of an
  // invitation just accepted says the reader is already a member.
  useEffect(() => {
    if (session.isPending) return;
    if (signedIn === undefined) {
      setView(
        signIn(
          "Sign in to accept your invitation",
          `Use the Google or GitHub account at ${query.email ?? "the address you were invited at"}.`,
          "You'll come back to this page to join.",
        ),
      );
      return;
    }
    void readInvitation(query, signedIn).then(setView);
  }, [query, session.isPending, signedIn, verified]);

  const join = async (offer: { id: string; name: string }) => {
    if (accepting) return;
    setAccepting(true);
    setView(await accept(offer, { invited: query.email, signedIn: signedIn ?? "" }));
    setAccepting(false);
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
          busy={accepting}
          busyLabel="Joining"
          onClick={() => void join(view)}
        >
          Accept invitation
        </Button>
      ) : null}
    </AuthPage>
  );
}

mountPrerenderedPage(<AcceptInvitation />);
