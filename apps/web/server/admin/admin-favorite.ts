import type { SqlClient } from "@effect/sql";
import { Effect } from "effect";
import type { AdminViewer } from "./admin-access.js";
import {
  ADMIN_ERROR,
  ADMIN_HTTP_STATUS,
  adminUserId,
  errorResponse,
  jsonResponse,
} from "./http.js";
import { type AdminSeamEffect, unavailableSeam } from "./seam.js";

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
  writeFavorite: (adminId: string, userId: string, favorite: boolean) => AdminSeamEffect<boolean>;
}

/**
 * Answers the star write behind the gate every admin route stands behind,
 * plus the detail read's two: a request that named no account is a 400 before
 * any seam is touched, and an id no user row carries is a 404.
 */
export function handleAdminFavorite(
  options: AdminFavoriteOptions,
): Effect.Effect<Response, never, SqlClient.SqlClient> {
  const { request } = options;
  // The gate admitted only PUT and DELETE, and which of the two it was is the
  // whole ask: PUT sets the star, DELETE takes it back.
  const favorite = request.method === "PUT";

  const userId = adminUserId(request.url);
  if (userId === undefined) {
    return Effect.succeed(
      errorResponse(ADMIN_HTTP_STATUS.BAD_REQUEST, ADMIN_ERROR.MISSING_USER_ID),
    );
  }

  return options.writeFavorite(options.viewer.userId, userId, favorite).pipe(
    Effect.map((found) =>
      found
        ? jsonResponse(ADMIN_HTTP_STATUS.OK, { favorite })
        : errorResponse(ADMIN_HTTP_STATUS.NOT_FOUND, ADMIN_ERROR.USER_NOT_FOUND),
    ),
    Effect.catchAllCause((cause) => unavailableSeam("admin favorite write failed", cause)),
  );
}
