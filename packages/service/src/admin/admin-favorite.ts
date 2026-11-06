import type { DatabaseServices } from "@repo/database/core/query";
import { adminUserId } from "@repo/features/admin-wire";
import { Effect } from "effect";
import type { AdminViewer } from "./admin-access.js";
import { ADMIN_REFUSAL, type AdminRefusal } from "./http-effect.js";
import { type AdminSeamEffect, unavailableSeam } from "./seam.js";

export interface AdminFavoriteOptions {
  favorite: boolean;
  query: { readonly id?: string };
  viewer: AdminViewer;
  writeFavorite: (adminId: string, userId: string, favorite: boolean) => AdminSeamEffect<boolean>;
}

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
