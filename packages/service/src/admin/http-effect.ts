import { ADMIN_ERROR, ADMIN_HTTP_STATUS, type AdminError } from "./http.js";

/**
 * The admin refusals as the dashboard's procedures fail with them, and the
 * status each is answered with. They stay the admin's own rather than the
 * hosted tier's for the reason `@luke/features/admin-wire` gives: these slugs
 * are a browser's, not the desktop wire contract's. The hosted oRPC handler
 * answers each one as `{ error: slug }` under its status
 * (`packages/service/src/orpc/errors.ts`), as the old group's responses did.
 */

/** The status each admin refusal is answered with, which is a function of the refusal alone. */
export const ADMIN_REFUSAL_STATUS = {
  [ADMIN_ERROR.METHOD_NOT_ALLOWED]: ADMIN_HTTP_STATUS.METHOD_NOT_ALLOWED,
  [ADMIN_ERROR.UNAVAILABLE]: ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE,
  [ADMIN_ERROR.NOT_SIGNED_IN]: ADMIN_HTTP_STATUS.UNAUTHORIZED,
  [ADMIN_ERROR.NOT_AUTHORIZED]: ADMIN_HTTP_STATUS.FORBIDDEN,
  [ADMIN_ERROR.NOT_FOUND]: ADMIN_HTTP_STATUS.NOT_FOUND,
  [ADMIN_ERROR.MISSING_USER_ID]: ADMIN_HTTP_STATUS.BAD_REQUEST,
  [ADMIN_ERROR.INVALID_WINDOW]: ADMIN_HTTP_STATUS.BAD_REQUEST,
  [ADMIN_ERROR.INVALID_SEARCH]: ADMIN_HTTP_STATUS.BAD_REQUEST,
  [ADMIN_ERROR.INVALID_DAY]: ADMIN_HTTP_STATUS.BAD_REQUEST,
  [ADMIN_ERROR.USER_NOT_FOUND]: ADMIN_HTTP_STATUS.NOT_FOUND,
} as const satisfies Record<AdminError, number>;

export type AdminRefusal = { readonly error: AdminError };

/** The refusal values themselves, since not one of them carries a field. */
export const ADMIN_REFUSAL = {
  /** A seam — the auth service or the database — did not answer, which is an outage and never a sign-out. */
  UNAVAILABLE: { error: ADMIN_ERROR.UNAVAILABLE },
  NOT_SIGNED_IN: { error: ADMIN_ERROR.NOT_SIGNED_IN },
  NOT_AUTHORIZED: { error: ADMIN_ERROR.NOT_AUTHORIZED },
  MISSING_USER_ID: { error: ADMIN_ERROR.MISSING_USER_ID },
  INVALID_WINDOW: { error: ADMIN_ERROR.INVALID_WINDOW },
  INVALID_SEARCH: { error: ADMIN_ERROR.INVALID_SEARCH },
  INVALID_DAY: { error: ADMIN_ERROR.INVALID_DAY },
  USER_NOT_FOUND: { error: ADMIN_ERROR.USER_NOT_FOUND },
} as const satisfies Record<string, AdminRefusal>;
