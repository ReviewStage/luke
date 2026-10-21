/**
 * Who may open the admin dashboard is the account's `role`, a plain-text column
 * on the `user` table that Better Auth manages — declared as an additional user
 * field (`auth-policy.ts`'s `USER_FIELDS`), generated into `@luke/database/schemas/auth`, and returned on the
 * session — not a constant in this file. The gate is a Better Auth session
 * whose account carries the admin role: the maintainer's own sign-in on this
 * site, or the same account's session as a signed bearer, and never the
 * desktop's OAuth token, which names no session.
 *
 * The database is the source of truth and the only place the role is set. New
 * accounts default to `user`; grant admin by setting the column directly
 * (`update "user" set role = 'admin' where email = '…';`) and withdraw it by
 * setting it back to `user`. There is no environment allowlist and no code path
 * that promotes an account — the grant is a deliberate write a maintainer makes.
 */

/** The user roles this build knows. Plain-text in the column, a fixed set here. */
export const USER_ROLE = {
  USER: "user",
  ADMIN: "admin",
} as const;

/** Whether a stored role string is the admin role — the whole authorization decision. */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === USER_ROLE.ADMIN;
}

/**
 * The signed-in browser viewer a request resolves to. `role` is read from the
 * account's own `user` row on the session, so nothing the request carries can
 * assert it.
 */
export interface AdminViewer {
  userId: string;
  role: string | null | undefined;
}
