import { Schema } from "effect";

/**
 * workspace-members-wire.ts -- what the Workspaces page posts to add a Luke account to a workspace, and where.
 *
 * The page and the route read this one module, so the path, the roles a new
 * member may be given, and the body's bounds are one declaration. It is
 * `effect`'s Schema and nothing of the server, so the page's bundle takes it
 * without the route behind it.
 */

/** The route the page posts an addition to, on the site's own origin and its browser session. */
export const WORKSPACE_MEMBERS_PATH = "/api/workspaces/members";

/** The roles a member is added with: the plugin's own words, `owner` left to the workspace's maker. */
export const ADDABLE_ROLE = {
  MEMBER: "member",
  ADMIN: "admin",
} as const;
export type AddableRole = (typeof ADDABLE_ROLE)[keyof typeof ADDABLE_ROLE];

const WORKSPACE_MEMBER_BOUNDS = {
  /** The plugin's ids are short generated strings; this is room, not a format. */
  MAX_ORGANIZATION_ID_CHARS: 200,
  /** The longest address RFC 5321 lets a mailbox carry. */
  MAX_EMAIL_CHARS: 320,
} as const;

/** An addition: the workspace, the account's sign-in address, and the role it joins with. */
export const workspaceMemberRequestSchema = Schema.Struct({
  organizationId: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(WORKSPACE_MEMBER_BOUNDS.MAX_ORGANIZATION_ID_CHARS),
  ),
  email: Schema.Trim.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(WORKSPACE_MEMBER_BOUNDS.MAX_EMAIL_CHARS),
  ),
  role: Schema.Literals([ADDABLE_ROLE.MEMBER, ADDABLE_ROLE.ADMIN]),
});
export type WorkspaceMemberRequest = typeof workspaceMemberRequestSchema.Type;
