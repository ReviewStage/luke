import type { AdminViewer } from "./admin-access.js";
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
  /** The signed-in admin the mark belongs to, never an id the request asserts. */
  viewer: AdminViewer;
  /**
   * Sets whether the viewer favorites the named account; false when no user
   * row carries that id, so the page can word a stale roster rather than an
   * outage.
   */
  writeFavorite: (adminId: string, userId: string, favorite: boolean) => Promise<boolean>;
}

/**
 * Answers the star write behind the gate every admin route stands behind,
 * plus the detail read's two: a request that named no account is a 400 before
 * any seam is touched, and an id no user row carries is a 404.
 */
export async function handleAdminFavorite(options: AdminFavoriteOptions): Promise<Response> {
  const { request } = options;
  // The gate admitted only PUT and DELETE, and which of the two it was is the
  // whole ask: PUT sets the star, DELETE takes it back.
  const favorite = request.method === "PUT";

  const userId = adminUserId(request.url);
  if (userId === undefined) {
    return errorResponse(ADMIN_HTTP_STATUS.BAD_REQUEST, ADMIN_ERROR.MISSING_USER_ID);
  }

  try {
    const found = await options.writeFavorite(options.viewer.userId, userId, favorite);
    if (!found) {
      return errorResponse(ADMIN_HTTP_STATUS.NOT_FOUND, ADMIN_ERROR.USER_NOT_FOUND);
    }
    return jsonResponse(ADMIN_HTTP_STATUS.OK, { favorite });
  } catch (error) {
    console.error("admin favorite write failed", error);
    return errorResponse(ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE, ADMIN_ERROR.UNAVAILABLE);
  }
}
