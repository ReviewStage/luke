import { WORKSPACE_ROLE } from "@sidecar/hosted/workspace-wire";
import { type Cause, Effect } from "effect";

/**
 * workspace-seams.ts -- the workspace writes that go through Better Auth, handed to the store as seams.
 *
 * A workspace is created by the organization plugin itself, so its
 * organization and owner rows are the plugin's own, through the server-only
 * `auth.api.createOrganization`: called with a `userId` and neither a
 * request nor headers, which is the one way the plugin creates for an
 * account with no session; a join is `auth.api.addMember` on the same
 * terms, always as a member. Each call is the auth service's promise, wrapped
 * once here the way `bearer.ts` wraps `oauth2UserInfo`, and the store keeps
 * the one field of its answer it needs. The auth service is handed in
 * rather than imported, so a route hands it `auth.api` and a test the API
 * of a Better Auth over its own database.
 */

/** What a workspace is created with: its name and slug, the account that will own it, and the metadata the plugin stores as JSON text. */
export interface WorkspaceCreation {
  readonly name: string;
  readonly slug: string;
  readonly userId: string;
  readonly metadata: Readonly<Record<string, boolean>>;
}

/** Who joins which workspace; the plugin writes them in as a member. */
interface WorkspaceJoin {
  readonly userId: string;
  readonly organizationId: string;
}

/** The plugin's writes the workspace store makes. */
export interface WorkspaceSeams {
  readonly createOrganization: (
    creation: WorkspaceCreation,
  ) => Effect.Effect<{ readonly id: string }, Cause.UnknownError>;
  readonly addMember: (join: WorkspaceJoin) => Effect.Effect<void, Cause.UnknownError>;
}

/** The part of a Better Auth `api` with the organization plugin that the seams call. */
export interface OrganizationAuthApi {
  readonly createOrganization: (input: {
    body: { name: string; slug: string; userId: string; metadata: Record<string, boolean> };
  }) => Promise<{ readonly id: string }>;
  readonly addMember: (input: {
    body: { userId: string; organizationId: string; role: typeof WORKSPACE_ROLE.MEMBER };
  }) => Promise<{ readonly id: string } | null>;
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
    addMember: (join) =>
      Effect.asVoid(
        Effect.tryPromise(() =>
          api.addMember({
            body: {
              userId: join.userId,
              organizationId: join.organizationId,
              role: WORKSPACE_ROLE.MEMBER,
            },
          }),
        ),
      ),
  };
}
