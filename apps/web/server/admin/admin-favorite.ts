import type { AdminViewer } from "./admin-access.js";
import { isAdminRole } from "./admin-access.js";
import {
  ADMIN_ERROR,
  ADMIN_HTTP_STATUS,
  adminUserId,
  errorResponse,
  jsonResponse,
} from "./http.js";

/**
 * The one thing an admin may write about an account: whether it is a favorite
 * of theirs. The mark belongs to the viewer alone — the handler takes the
 * admin's identity from the same session the gate already resolved, never from
 * the request — and the method is the whole ask: PUT sets the star, DELETE
 * takes it back, and either lands twice without complaint, because a star
 * already where the press put it is the outcome the press wanted.
 */

export interface AdminFavoriteOptions {
  request: Request;
  resolveViewer: (request: Request) => Promise<AdminViewer | undefined>;
  /**
   * Sets whether the viewer favorites the named account; false when no user
   * row carries that id, so the page can word a stale roster rather than an
   * outage.
   */
  writeFavorite: (adminId: string, userId: string, favorite: boolean) => Promise<boolean>;
}

/**
 * Answers the star write behind the same gate and refusals the roster read
 * stands behind, plus the detail read's two: a request that named no account
 * is a 400 before any seam is touched, and an id no user row carries is a 404.
 */
export async function handleAdminFavorite(options: AdminFavoriteOptions): Promise<Response> {
  const { request } = options;
  const favorite =
    request.method === "PUT" ? true : request.method === "DELETE" ? false : undefined;
  if (favorite === undefined) {
    return errorResponse(ADMIN_HTTP_STATUS.METHOD_NOT_ALLOWED, ADMIN_ERROR.METHOD_NOT_ALLOWED);
  }

  let viewer: AdminViewer | undefined;
  try {
    viewer = await options.resolveViewer(request);
  } catch {
    return errorResponse(ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE, ADMIN_ERROR.UNAVAILABLE);
  }
  if (!viewer) {
    return errorResponse(ADMIN_HTTP_STATUS.UNAUTHORIZED, ADMIN_ERROR.NOT_SIGNED_IN);
  }
  if (!isAdminRole(viewer.role)) {
    return errorResponse(ADMIN_HTTP_STATUS.FORBIDDEN, ADMIN_ERROR.NOT_AUTHORIZED);
  }

  const userId = adminUserId(request.url);
  if (userId === undefined) {
    return errorResponse(ADMIN_HTTP_STATUS.BAD_REQUEST, ADMIN_ERROR.MISSING_USER_ID);
  }

  try {
    const found = await options.writeFavorite(viewer.userId, userId, favorite);
    if (!found) {
      return errorResponse(ADMIN_HTTP_STATUS.NOT_FOUND, ADMIN_ERROR.USER_NOT_FOUND);
    }
    return jsonResponse(ADMIN_HTTP_STATUS.OK, { favorite });
  } catch {
    return errorResponse(ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE, ADMIN_ERROR.UNAVAILABLE);
  }
}
