import type { DatabaseServices } from "@repo/database/core/query";
import type {
  AdminSignIn,
  AdminUserList,
  AdminUserListRow,
} from "@repo/features/admin-answer-wire";
import {
  type AdminMetricsScope,
  type AdminMetricsWindow,
  type AdminUsersQuery,
  adminMetricsScope,
  adminMetricsWindow,
  adminUsersSearch,
} from "@repo/features/admin-wire";
import { Clock, Effect } from "effect";
import type { AdminViewer } from "./admin-access.js";
import { ADMIN_REFUSAL, type AdminRefusal } from "./http-effect.js";
import { type AdminSeamEffect, unavailableSeam } from "./seam.js";

export const ADMIN_USERS_LIMIT = 200;

export const ADMIN_USERS_LAST_ACTIVE_DAYS = 365;

export function searchLikePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`;
}

export function searchLikePatterns(term: string): readonly string[] {
  return term
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map(searchLikePattern);
}

export interface AdminUserListSource {
  total: number;
  signIn: AdminSignIn;
  rows: readonly AdminUserListRow[];
}

export function buildAdminUserList(
  source: AdminUserListSource,
  now: number,
  windowDays: AdminMetricsWindow,
  search: string | undefined,
): AdminUserList {
  return {
    generatedAt: now,
    windowDays,
    total: source.total,
    limit: ADMIN_USERS_LIMIT,
    search,
    signIn: source.signIn,
    rows: [...source.rows],
  };
}

export interface AdminUsersOptions {
  query: AdminUsersQuery;
  viewer: AdminViewer;
  readUsers: (
    now: number,
    scope: AdminMetricsScope,
    viewerId: string,
    windowDays: AdminMetricsWindow,
    search: string | undefined,
  ) => AdminSeamEffect<AdminUserList>;
}

export function handleAdminUsers(
  options: AdminUsersOptions,
): Effect.Effect<AdminUserList, AdminRefusal, DatabaseServices> {
  const { query } = options;

  const windowDays = adminMetricsWindow(query.window);
  if (windowDays === undefined) return Effect.fail(ADMIN_REFUSAL.INVALID_WINDOW);

  const search = adminUsersSearch(query.search);
  if (search === undefined) return Effect.fail(ADMIN_REFUSAL.INVALID_SEARCH);

  return Effect.flatMap(Clock.currentTimeMillis, (now) =>
    options
      .readUsers(
        now,
        adminMetricsScope(query.scope),
        options.viewer.userId,
        windowDays,
        search.term,
      )
      .pipe(Effect.catchCause((cause) => unavailableSeam("admin users read failed", cause))),
  );
}
