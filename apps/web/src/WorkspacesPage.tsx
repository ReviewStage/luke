import { HTTP_STATUS } from "@sidecar/wire";
import { Option, Schema } from "effect";
import { useCallback, useEffect, useState } from "react";
import {
  ADDABLE_ROLE,
  type AddableRole,
  WORKSPACE_MEMBERS_PATH,
  type WorkspaceMemberRequest,
} from "../server/hosted/workspace-members-wire";
import { accountLabel } from "./account-initials";
import { GitHubMark, GoogleMark } from "./account-marks";
import { AUTH_BUTTON, AUTH_CARD, AUTH_SHELL, AUTH_TITLE } from "./auth-surface";
import { LukeMark } from "./SiteChrome";
import { SOCIAL_PROVIDER, SOCIAL_PROVIDER_LABEL, type SocialProvider } from "./sign-in-provider";
import { authClient } from "./workspaces/auth-client";
import { slugTail, workspaceSlug } from "./workspaces/workspace-slug";

/**
 * WorkspacesPage.tsx -- the site's Workspaces page: the account's workspaces, each one's team, and a form to make another.
 *
 * Every call is the organization plugin's own client, on the browser's
 * Better Auth session, exactly as the plugin documents it. Nothing calls
 * `setActive`: Luke never reads the session's active workspace, so each
 * read names its workspace by id. A personal workspace, the one the server
 * made for the account, is listed read-only.
 *
 * Names and addresses on this page are other people's, so everything past
 * the gate wears `ph-block` and the site's session recorder draws a blank
 * box where it stands.
 *
 * An owner or an admin of a shared workspace adds a teammate by the address
 * their Luke account signs in with, through Luke's own route, since the
 * plugin's add is server-only, and removes one through the plugin's own
 * `removeMember`. Nobody removes an owner or themselves here.
 */

/** The plugin's default role words. */
const ROLE = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
} as const;

/** The role words the plugin answers with, drawn as the page names them. */
const ROLE_LABEL = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
} as const;

const decodeRole = Schema.decodeUnknownOption(Schema.Literals(["owner", "admin", "member"]));

/** The roles that may add and remove a workspace's members, as the plugin's defaults grant it. */
const MANAGING_ROLES: ReadonlySet<string> = new Set([ROLE.OWNER, ROLE.ADMIN]);

/**
 * The plugin's mark on the account's own workspace. The list route hands the
 * metadata column back as the JSON text it is stored as, so both that and
 * the parsed object read as personal.
 */
const PersonalMarkSchema = Schema.Struct({ personal: Schema.Literal(true) });
const decodePersonalMark = Schema.decodeUnknownOption(
  Schema.Union([PersonalMarkSchema, Schema.fromJsonString(PersonalMarkSchema)]),
);

const PLAIN_BUTTON =
  "inline-flex min-h-10 cursor-pointer items-center justify-center rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium transition-colors duration-150 hover:bg-muted disabled:cursor-default disabled:opacity-60 disabled:hover:bg-card";

const SECTION = "rounded-lg border border-border bg-card px-5 py-4";

interface ListedWorkspace {
  readonly id: string;
  readonly name: string;
  readonly personal: boolean;
}

interface TeamMember {
  readonly id: string;
  readonly userId: string;
  readonly role: string;
  readonly user: { readonly name: string; readonly email: string };
}

type TeamRead =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "ready"; readonly members: readonly TeamMember[] };

/** The account's own workspace first, then the rest by name. */
function inListOrder(
  listed: readonly { id: string; name: string; metadata?: unknown }[],
): ListedWorkspace[] {
  return listed
    .map(({ id, name, metadata }) => ({
      id,
      name,
      personal: Option.isSome(decodePersonalMark(metadata)),
    }))
    .sort((left, right) => {
      const personal = Number(right.personal) - Number(left.personal);
      return personal !== 0 ? personal : left.name.localeCompare(right.name);
    });
}

/** What the page says when the route refuses an addition, by the status it answered. */
function additionFailure(status: number): string {
  if (status === HTTP_STATUS.NOT_FOUND) return "No Luke account signs in with that address.";
  if (status === HTTP_STATUS.UNAUTHORIZED) return "Your session ended. Sign in again.";
  return "That account could not be added. It may already be a member.";
}

function roleLabel(role: string): string {
  return Option.match(decodeRole(role), {
    onNone: () => role,
    onSome: (known) => ROLE_LABEL[known],
  });
}

function SignInCard(): React.JSX.Element {
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
    if (!result.error) return;
    setPending(undefined);
    setFailed(true);
  };

  const providerButton = (provider: SocialProvider, mark: React.JSX.Element) => (
    <button
      type="button"
      className={`${AUTH_BUTTON} inline-flex items-center justify-center gap-2.5`}
      disabled={pending !== undefined}
      onClick={() => void begin(provider)}
    >
      {mark}
      {pending === provider ? "Opening…" : `Continue with ${SOCIAL_PROVIDER_LABEL[provider]}`}
    </button>
  );

  return (
    <main className={AUTH_SHELL}>
      <section className={AUTH_CARD} aria-labelledby="workspaces-sign-in-title">
        <div className="inline-flex w-13" aria-hidden="true">
          <LukeMark className="h-auto w-full" />
        </div>
        <h1 id="workspaces-sign-in-title" className={AUTH_TITLE}>
          Workspaces
        </h1>
        <p className="m-0 text-muted-foreground">
          Sign in with the account you use in Luke to see your workspaces and their teams.
        </p>
        <div className="mt-8 mb-4 grid gap-3">
          {providerButton(SOCIAL_PROVIDER.GOOGLE, <GoogleMark className="size-[15px] shrink-0" />)}
          {providerButton(SOCIAL_PROVIDER.GITHUB, <GitHubMark className="size-[15px] shrink-0" />)}
        </div>
        {failed ? <p className="m-0 text-attention">Sign-in could not start. Try again.</p> : null}
      </section>
    </main>
  );
}

function CreateWorkspaceForm(): React.JSX.Element {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string>();

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (pending || !trimmed) return;
    setPending(true);
    setFailure(undefined);
    // Note that the active workspace is kept as it was, because Luke never
    // reads it and a create should not quietly move it.
    const result = await authClient.organization.create({
      name: trimmed,
      slug: workspaceSlug(trimmed, slugTail()),
      keepCurrentActiveOrganization: true,
    });
    setPending(false);
    if (result.error) {
      setFailure(result.error.message ?? "The workspace could not be created. Try again.");
      return;
    }
    setName("");
  };

  return (
    <form className={SECTION} onSubmit={(event) => void create(event)}>
      <label htmlFor="workspace-name" className="block text-sm font-medium">
        New workspace
      </label>
      <p className="mt-1 mb-3 text-sm text-muted-foreground">
        A workspace is a team's shared set of plans. You will be its owner.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          id="workspace-name"
          className="min-h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring"
          placeholder="Acme"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" className={PLAIN_BUTTON} disabled={pending || !name.trim()}>
          {pending ? "Creating…" : "Create workspace"}
        </button>
      </div>
      <p role="status" className="mt-2 mb-0 text-sm text-attention empty:hidden">
        {failure}
      </p>
    </form>
  );
}

/**
 * One workspace's team, read on its own so a slow or failed read stays inside
 * its card, and read again when an addition or a removal changed it.
 */
function useTeam(organizationId: string) {
  const [read, setRead] = useState<TeamRead>({ status: "loading" });
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((count) => count + 1), []);
  useEffect(() => {
    let current = true;
    // Note that a reread keeps the team on screen, because blanking it to
    // "Loading" would jump the card under the button just pressed.
    if (generation === 0) setRead({ status: "loading" });
    void authClient.organization
      .getFullOrganization({ query: { organizationId } })
      .then((result) => {
        if (!current) return;
        setRead(
          result.data ? { status: "ready", members: result.data.members } : { status: "failed" },
        );
      });
    return () => {
      current = false;
    };
  }, [organizationId, generation]);
  return { read, reload };
}

function AddMemberForm({
  organizationId,
  onAdded,
}: {
  organizationId: string;
  onAdded: () => void;
}): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AddableRole>(ADDABLE_ROLE.MEMBER);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string>();
  const inputId = `add-member-${organizationId}`;

  const add = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (pending || !trimmed) return;
    setPending(true);
    setFailure(undefined);
    const body: WorkspaceMemberRequest = { organizationId, email: trimmed, role };
    const answer = await fetch(WORKSPACE_MEMBERS_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    }).catch(() => undefined);
    setPending(false);
    if (!answer?.ok) {
      setFailure(answer ? additionFailure(answer.status) : "Luke could not be reached. Try again.");
      return;
    }
    setEmail("");
    onAdded();
  };

  return (
    <form className="mt-4 border-t border-border pt-4" onSubmit={(event) => void add(event)}>
      <label htmlFor={inputId} className="block text-sm font-medium">
        Add by email
      </label>
      <p className="mt-1 mb-3 text-sm text-muted-foreground">
        The address they sign in to Luke with. They join straight away.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          id={inputId}
          type="email"
          className="min-h-10 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring"
          placeholder="teammate@example.com"
          value={email}
          autoComplete="off"
          onChange={(event) => setEmail(event.target.value)}
        />
        <select
          aria-label="Role"
          className="min-h-10 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:border-ring"
          value={role}
          onChange={(event) =>
            setRole(
              event.target.value === ADDABLE_ROLE.ADMIN ? ADDABLE_ROLE.ADMIN : ADDABLE_ROLE.MEMBER,
            )
          }
        >
          <option value={ADDABLE_ROLE.MEMBER}>{ROLE_LABEL[ADDABLE_ROLE.MEMBER]}</option>
          <option value={ADDABLE_ROLE.ADMIN}>{ROLE_LABEL[ADDABLE_ROLE.ADMIN]}</option>
        </select>
        <button type="submit" className={PLAIN_BUTTON} disabled={pending || !email.trim()}>
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      <p role="status" className="mt-2 mb-0 text-sm text-attention empty:hidden">
        {failure}
      </p>
    </form>
  );
}

function RemoveMemberButton({
  organizationId,
  member,
  onRemoved,
}: {
  organizationId: string;
  member: TeamMember;
  onRemoved: (failure?: string) => void;
}): React.JSX.Element {
  const [pending, setPending] = useState(false);
  const remove = async () => {
    if (pending) return;
    setPending(true);
    const result = await authClient.organization.removeMember({
      memberIdOrEmail: member.id,
      organizationId,
    });
    setPending(false);
    onRemoved(
      result.error
        ? (result.error.message ?? `${accountLabel(member.user)} could not be removed.`)
        : undefined,
    );
  };
  return (
    <button
      type="button"
      className={`${PLAIN_BUTTON} min-h-8 px-2.5 py-1 text-xs`}
      disabled={pending}
      aria-label={`Remove ${accountLabel(member.user)}`}
      onClick={() => void remove()}
    >
      {pending ? "Removing…" : "Remove"}
    </button>
  );
}

function WorkspaceCard({
  workspace,
  viewerId,
}: {
  workspace: ListedWorkspace;
  viewerId: string;
}): React.JSX.Element {
  const personal = workspace.personal;
  const { read: team, reload } = useTeam(workspace.id);
  const [removalFailure, setRemovalFailure] = useState<string>();
  const viewer =
    team.status === "ready" ? team.members.find((member) => member.userId === viewerId) : undefined;
  const manages = !personal && viewer !== undefined && MANAGING_ROLES.has(viewer.role);
  const removable = (member: TeamMember) =>
    manages && member.userId !== viewerId && member.role !== ROLE.OWNER;
  const removed = (failure?: string) => {
    setRemovalFailure(failure);
    if (failure === undefined) reload();
  };
  return (
    <section className={SECTION} aria-labelledby={`workspace-${workspace.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`workspace-${workspace.id}`} className="m-0 text-base font-semibold">
          {workspace.name}
        </h2>
        {personal ? (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
            Personal
          </span>
        ) : null}
      </div>
      {personal ? (
        <p className="mt-1 mb-0 text-sm text-muted-foreground">
          Your own plans. Nobody else can be added to it.
        </p>
      ) : null}
      {team.status === "loading" ? (
        <p className="mt-3 mb-0 text-sm text-muted-foreground">Loading the team…</p>
      ) : team.status === "failed" ? (
        <p className="mt-3 mb-0 text-sm text-attention">The team could not be read.</p>
      ) : (
        <ul className="mt-3 mb-0 divide-y divide-border p-0">
          {team.members.map((member) => (
            <li key={member.id} className="flex items-center justify-between gap-4 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{accountLabel(member.user)}</div>
                <div className="truncate text-xs text-muted-foreground">{member.user.email}</div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-muted-foreground">{roleLabel(member.role)}</span>
                {removable(member) ? (
                  <RemoveMemberButton
                    organizationId={workspace.id}
                    member={member}
                    onRemoved={removed}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p role="status" className="mt-2 mb-0 text-sm text-attention empty:hidden">
        {removalFailure}
      </p>
      {manages ? <AddMemberForm organizationId={workspace.id} onAdded={reload} /> : null}
    </section>
  );
}

function WorkspaceList({ viewerId }: { viewerId: string }): React.JSX.Element {
  const workspaces = authClient.useListOrganizations();
  if (workspaces.isPending && !workspaces.data) {
    return <p className="text-sm text-muted-foreground">Loading your workspaces…</p>;
  }
  if (!workspaces.data) {
    return (
      <div className={SECTION}>
        <p className="m-0 text-sm text-attention">Your workspaces could not be read.</p>
        <button
          type="button"
          className={`${PLAIN_BUTTON} mt-3`}
          onClick={() => void workspaces.refetch()}
        >
          Try again
        </button>
      </div>
    );
  }
  return (
    <div className="grid gap-4">
      {inListOrder(workspaces.data).map((workspace) => (
        <WorkspaceCard key={workspace.id} workspace={workspace} viewerId={viewerId} />
      ))}
    </div>
  );
}

export function WorkspacesPage(): React.JSX.Element {
  const session = authClient.useSession();
  if (session.isPending) return <main className={AUTH_SHELL} aria-busy="true" />;
  const account = session.data?.user;
  if (!account) return <SignInCard />;

  return (
    <main className="mx-auto w-full max-w-[720px] px-6 py-12">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <LukeMark className="h-auto w-8" />
          <h1 className="m-0 text-2xl font-semibold">Workspaces</h1>
        </div>
        <div className="ph-block flex items-center gap-3 text-sm text-muted-foreground">
          <span className="truncate">{account.email}</span>
          <button type="button" className={PLAIN_BUTTON} onClick={() => void authClient.signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <p className="mt-0 mb-6 text-muted-foreground">
        Everyone in a workspace sees and edits its plans.
      </p>
      <div className="ph-block grid gap-6">
        <CreateWorkspaceForm />
        <WorkspaceList viewerId={account.id} />
      </div>
    </main>
  );
}
