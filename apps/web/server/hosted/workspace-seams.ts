import { APIError } from "better-auth/api";
import { Cause, Data, Effect, Option } from "effect";
import type { AddableRole } from "./workspace-members-wire.js";

/**
 * workspace-seams.ts -- the one workspace write that goes through Better Auth, handed to the store as a seam.
 *
 * A workspace is created by the organization plugin itself, so its
 * organization and owner rows are the plugin's own, through the server-only
 * `auth.api.createOrganization`: called with a `userId` and neither a
 * request nor headers, which is the one way the plugin creates for an
 * account with no session. The call is the auth service's promise, wrapped
 * once here the way `bearer.ts` wraps `oauth2UserInfo`, and the store keeps
 * the one field of its answer it needs. The auth service is handed in
 * rather than imported, so a route hands it `auth.api` and a test the API
 * of a Better Auth over its own database.
 *
 * The Workspaces page's additions go through the plugin too, on the
 * browser's session: the session names the caller, the plugin's own
 * `hasPermission` says whether the caller's role may add members, and the
 * server-only `addMember`, called with no headers, writes the member row.
 * A refusal the plugin gives in words of its own, an account already a
 * member or a workspace at its limit, is kept apart from an outage.
 */

/** What a workspace is created with: its name and slug, the account that will own it, and the metadata the plugin stores as JSON text. */
interface WorkspaceCreation {
  readonly name: string;
  readonly slug: string;
  readonly userId: string;
  readonly metadata: Readonly<Record<string, boolean>>;
}

/** The plugin's writes the workspace store makes. */
export interface WorkspaceSeams {
  readonly createOrganization: (
    creation: WorkspaceCreation,
  ) => Effect.Effect<{ readonly id: string }, Cause.UnknownError>;
}

/** One account added to one workspace, with the role it joins with. */
interface MemberAddition {
  readonly userId: string;
  readonly organizationId: string;
  readonly role: AddableRole;
}

/** The plugin refused the addition in words of its own: the account is already a member, or the workspace is full. */
class MemberRefused extends Data.TaggedError("MemberRefused")<{ readonly message: string }> {}

/** The plugin's reads and write behind the page's additions, each on the request's own headers where it reads one. */
export interface WorkspaceMemberSeams {
  /** The account the browser session belongs to; nothing for a request with no session. */
  readonly sessionAccount: (
    headers: Headers,
  ) => Effect.Effect<Option.Option<string>, Cause.UnknownError>;
  /** Whether the session's account may add members to the workspace; never for a workspace it is not in. */
  readonly mayAddMembers: (
    headers: Headers,
    organizationId: string,
  ) => Effect.Effect<boolean, Cause.UnknownError>;
  readonly addMember: (
    addition: MemberAddition,
  ) => Effect.Effect<{ readonly id: string }, MemberRefused | Cause.UnknownError>;
}

/** The part of a Better Auth `api` with the organization plugin that the seams call. */
export interface OrganizationAuthApi {
  readonly createOrganization: (input: {
    body: { name: string; slug: string; userId: string; metadata: Record<string, boolean> };
  }) => Promise<{ readonly id: string }>;
}

/** The workspace writes over one auth service: `auth.api` on a deployment. */
export function workspaceSeams(api: OrganizationAuthApi): WorkspaceSeams {
  return {
    createOrganization: (creation) =>
      Effect.tryPromise(() =>
        api.createOrganization({
          body: {
            name: creation.name,
            slug: creation.slug,
            userId: creation.userId,
            metadata: { ...creation.metadata },
          },
        }),
      ).pipe(Effect.map((created) => ({ id: created.id }))),
  };
}

/** The part of a Better Auth `api` with the organization plugin that the member seams call. */
export interface MemberAuthApi {
  readonly getSession: (input: {
    headers: Headers;
  }) => Promise<{ readonly user: { readonly id: string } } | null>;
  readonly hasPermission: (input: {
    headers: Headers;
    body: { organizationId: string; permissions: { member: ["create"] } };
  }) => Promise<{ readonly success: boolean }>;
  readonly addMember: (input: {
    body: { userId: string; organizationId: string; role: AddableRole };
  }) => Promise<{ readonly id: string }>;
}

/**
 * The page's member seams over one auth service. A permission the plugin
 * refuses outright, as it refuses a caller who is no member at all, is the
 * same no as a role without the right; anything else it throws is an outage.
 */
export function workspaceMemberSeams(api: MemberAuthApi): WorkspaceMemberSeams {
  return {
    sessionAccount: (headers) =>
      Effect.tryPromise(() => api.getSession({ headers })).pipe(
        Effect.map((session) => Option.fromNullishOr(session?.user.id)),
      ),
    mayAddMembers: (headers, organizationId) =>
      Effect.tryPromise({
        try: () =>
          api.hasPermission({
            headers,
            body: { organizationId, permissions: { member: ["create"] } },
          }),
        catch: (failure) => failure,
      }).pipe(
        Effect.map((answer) => answer.success),
        Effect.catch((failure) =>
          failure instanceof APIError
            ? Effect.succeed(false)
            : Effect.fail(new Cause.UnknownError(failure)),
        ),
      ),
    addMember: (addition) =>
      Effect.tryPromise({
        try: () =>
          api.addMember({
            body: {
              userId: addition.userId,
              organizationId: addition.organizationId,
              role: addition.role,
            },
          }),
        catch: (failure) =>
          failure instanceof APIError
            ? new MemberRefused({ message: failure.message })
            : new Cause.UnknownError(failure),
      }).pipe(Effect.map((created) => ({ id: created.id }))),
  };
}
