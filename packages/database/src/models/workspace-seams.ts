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
 * membership itself. Each call is the auth service's promise, wrapped once
 * here the way `bearer.ts` wraps `oauth2UserInfo`. The auth service is
 * handed in rather than imported, so a route hands it `auth.api` and a test
 * the API of a Better Auth over its own database.
 */

/** The metadata the plugin stores on a personal workspace, as JSON text; only the server writes it. */
export const PERSONAL_WORKSPACE_METADATA = { personal: true } as const;

const MarkedMetadataSchema = Schema.Struct({ personal: Schema.optional(Schema.Boolean) });

/** An organization's metadata as the plugin hands it back: the column's JSON text, or the record where it parsed it. */
export type StoredOrganizationMetadata =
  | string
  | typeof MarkedMetadataSchema.Type
  | null
  | undefined;

const decodeStoredMetadata = Schema.decodeUnknownOption(
  Schema.Union([Schema.fromJsonString(MarkedMetadataSchema), MarkedMetadataSchema]),
);

/**
 * Whether an organization's metadata marks a personal workspace. The
 * plugin's adapter answers the column's text unparsed, so the text is read
 * as JSON, and a record is read as it stands; anything else marks nothing.
 */
export function isPersonalWorkspaceMetadata(metadata: StoredOrganizationMetadata): boolean {
  const stored = decodeStoredMetadata(metadata);
  return Option.isSome(stored) && stored.value.personal === true;
}

/** What a workspace is created with: its name and slug, the account that will own it, and the metadata the plugin stores as JSON text. */
export interface WorkspaceCreation {
  readonly name: string;
  readonly slug: string;
  readonly userId: string;
  readonly metadata: Readonly<Record<string, boolean>>;
}

/** A member write the plugin refused, by the HTTP status its refusal carries; its words stay with it. */
export class OrganizationRefused extends Data.TaggedError("OrganizationRefused")<{
  readonly status: number;
}> {}

/** One member removed from a workspace under the session the headers carry. */
interface MemberRemoval {
  readonly headers: Headers;
  readonly organizationId: string;
  /** The plugin's member id of the one removed. */
  readonly memberId: string;
}

/** The session the headers carry leaving a workspace. */
interface WorkspaceLeaving {
  readonly headers: Headers;
  readonly organizationId: string;
}

/** The plugin's write the workspace store makes. */
export interface WorkspaceSeams {
  readonly createOrganization: (
    creation: WorkspaceCreation,
  ) => Effect.Effect<{ readonly id: string }, Cause.UnknownError>;
}

/** The plugin's member writes the routes make under the Mac's session. */
export interface MemberSeams {
  readonly removeMember: (
    removal: MemberRemoval,
  ) => Effect.Effect<void, OrganizationRefused | Cause.UnknownError>;
  readonly leaveOrganization: (
    leaving: WorkspaceLeaving,
  ) => Effect.Effect<void, OrganizationRefused | Cause.UnknownError>;
}

/** The part of a Better Auth `api` with the organization plugin that the workspace seam calls. */
export interface OrganizationAuthApi {
  readonly createOrganization: (input: {
    body: { name: string; slug: string; userId: string; metadata: Record<string, boolean> };
  }) => Promise<{ readonly id: string }>;
}

/** The part of a Better Auth `api` with the organization plugin that the member seams call. */
export interface MemberAuthApi {
  readonly removeMember: (input: {
    headers: Headers;
    body: { memberIdOrEmail: string; organizationId: string };
  }) => Promise<object | null>;
  readonly leaveOrganization: (input: {
    headers: Headers;
    body: { organizationId: string };
  }) => Promise<object | null>;
}

/**
 * The status a Better Auth `APIError` carries, read by shape: the plugin's
 * refusals are that error, and this package reaches no Better Auth of its
 * own to name the class by.
 */
const decodeRefusal = Schema.decodeUnknownOption(Schema.Struct({ statusCode: Schema.Number }));

/** A plugin member write, its refusal kept by status and anything else an unknown failure. */
function memberWrite(
  write: () => Promise<object | null>,
): Effect.Effect<void, OrganizationRefused | Cause.UnknownError> {
  return Effect.tryPromise({
    try: write,
    catch: (thrown): OrganizationRefused | Cause.UnknownError =>
      Option.match(decodeRefusal(thrown), {
        onNone: () => new Cause.UnknownError(thrown),
        onSome: ({ statusCode }) => new OrganizationRefused({ status: statusCode }),
      }),
  }).pipe(Effect.asVoid);
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
    removeMember: (removal) =>
      memberWrite(() =>
        api.removeMember({
          headers: removal.headers,
          body: { memberIdOrEmail: removal.memberId, organizationId: removal.organizationId },
        }),
      ),
    leaveOrganization: (leaving) =>
      memberWrite(() =>
        api.leaveOrganization({
          headers: leaving.headers,
          body: { organizationId: leaving.organizationId },
        }),
      ),
  };
}
