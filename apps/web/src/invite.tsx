import {
  invitationAcceptUrl,
  WORKSPACE_INVITE_PAGE,
} from "@sidecar/hosted/workspace-invitation-wire";
import { WORKSPACE_ROLE } from "@sidecar/hosted/workspace-wire";
import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AUTH_BUTTON, AUTH_CARD, AUTH_SHELL, AUTH_TITLE } from "./auth-surface";
import {
  type PendingInvitation,
  type PendingInvitations,
  pendingInvitationsFrom,
} from "./pending-invitations";
import { SignInChoices } from "./sign-in-choices";
import "./styles.css";

/**
 * invite.tsx -- the page an owner or an admin invites people to a workspace from, on the browser's own session.
 *
 * The Mac opens it with the workspace's id. The page asks Better Auth's
 * organization plugin for an invitation to the address typed
 * (https://www.better-auth.com/docs/plugins/organization#send-invitation)
 * and shows the accept page's address to copy, since Luke sends no
 * invitation mail; the pending invitations are listed beneath, each with
 * its address to copy again or to cancel. The plugin decides who may
 * invite and refuses a personal workspace, and its refusal is drawn in its
 * own words. A browser with no session signs in and comes back here.
 */

const authClient = createAuthClient({ plugins: [organizationClient()] });

/** The roles an invitation offers; owner is the creator's alone. */
const INVITED_ROLES = [WORKSPACE_ROLE.MEMBER, WORKSPACE_ROLE.ADMIN] as const;

type InvitedRole = (typeof INVITED_ROLES)[number];

const INVITED_ROLE_LABEL = {
  [WORKSPACE_ROLE.MEMBER]: "Member",
  [WORKSPACE_ROLE.ADMIN]: "Admin",
} as const satisfies Record<InvitedRole, string>;

/** What the page shows: the work under way, a sign-in, a word in place of the page, or the workspace itself. */
const VIEW = { LOADING: "loading", SIGN_IN: "sign-in", SAID: "said", READY: "ready" } as const;

type View =
  | { readonly kind: typeof VIEW.LOADING | typeof VIEW.SIGN_IN }
  | { readonly kind: typeof VIEW.SAID; readonly title: string; readonly body: string }
  | { readonly kind: typeof VIEW.READY; readonly workspaceId: string; readonly name: string };

const INPUT =
  "min-h-[42px] rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-foreground/40";

function said(title: string, body: string): View {
  return { kind: VIEW.SAID, title, body };
}

/** The workspace the address names, by its name among the account's own; a workspace it is not in is said so. */
async function workspaceView(workspaceId: string | null): Promise<View> {
  if (!workspaceId) return said("Nothing to invite to", "Return to Luke and choose Invite people.");
  const listed = await authClient.organization.list();
  if (listed.error) return said("Luke could not be reached", "Reload this page to try again.");
  const workspace = listed.data.find((organization) => organization.id === workspaceId);
  if (!workspace) {
    return said(
      "You're not in this workspace",
      "Sign in to Luke with the account that belongs to it, then choose Invite people again.",
    );
  }
  return { kind: VIEW.READY, workspaceId, name: workspace.name };
}

/** The invitations still waiting on their invitee, or that the listing failed. */
async function pendingInvitations(workspaceId: string): Promise<PendingInvitations> {
  const listed = await authClient.organization.listInvitations({
    query: { organizationId: workspaceId },
  });
  return pendingInvitationsFrom(listed, Date.now());
}

/** The invitation an accept link is for: its id, and the address it was made for. */
interface Invited {
  readonly id: string;
  readonly email: string;
}

function CopyLink({ invited }: { readonly invited: Invited }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const link = invitationAcceptUrl(window.location.origin, invited.id, invited.email);
  const copy = async () => {
    await navigator.clipboard.writeText(link).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  return (
    <div className="flex items-center gap-2">
      <input className={`${INPUT} min-w-0 flex-1 font-mono text-xs`} readOnly value={link} />
      <button type="button" className={`${AUTH_BUTTON} px-3`} onClick={() => void copy()}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function InviteForm({
  workspaceId,
  onInvited,
}: {
  readonly workspaceId: string;
  readonly onInvited: () => void;
}): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitedRole>(WORKSPACE_ROLE.MEMBER);
  const [pending, setPending] = useState(false);
  const [invited, setInvited] = useState<Invited>();
  const [refusal, setRefusal] = useState<string>();
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setRefusal(undefined);
    const answer = await authClient.organization.inviteMember({
      email: email.trim(),
      role,
      organizationId: workspaceId,
    });
    setPending(false);
    if (answer.error) {
      setRefusal(answer.error.message ?? "The invitation was not made. Try again.");
      return;
    }
    setInvited({ id: answer.data.id, email: answer.data.email });
    setEmail("");
    onInvited();
  };
  return (
    <form className="mt-8 grid gap-3 text-left" onSubmit={(event) => void submit(event)}>
      <label className="grid gap-1.5">
        <span className="text-sm text-muted-foreground">Email address</span>
        <input
          className={INPUT}
          type="email"
          required
          autoComplete="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label className="grid gap-1.5">
        <span className="text-sm text-muted-foreground">Role</span>
        <select
          className={INPUT}
          value={role}
          onChange={(event) =>
            setRole(
              INVITED_ROLES.find((candidate) => candidate === event.target.value) ??
                WORKSPACE_ROLE.MEMBER,
            )
          }
        >
          {INVITED_ROLES.map((candidate) => (
            <option key={candidate} value={candidate}>
              {INVITED_ROLE_LABEL[candidate]}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className={AUTH_BUTTON} disabled={pending}>
        {pending ? "Inviting…" : "Invite"}
      </button>
      {refusal ? (
        <p className="m-0 text-attention" role="alert">
          {refusal}
        </p>
      ) : null}
      {invited ? (
        <div className="grid gap-2">
          <p className="m-0 text-sm text-muted-foreground">
            Send this link to {invited.email}. They sign in with that address to join.
          </p>
          <CopyLink key={invited.id} invited={invited} />
        </div>
      ) : null}
    </form>
  );
}

function PendingList({
  invitations,
  onCanceled,
}: {
  readonly invitations: readonly PendingInvitation[];
  readonly onCanceled: () => void;
}): React.JSX.Element | null {
  const [refusal, setRefusal] = useState<string>();
  if (invitations.length === 0) return null;
  const cancel = async (invitationId: string) => {
    setRefusal(undefined);
    const answer = await authClient.organization.cancelInvitation({ invitationId });
    if (answer.error) setRefusal(answer.error.message ?? "The invitation was not canceled.");
    onCanceled();
  };
  return (
    <section className="mt-10 grid gap-4 text-left" aria-labelledby="pending-title">
      <h2 id="pending-title" className="m-0 text-base font-semibold">
        Pending invitations
      </h2>
      {invitations.map((invitation) => (
        <div key={invitation.id} className="grid gap-2 border-t border-border pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate">{invitation.email}</span>
            <button
              type="button"
              className="cursor-pointer text-sm text-muted-foreground hover:text-foreground"
              onClick={() => void cancel(invitation.id)}
            >
              Cancel
            </button>
          </div>
          <span className="text-xs text-muted-foreground">
            {invitation.role} · expires {invitation.expiresAt.toLocaleString()}
          </span>
          <CopyLink invited={invitation} />
        </div>
      ))}
      {refusal ? (
        <p className="m-0 text-attention" role="alert">
          {refusal}
        </p>
      ) : null}
    </section>
  );
}

function Workspace({
  workspaceId,
  name,
}: {
  readonly workspaceId: string;
  readonly name: string;
}): React.JSX.Element {
  const [invitations, setInvitations] = useState<readonly PendingInvitation[]>([]);
  const [listingFailed, setListingFailed] = useState(false);
  const refresh = useCallback(() => {
    // Note that a failed listing keeps the list last loaded, because a
    // refusal says nothing about which invitations are still pending.
    void pendingInvitations(workspaceId).then((pending) => {
      setListingFailed(!pending.ok);
      if (pending.ok) setInvitations(pending.invitations);
    });
  }, [workspaceId]);
  useEffect(refresh, [refresh]);
  return (
    <>
      <h1 id="invite-title" className={AUTH_TITLE}>
        Invite people to {name}
      </h1>
      <p className="m-0 text-muted-foreground">
        They join once they open the link and sign in with the address you invite.
      </p>
      <InviteForm workspaceId={workspaceId} onInvited={refresh} />
      {listingFailed ? (
        <p className="mt-10 mb-0 text-left text-attention" role="alert">
          Pending invitations could not be loaded. Reload to try again.
        </p>
      ) : null}
      <PendingList invitations={invitations} onCanceled={refresh} />
    </>
  );
}

function Invite(): React.JSX.Element {
  const [workspaceId] = useState(() =>
    new URLSearchParams(window.location.search).get(WORKSPACE_INVITE_PAGE.WORKSPACE_PARAM),
  );
  const [view, setView] = useState<View>({ kind: VIEW.LOADING });
  const session = authClient.useSession();

  useEffect(() => {
    if (session.isPending) return;
    if (!session.data) {
      setView({ kind: VIEW.SIGN_IN });
      return;
    }
    void workspaceView(workspaceId).then(setView);
  }, [workspaceId, session.isPending, session.data]);

  return (
    <main className={AUTH_SHELL}>
      <section className={AUTH_CARD} aria-labelledby="invite-title">
        {view.kind === VIEW.READY ? (
          <Workspace workspaceId={view.workspaceId} name={view.name} />
        ) : (
          <h1 id="invite-title" className={AUTH_TITLE}>
            {view.kind === VIEW.SAID
              ? view.title
              : view.kind === VIEW.SIGN_IN
                ? "Sign in to invite people"
                : "Opening…"}
          </h1>
        )}
        {view.kind === VIEW.SAID ? <p className="m-0 text-muted-foreground">{view.body}</p> : null}
        {view.kind === VIEW.SIGN_IN ? (
          <>
            <p className="m-0 text-muted-foreground">
              Sign in to the Luke account you use on your Mac, and you'll come back here.
            </p>
            <SignInChoices client={authClient} />
          </>
        ) : null}
      </section>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");

createRoot(rootElement).render(
  <StrictMode>
    <Invite />
  </StrictMode>,
);
