import {
  type InvitationAcceptQuery,
  invitationAcceptQuery,
} from "@luke/features/workspace-invitation-wire";
import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AUTH_BUTTON, AUTH_CARD, AUTH_SHELL, AUTH_TITLE } from "./auth-surface";
import { SignInChoices } from "./sign-in-choices";
import "./styles.css";

/**
 * accept-invitation.tsx -- the page an invitee joins a workspace on, on the browser's own session.
 *
 * The invite page hands out this page's address with the invitation's id.
 * Signed in, the page reads the invitation through Better Auth's
 * organization plugin
 * (https://www.better-auth.com/docs/plugins/organization#accept-invitation)
 * and offers to accept it; the Mac picks the workspace up on its next
 * refresh. The plugin answers an invitation that expired, was used, or was
 * canceled as no invitation at all, so the page says plainly that the link
 * is spent rather than which of the three it was. An invitation is read and
 * accepted only by an account at the invited address its provider verified,
 * so a session at another address signs in again.
 */

const authClient = createAuthClient({ plugins: [organizationClient()] });

/** Better Auth's codes for an invitation the session may not read or accept. */
const INVITATION_ERROR = {
  NOT_RECIPIENT: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION",
  UNVERIFIED_READ: "EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION",
  UNVERIFIED_ACCEPT: "EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION",
  INVITER_GONE: "INVITER_IS_NO_LONGER_A_MEMBER_OF_THE_ORGANIZATION",
} as const;

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
      readonly inviter: string;
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

/** A refusal of the plugin's in words: a sign-in where another account would do, else what went wrong. */
function refused(
  error: { readonly status: number; readonly code?: string | undefined },
  addresses: Addresses,
): View {
  const email = addresses.signedIn;
  if (error.code === INVITATION_ERROR.NOT_RECIPIENT) return otherAddress(addresses);
  if (
    error.code === INVITATION_ERROR.UNVERIFIED_READ ||
    error.code === INVITATION_ERROR.UNVERIFIED_ACCEPT
  ) {
    return signIn(
      "Your address isn't verified",
      `Google or GitHub has not verified ${email}. Verify it there, or sign in with an account whose address is verified.`,
    );
  }
  if (error.code === INVITATION_ERROR.INVITER_GONE) {
    return said(
      "This invitation is no longer valid",
      "Whoever invited you has left the workspace. Ask a member for a new link.",
    );
  }
  if (error.status === SPENT_STATUS) return SPENT;
  return said("Luke could not be reached", "Reload this page to try again.");
}

/** The invitation the address names, read on the signed-in session. */
async function readInvitation(query: InvitationAcceptQuery, signedIn: string): Promise<View> {
  const { id } = query;
  if (id === undefined) return said("Nothing to accept", "Open the invitation link you were sent.");
  const read = await authClient.organization.getInvitation({ query: { id } });
  if (read.error) return refused(read.error, { invited: query.email, signedIn });
  return {
    kind: VIEW.OFFER,
    id,
    name: read.data.organizationName,
    inviter: read.data.inviterEmail,
    role: read.data.role,
  };
}

async function accept(offer: { id: string; name: string }, addresses: Addresses): Promise<View> {
  const accepted = await authClient.organization.acceptInvitation({ invitationId: offer.id });
  if (accepted.error) return refused(accepted.error, addresses);
  return said(`You joined ${offer.name}`, "Return to Luke. You can close this tab.");
}

function AcceptInvitation(): React.JSX.Element {
  const [query] = useState(() => invitationAcceptQuery(window.location.search));
  const [view, setView] = useState<View>(WORKING);
  const [accepting, setAccepting] = useState(false);
  const session = authClient.useSession();
  const signedIn = session.data?.user.email ?? "";

  useEffect(() => {
    if (session.isPending) return;
    if (!session.data) {
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
    void readInvitation(query, session.data.user.email).then(setView);
  }, [query, session.isPending, session.data]);

  const join = async (offer: { id: string; name: string }) => {
    if (accepting) return;
    setAccepting(true);
    setView(await accept(offer, { invited: query.email, signedIn }));
    setAccepting(false);
  };

  return (
    <main className={AUTH_SHELL}>
      <section className={AUTH_CARD} aria-labelledby="accept-title">
        <h1 id="accept-title" className={AUTH_TITLE}>
          {view.kind === VIEW.WORKING
            ? "Opening your invitation…"
            : view.kind === VIEW.OFFER
              ? `Join ${view.name}`
              : view.title}
        </h1>
        {view.kind === VIEW.SAID || view.kind === VIEW.SIGN_IN ? (
          <p className="m-0 text-muted-foreground">{view.body}</p>
        ) : null}
        {view.kind === VIEW.OFFER ? (
          <>
            <p className="m-0 text-muted-foreground">
              {view.inviter} invited you to plan in {view.name} on Luke, as {view.role}.
            </p>
            <div className="mt-8 grid">
              <button
                type="button"
                className={AUTH_BUTTON}
                disabled={accepting}
                onClick={() => void join(view)}
              >
                {accepting ? "Joining…" : "Accept invitation"}
              </button>
            </div>
          </>
        ) : null}
        {view.kind === VIEW.SIGN_IN ? <SignInChoices client={authClient} /> : null}
      </section>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");

createRoot(rootElement).render(
  <StrictMode>
    <AcceptInvitation />
  </StrictMode>,
);
