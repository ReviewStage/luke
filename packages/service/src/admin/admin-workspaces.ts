/**
 * admin-workspaces.ts -- the Workspaces tab: headline counts of shared
 * workspaces and a table of workspaces, sorted by the last week's activity.
 *
 * A workspace is a Better Auth `organization`, and most are the personal one
 * made for each account, which says nothing about teams using Luke together.
 * So the headline counts read shared workspaces alone, two or more members
 * and nobody's personal one, and the table lists them unless the read asks
 * for every workspace. What a row names is the workspace's name, its owner,
 * counts, statuses, and the GitHub account its installation is on, never a
 * task's title, a plan's text, or anything a member wrote.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import type {
  AdminWorkspaceInstallation,
  AdminWorkspaceIntegration,
  AdminWorkspaceList,
  AdminWorkspaceOwner,
  AdminWorkspaceRow,
  AdminWorkspaceSummary,
} from "@luke/features/admin-answer-wire";
import {
  ADMIN_METRICS_WINDOW,
  type AdminMetricsScope,
  type AdminWorkspacesKind,
  type AdminWorkspacesQuery,
  adminMetricsScope,
  adminUsersSearch,
  adminWorkspacesKind,
} from "@luke/features/admin-wire";
import { Clock, Effect } from "effect";
import { ADMIN_REFUSAL, type AdminRefusal } from "./http-effect.js";
import { type AdminSeamEffect, unavailableSeam } from "./seam.js";

/**
 * How many rows one read returns, on the roster's terms: past it, `total`
 * still counts every workspace the filter keeps and the search narrows the
 * read itself, so a workspace past the bound is still findable by name.
 */
export const ADMIN_WORKSPACES_LIMIT = 200;

/** The trailing run of UTC days a row's activity counts and the active tile cover. */
export const ADMIN_WORKSPACES_ACTIVITY_DAYS = ADMIN_METRICS_WINDOW.WEEK;

/**
 * Where an invitation stands, as the organization plugin writes it. Only
 * pending and accepted are reachable while rejecting and cancelling stay
 * shut (`auth-policy.ts`); any other status still counts as settled.
 */
export const INVITATION_STATUS = {
  PENDING: "pending",
  ACCEPTED: "accepted",
} as const;

/** A workspace as the main read answers it, before its owner and connections are folded on. */
type AdminWorkspaceSourceRow = Omit<AdminWorkspaceRow, "owner" | "installations" | "integrations">;

/** What the queries read, before the builder folds it into the page's answer. */
export interface AdminWorkspaceListSource {
  total: number;
  /** Already in the table's order and cut at the bound. */
  rows: readonly AdminWorkspaceSourceRow[];
  /** Each listed workspace's owners, the earliest first. */
  owners: readonly { organizationId: string; owner: AdminWorkspaceOwner }[];
  /** Each listed workspace's installations, the first linked first. */
  installations: readonly { organizationId: string; installation: AdminWorkspaceInstallation }[];
  integrations: readonly { organizationId: string; integration: AdminWorkspaceIntegration }[];
  summary: {
    shared: number;
    sharedActiveWeek: number;
    sharedWithActive: number;
    sharedWithSuspended: number;
    /** Invitation counts by status, with how many of each are past their expiry. */
    invitations: readonly { status: string; count: number; pastExpiry: number }[];
  };
}

/** A share, or none where there is nothing to share out. */
function ratio(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

/** What each workspace's rows of one kind carry, keyed by its id, in the order they were read. */
function byWorkspace<Row extends { organizationId: string }, Value>(
  rows: readonly Row[],
  pick: (row: Row) => Value,
): Map<string, Value[]> {
  const grouped = new Map<string, Value[]>();
  for (const row of rows) {
    const list = grouped.get(row.organizationId) ?? [];
    list.push(pick(row));
    grouped.set(row.organizationId, list);
  }
  return grouped;
}

/** Folds the invitation counts into the tile's figures. */
function invitationSummary(
  counts: AdminWorkspaceListSource["summary"]["invitations"],
): AdminWorkspaceSummary["invitations"] {
  let accepted = 0;
  let pending = 0;
  let expired = 0;
  let settled = 0;
  for (const { status, count, pastExpiry } of counts) {
    // Note that only a pending invitation is still open, and only until its
    // expiry; whatever else became of one, it has settled.
    if (status === INVITATION_STATUS.PENDING) {
      pending += count - pastExpiry;
      expired += pastExpiry;
      settled += pastExpiry;
    } else {
      settled += count;
      if (status === INVITATION_STATUS.ACCEPTED) accepted += count;
    }
  }
  return { accepted, pending, expired, settled, acceptanceRate: ratio(accepted, settled) };
}

/** Shapes the queried workspaces into the page's answer. */
export function buildAdminWorkspaceList(
  source: AdminWorkspaceListSource,
  now: number,
  kind: AdminWorkspacesKind,
  search: string | undefined,
): AdminWorkspaceList {
  const owners = byWorkspace(source.owners, (row) => row.owner);
  const installations = byWorkspace(source.installations, (row) => row.installation);
  const integrations = byWorkspace(source.integrations, (row) => row.integration);
  const { summary } = source;

  return {
    generatedAt: now,
    activityDays: ADMIN_WORKSPACES_ACTIVITY_DAYS,
    kind,
    search,
    total: source.total,
    limit: ADMIN_WORKSPACES_LIMIT,
    summary: {
      shared: summary.shared,
      sharedActiveWeek: summary.sharedActiveWeek,
      invitations: invitationSummary(summary.invitations),
      github: {
        sharedWithActive: summary.sharedWithActive,
        sharedWithSuspended: summary.sharedWithSuspended,
        activeShare: ratio(summary.sharedWithActive, summary.shared),
      },
    },
    rows: source.rows.map((row) => ({
      ...row,
      owner: owners.get(row.id)?.[0] ?? null,
      installations: installations.get(row.id) ?? [],
      integrations: integrations.get(row.id) ?? [],
    })),
  };
}

export interface AdminWorkspacesOptions {
  query: AdminWorkspacesQuery;
  readWorkspaces: (
    now: number,
    scope: AdminMetricsScope,
    kind: AdminWorkspacesKind,
    search: string | undefined,
  ) => AdminSeamEffect<AdminWorkspaceList>;
}

/**
 * Answers the Workspaces read behind the same gate and refusals the roster
 * stands behind, at the same scope and search vocabulary: admins' own
 * workspaces are hidden by default the way every dashboard count hides them.
 */
export function handleAdminWorkspaces(
  options: AdminWorkspacesOptions,
): Effect.Effect<AdminWorkspaceList, AdminRefusal, DatabaseServices> {
  const { query } = options;

  const search = adminUsersSearch(query.search);
  if (search === undefined) return Effect.fail(ADMIN_REFUSAL.INVALID_SEARCH);

  return Effect.flatMap(Clock.currentTimeMillis, (now) =>
    options
      .readWorkspaces(
        now,
        adminMetricsScope(query.scope),
        adminWorkspacesKind(query.kind),
        search.term,
      )
      .pipe(Effect.catchCause((cause) => unavailableSeam("admin workspaces read failed", cause))),
  );
}
