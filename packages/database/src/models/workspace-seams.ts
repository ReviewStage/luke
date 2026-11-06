import type { ASSIGNABLE_ROLE, WorkspaceRole } from "@repo/features/workspace-wire";
import { Cause, Data, Effect, Option, Schema } from "effect";

export const PERSONAL_WORKSPACE_METADATA = { personal: true } as const;

export interface WorkspaceCreation {
  readonly name: string;
  readonly slug: string;
  readonly userId: string;
  readonly metadata: Readonly<Record<string, boolean>>;
}

export class OrganizationRefused extends Data.TaggedError("OrganizationRefused")<{
  readonly status: number;
  readonly code?: string | undefined;
}> {}

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

interface MemberRemoval {
  readonly headers: Headers;
  readonly organizationId: string;
  readonly memberId: string;
}

interface MemberRoleUpdate {
  readonly headers: Headers;
  readonly organizationId: string;
  readonly memberId: string;
  readonly role: WorkspaceRole;
}

interface WorkspaceLeaving {
  readonly headers: Headers;
  readonly organizationId: string;
}

interface WorkspaceUpdate {
  readonly headers: Headers;
  readonly organizationId: string;
  readonly data: { readonly name: string } | { readonly logo: string | null };
}

export interface WorkspaceSeams {
  readonly createOrganization: (
    creation: WorkspaceCreation,
  ) => Effect.Effect<{ readonly id: string }, Cause.UnknownError>;
}

type AssignableRole = (typeof ASSIGNABLE_ROLE)[keyof typeof ASSIGNABLE_ROLE];

interface InvitationRequest {
  readonly headers: Headers;
  readonly organizationId: string;
  readonly email: string;
  readonly role: AssignableRole;
}

interface InvitationsRead {
  readonly headers: Headers;
  readonly organizationId: string;
}

export type MemberFailure = OrganizationRefused | Cause.UnknownError;

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

export interface OrganizationAuthApi {
  readonly createOrganization: (input: {
    body: { name: string; slug: string; userId: string; metadata: Record<string, boolean> };
  }) => Promise<{ readonly id: string }>;
}

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

const decodeRefusal = Schema.decodeUnknownOption(
  Schema.Struct({
    statusCode: Schema.Number,
    body: Schema.optionalKey(Schema.Struct({ code: Schema.optionalKey(Schema.String) })),
  }),
);

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

function unreadable<A>(
  read: Effect.Effect<A, Schema.SchemaError>,
): Effect.Effect<A, MemberFailure> {
  return Effect.mapError(read, (failure) => new Cause.UnknownError(failure));
}

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
