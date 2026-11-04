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

/**
 * The whole account roster behind the Users tab, one row per user row the
 * service holds, whether or not the account ever took a meaningful action —
 * which is exactly what the dashboard's most-active table cannot say. The
 * rows count active days through the same meaningful actions the overview's
 * table ranks by, read from the same tables behind the same admin gate.
 */

/**
 * How many rows one read returns. The bound exists so an account table that
 * has grown past what a page can usefully draw degrades to a stated
 * truncation — `total` still counts everyone the filter keeps — rather than
 * an unbounded response, and the search narrows the read itself, so an
 * account past the bound is still findable by name or email.
 */
export const ADMIN_USERS_LIMIT = 200;

/**
 * How many UTC days back, today included, a roster row's last-active day
 * reads: a trailing year, well past the widest window, so an account quiet
 * for the window still says when it last worked, while every arm of the
 * actions union stays cut at a bound.
 */
export const ADMIN_USERS_LAST_ACTIVE_DAYS = 365;

/**
 * An `ILIKE` pattern matching the term as a literal substring: Postgres's
 * default escape character is the backslash, so the term's own `%`, `_`,
 * and `\` are escaped before the wildcards wrap it — a searched "100%" must
 * match those four characters, never widen into a prefix scan.
 */
export function searchLikePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`;
}

/**
 * One pattern per word of the term, which a row must satisfy all of: "jane
 * acme" finds Jane at Acme, as the panel's own word search does for the rows
 * it already holds.
 */
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

/** Stamps the queried roster with the window its aggregates cover and the search that scoped it. */
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
  /** The signed-in admin the roster is read for: the favorites are theirs. */
  viewer: AdminViewer;
  /** Reads the roster as one viewer sees it: the favorites are theirs. */
  readUsers: (
    now: number,
    scope: AdminMetricsScope,
    viewerId: string,
    windowDays: AdminMetricsWindow,
    search: string | undefined,
  ) => AdminSeamEffect<AdminUserList>;
}

/**
 * Answers the roster read behind the same gate and refusals the metrics read
 * stands behind, at the same scope and window vocabulary: the Users tab hides
 * admin accounts by default the way every dashboard count does.
 */
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
