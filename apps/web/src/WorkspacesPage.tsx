import { Option, Schema } from "effect";
import { useEffect, useState } from "react";
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
 */

/** The role words the plugin answers with, drawn as the page names them. */
const ROLE_LABEL = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
} as const;

const decodeRole = Schema.decodeUnknownOption(Schema.Literals(["owner", "admin", "member"]));

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

/** One workspace's team, read on its own so a slow or failed read stays inside its card. */
function useTeam(organizationId: string): TeamRead {
  const [read, setRead] = useState<TeamRead>({ status: "loading" });
  useEffect(() => {
    let current = true;
    setRead({ status: "loading" });
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
  }, [organizationId]);
  return read;
}

function WorkspaceCard({ workspace }: { workspace: ListedWorkspace }): React.JSX.Element {
  const personal = workspace.personal;
  const team = useTeam(workspace.id);
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
              <span className="shrink-0 text-xs text-muted-foreground">
                {roleLabel(member.role)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function WorkspaceList(): React.JSX.Element {
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
        <WorkspaceCard key={workspace.id} workspace={workspace} />
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
        <WorkspaceList />
      </div>
    </main>
  );
}
