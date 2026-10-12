/**
 * auth-client.ts -- the Workspaces page's Better Auth client, with the organization plugin's calls.
 *
 * Kept apart from the admin page's client so that bundle does not carry the
 * organization plugin it never calls.
 */
import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({ plugins: [organizationClient()] });
