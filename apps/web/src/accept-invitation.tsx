import { HOSTED_SERVICE_PATH } from "@luke/features";
import {
  INVITATION_OFFER_QUERY,
  INVITATION_OFFER_REFUSAL,
  type InvitationAcceptQuery,
  invitationAcceptQuery,
  invitationOfferAnswerSchema,
} from "@luke/features/workspace-invitation-wire";
import { AuthPage, BUTTON_VARIANT, Button } from "@luke/ui";
import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { Option, Schema } from "effect";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ProviderChoices, SIGN_IN_FAILURE, useSocialSignIn } from "./sign-in-choices";
import "./styles.css";

/**
 * accept-invitation.tsx -- the page an invitee joins a workspace on, on the browser's own session.
 *
 * The invite page hands out this page's address with the invitation's id.
 * Signed in, the page reads the invitation through Luke's own route, which
 * makes the organization plugin's checks but holds an invitation to be the
 * workspace's rather than its inviter's, so a link outlives whoever made it
 * and names them only while they are still a member; it then accepts it
 * through the plugin
 * (https://www.better-auth.com/docs/plugins/organization#accept-invitation),
 * and the Mac picks the workspace up on its next refresh. An invitation that
 * expired, was used, or was canceled is no invitation at all, so the page
 * says plainly that the link is spent rather than which of the three it
 * was. An invitation is read and accepted only by an account at the invited
 * address its provider verified, so a session at another address signs in
 * again.
 */

const authClient = createAuthClient({ plugins: [organizationClient()] });

/** Better Auth's codes for an invitation the session may not accept. */
const INVITATION_ERROR = {
  NOT_RECIPIENT: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION",
  UNVERIFIED_ACCEPT: "EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION",
} as const;

const decodeOffer = Schema.decodeUnknownOption(invitationOfferAnswerSchema);

/** The HTTP status Better Auth answers an expired, used, canceled, or unknown invitation with. */
const SPENT_STATUS = 400;

/** What the page shows: the work under way, a sign-in, the invitation to accept, or how it settled. */
const VIEW = { WORKING: "working", SIGN_IN: "sign-in", OFFER: "offer", SAID: "said" } as const;

type View =
  | { readonly kind: typeof VIEW.WORKING }
  | {
      readonly kind: typeof VIEW.SIGN_IN | typeof VIEW.SAID;
      readonly title: string;
      readonly body: string;
    }
  | {
      readonly kind: typeof VIEW.OFFER;
      readonly id: string;
      readonly name: string;
      /** Who invited them, while still a member of the workspace. */
      readonly inviter: string | undefined;
      readonly role: string;
    };

const WORKING: View = { kind: VIEW.WORKING };

const SPENT: View = said(
  "This invitation is no longer valid",
  "It has expired, already been used, or been canceled. Ask whoever invited you for a new link.",
);

function said(title: string, body: string): View {
  return { kind: VIEW.SAID, title, body };
}

function signIn(title: string, body: string): View {
  return { kind: VIEW.SIGN_IN, title, body };
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

const UNREACHED: View = said("Luke could not be reached", "Reload this page to try again.");

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

/** The invitation the address names, read on the signed-in session through Luke's own route. */
async function readInvitation(query: InvitationAcceptQuery, signedIn: string): Promise<View> {
  const { id } = query;
  if (id === undefined) return said("Nothing to accept", "Open the invitation link you were sent.");
  const search = new URLSearchParams({ [INVITATION_OFFER_QUERY.ID]: id });
  const response = await fetch(`${HOSTED_SERVICE_PATH.WORKSPACES_INVITATION_OFFER}?${search}`, {
    credentials: "same-origin",
  }).catch(() => undefined);
  if (response === undefined || !response.ok) return UNREACHED;
  const read = decodeOffer(await response.json().catch(() => undefined));
  if (Option.isNone(read)) return UNREACHED;
  const answer = read.value;
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
  return said(`You joined ${offer.name}`, "Return to Luke. You can close this tab.");
}

function titleOf(view: View): string {
  if (view.kind === VIEW.WORKING) return "Opening your invitation…";
  if (view.kind === VIEW.OFFER) return `Join ${view.name}`;
  return view.title;
}

function descriptionOf(view: View): string | undefined {
  if (view.kind === VIEW.WORKING) return undefined;
  if (view.kind !== VIEW.OFFER) return view.body;
  if (view.inviter === undefined) {
    return `You're invited to plan in ${view.name} on Luke, as ${view.role}.`;
  }
  return `${view.inviter} invited you to plan in ${view.name} on Luke, as ${view.role}.`;
}

/**
 * The card a sign-in is asked for on, with a button for every provider. A
 * sign-in that cannot start is said in the card's alert region. The choices'
 * state is this card's, so it ends with the card: a session that comes and
 * goes in another tab brings the card back without an earlier failure.
 */
function SignInCard({ title, body }: { title: string; body: string }): React.JSX.Element {
  const { pending, failed, begin } = useSocialSignIn(authClient);
  return (
    <AuthPage title={title} description={body} error={failed ? SIGN_IN_FAILURE : undefined}>
      <ProviderChoices pending={pending} onPress={begin} />
    </AuthPage>
  );
}

/**
 * The page is one AuthPage card with no artwork, as it had none before: the
 * title says where the invitation stands, the description what it means,
 * and the body holds the one action that moves it on, accepting it or
 * signing in.
 */
function AcceptInvitation(): React.JSX.Element {
  const [query] = useState(() => invitationAcceptQuery(window.location.search));
  const [view, setView] = useState<View>(WORKING);
  const [accepting, setAccepting] = useState(false);
  const session = authClient.useSession();
  const signedIn = session.data?.user.email;

  // Note that the invitation is read again only when who is signed in
  // changes, not whenever the session is: accepting makes Better Auth read the
  // session again, and a read of an invitation just accepted says it is spent.
  useEffect(() => {
    if (session.isPending) return;
    if (signedIn === undefined) {
      setView(
        signIn(
          "Sign in to accept your invitation",
          query.email === undefined
            ? "Sign in with the account at the address you were invited at."
            : `Sign in with the account that uses ${query.email}.`,
        ),
      );
      return;
    }
    void readInvitation(query, signedIn).then(setView);
  }, [query, session.isPending, signedIn]);

  const join = async (offer: { id: string; name: string }) => {
    if (accepting) return;
    setAccepting(true);
    setView(await accept(offer, { invited: query.email, signedIn: signedIn ?? "" }));
    setAccepting(false);
  };

  if (view.kind === VIEW.SIGN_IN) return <SignInCard title={view.title} body={view.body} />;
  return (
    <AuthPage title={titleOf(view)} description={descriptionOf(view)}>
      {view.kind === VIEW.OFFER ? (
        <Button
          variant={BUTTON_VARIANT.OUTLINE}
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

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");

createRoot(rootElement).render(
  <StrictMode>
    <AcceptInvitation />
  </StrictMode>,
);
