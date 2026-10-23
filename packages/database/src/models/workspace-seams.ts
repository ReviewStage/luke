import type { ASSIGNABLE_ROLE, WorkspaceRole } from "@luke/features/workspace-wire";
import { Cause, Data, Effect, Option, Schema } from "effect";

/**
 * workspace-seams.ts -- the workspace writes that go through Better Auth, handed to the store and the routes as seams.
 *
 * A workspace is created by the organization plugin itself, so its
 * organization and owner rows are the plugin's own, through the server-only
 * `auth.api.createOrganization`: called with a `userId` and neither a
 * request nor headers, which is the one way the plugin creates for an
 * account with no session. A member's removal and a leaving are the
 * plugin's `removeMember` and `leaveOrganization`, called with the headers
 * of the request that asked, which carry the Mac's own Better Auth session
 * as a signed bearer token, so the plugin checks the caller's role and
 * membership itself. A member's new role, a handover's two among them, is
 * the plugin's `updateMemberRole` under the same headers. A rename, and a photo set or removed, is the plugin's
 * `updateOrganization` under the same headers, given the name alone or the
 * logo alone, so the plugin checks that the caller may update the workspace
 * and leaves its slug as it was. An
 * invitation is made, listed, and canceled the same way, through
 * `createInvitation`, `listInvitations`, and `cancelInvitation`. Each call is the auth service's promise, wrapped once
 * here the way `bearer.ts` wraps `oauth2UserInfo`. The auth service is
 * handed in rather than imported, so a route hands it `auth.api` and a test
 * the API of a Better Auth over its own database.
 */

/** The metadata the plugin stores on the workspace made for an account, as JSON text; only the server writes it, and nothing reads it to behave differently. */
export const PERSONAL_WORKSPACE_METADATA = { personal: true } as const;

/** What a workspace is created with: its name and slug, the account that will own it, and the metadata the plugin stores as JSON text. */
export interface WorkspaceCreation {
  readonly name: string;
  readonly slug: string;
  readonly userId: string;
  readonly metadata: Readonly<Record<string, boolean>>;
}

/** A member write the plugin refused, by the HTTP status and the code its refusal carries; its words stay with it. */
export class OrganizationRefused extends Data.TaggedError("OrganizationRefused")<{
  readonly status: number;
  readonly code?: string | undefined;
}> {}

/** One invitation as the plugin holds it, in the fields Luke reads. */
const InvitationSchema = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  role: Schema.String,
  status: Schema.String,
  expiresAt: Schema.Union([Schema.Date, Schema.String]),
});

export type PluginInvitation = typeof InvitationSchema.Type;

const decodeInvitation = Schema.decodeUnknownEffect(InvitationSchema);
const decodeInvitations = Schema.decodeUnknownEffect(Schema.Array(InvitationSchema));

/** One member removed from a workspace under the session the headers carry. */
interface MemberRemoval {
  readonly headers: Headers;
  readonly organizationId: string;
  /** The plugin's member id of the one removed. */
  readonly memberId: string;
}

/** One member given a role in a workspace under the session the headers carry. */
interface MemberRoleUpdate {
  readonly headers: Headers;
  readonly organizationId: string;
  /** The plugin's member id of the one given the role. */
  readonly memberId: string;
  readonly role: WorkspaceRole;
}

/** The session the headers carry leaving a workspace. */
interface WorkspaceLeaving {
  readonly headers: Headers;
  readonly organizationId: string;
}

/**
 * A workspace changed under the session the headers carry: given a new name,
 * or a new logo, which holds its photo as a `data:` URL, null removing it.
 */
interface WorkspaceUpdate {
  readonly headers: Headers;
  readonly organizationId: string;
  readonly data: { readonly name: string } | { readonly logo: string | null };
}

/** The plugin's write the workspace store makes. */
export interface WorkspaceSeams {
  readonly createOrganization: (
    creation: WorkspaceCreation,
  ) => Effect.Effect<{ readonly id: string }, Cause.UnknownError>;
}

/** A role an invitation may hand, as the caller already decoded it. */
type AssignableRole = (typeof ASSIGNABLE_ROLE)[keyof typeof ASSIGNABLE_ROLE];

/** An invitation made under the session the headers carry. */
interface InvitationRequest {
  readonly headers: Headers;
  readonly organizationId: string;
  readonly email: string;
  readonly role: AssignableRole;
}

/** One workspace's invitations, read or canceled under the session the headers carry. */
interface InvitationsRead {
  readonly headers: Headers;
  readonly organizationId: string;
}

/** Every way a plugin call through these seams fails: its refusal, or anything else it threw or answered. */
export type MemberFailure = OrganizationRefused | Cause.UnknownError;

/** The plugin's member writes the routes make under the Mac's session. */
export interface MemberSeams {
  readonly inviteMember: (
    request: InvitationRequest,
  ) => Effect.Effect<PluginInvitation, MemberFailure>;
  readonly listInvitations: (
    read: InvitationsRead,
  ) => Effect.Effect<readonly PluginInvitation[], MemberFailure>;
  readonly cancelInvitation: (cancel: {
    readonly headers: Headers;
    readonly invitationId: string;
  }) => Effect.Effect<void, MemberFailure>;
  readonly removeMember: (removal: MemberRemoval) => Effect.Effect<void, MemberFailure>;
  readonly updateMemberRole: (update: MemberRoleUpdate) => Effect.Effect<void, MemberFailure>;
  readonly leaveOrganization: (leaving: WorkspaceLeaving) => Effect.Effect<void, MemberFailure>;
  readonly updateOrganization: (update: WorkspaceUpdate) => Effect.Effect<void, MemberFailure>;
}

/** The part of a Better Auth `api` with the organization plugin that the workspace seam calls. */
export interface OrganizationAuthApi {
  readonly createOrganization: (input: {
    body: { name: string; slug: string; userId: string; metadata: Record<string, boolean> };
  }) => Promise<{ readonly id: string }>;
}

/** The part of a Better Auth `api` with the organization plugin that the member seams call. */
export interface MemberAuthApi {
  readonly createInvitation: (input: {
    headers: Headers;
    body: { email: string; role: "admin" | "member"; organizationId: string };
  }) => Promise<object | null>;
  readonly listInvitations: (input: {
    headers: Headers;
    query: { organizationId: string };
  }) => Promise<object | null>;
  readonly cancelInvitation: (input: {
    headers: Headers;
    body: { invitationId: string };
  }) => Promise<object | null>;
  readonly removeMember: (input: {
    headers: Headers;
    body: { memberIdOrEmail: string; organizationId: string };
  }) => Promise<object | null>;
  readonly updateMemberRole: (input: {
    headers: Headers;
    body: { memberId: string; role: WorkspaceRole; organizationId: string };
  }) => Promise<object | null>;
  readonly leaveOrganization: (input: {
    headers: Headers;
    body: { organizationId: string };
  }) => Promise<object | null>;
  readonly updateOrganization: (input: {
    headers: Headers;
    body: { data: { name: string } | { logo: string | null }; organizationId: string };
  }) => Promise<object | null>;
}

/**
 * The status a Better Auth `APIError` carries, read by shape: the plugin's
 * refusals are that error, and this package reaches no Better Auth of its
 * own to name the class by.
 */
const decodeRefusal = Schema.decodeUnknownOption(
  Schema.Struct({
    statusCode: Schema.Number,
    body: Schema.optionalKey(Schema.Struct({ code: Schema.optionalKey(Schema.String) })),
  }),
);

/** A plugin call's answer, its refusal kept by status and code and anything else an unknown failure. */
export function pluginCall(
  write: () => Promise<object | null>,
): Effect.Effect<object | null, MemberFailure> {
  return Effect.tryPromise({
    try: write,
    catch: (thrown): MemberFailure =>
      Option.match(decodeRefusal(thrown), {
        onNone: () => new Cause.UnknownError(thrown),
        onSome: ({ statusCode, body }) =>
          new OrganizationRefused({ status: statusCode, code: body?.code }),
      }),
  });
}

/** An answer the plugin's own shape did not hold, read as the unknown failure it is. */
function unreadable<A>(
  read: Effect.Effect<A, Schema.SchemaError>,
): Effect.Effect<A, MemberFailure> {
  return Effect.mapError(read, (failure) => new Cause.UnknownError(failure));
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

/** The member writes over one auth service: `auth.api` on a deployment. */
export function memberSeams(api: MemberAuthApi): MemberSeams {
  return {
    inviteMember: (request) =>
      Effect.flatMap(
        pluginCall(() =>
          api.createInvitation({
            headers: request.headers,
            body: {
              email: request.email,
              role: request.role,
              organizationId: request.organizationId,
            },
          }),
        ),
        (answer) => unreadable(decodeInvitation(answer)),
      ),
    listInvitations: (read) =>
      Effect.flatMap(
        pluginCall(() =>
          api.listInvitations({
            headers: read.headers,
            query: { organizationId: read.organizationId },
          }),
        ),
        (answer) => unreadable(decodeInvitations(answer)),
      ),
    cancelInvitation: (cancel) =>
      Effect.asVoid(
        pluginCall(() =>
          api.cancelInvitation({
            headers: cancel.headers,
            body: { invitationId: cancel.invitationId },
          }),
        ),
      ),
    removeMember: (removal) =>
      Effect.asVoid(
        pluginCall(() =>
          api.removeMember({
            headers: removal.headers,
            body: { memberIdOrEmail: removal.memberId, organizationId: removal.organizationId },
          }),
        ),
      ),
    updateMemberRole: (update) =>
      Effect.asVoid(
        pluginCall(() =>
          api.updateMemberRole({
            headers: update.headers,
            body: {
              memberId: update.memberId,
              role: update.role,
              organizationId: update.organizationId,
            },
          }),
        ),
      ),
    leaveOrganization: (leaving) =>
      Effect.asVoid(
        pluginCall(() =>
          api.leaveOrganization({
            headers: leaving.headers,
            body: { organizationId: leaving.organizationId },
          }),
        ),
      ),
    updateOrganization: (update) =>
      Effect.asVoid(
        pluginCall(() =>
          api.updateOrganization({
            headers: update.headers,
            body: { data: { ...update.data }, organizationId: update.organizationId },
          }),
        ),
      ),
  };
}
