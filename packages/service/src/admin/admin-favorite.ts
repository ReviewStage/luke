import type { DatabaseServices } from "@luke/database/core/query";
import { Effect } from "effect";
import type { AdminViewer } from "./admin-access.js";
import { adminUserId } from "./http.js";
import { ADMIN_REFUSAL, type AdminRefusal } from "./http-effect.js";
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
  /** Whether the star is set (PUT) or taken back (DELETE): the method is the whole ask. */
  favorite: boolean;
  query: { readonly id?: string };
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
): Effect.Effect<{ favorite: boolean }, AdminRefusal, DatabaseServices> {
  const { favorite, query } = options;

  const userId = adminUserId(query.id);
  if (userId === undefined) return Effect.fail(ADMIN_REFUSAL.MISSING_USER_ID);

  return options.writeFavorite(options.viewer.userId, userId, favorite).pipe(
    Effect.catchCause((cause) => unavailableSeam("admin favorite write failed", cause)),
    Effect.flatMap((found) =>
      found ? Effect.succeed({ favorite }) : Effect.fail(ADMIN_REFUSAL.USER_NOT_FOUND),
    ),
  );
}
