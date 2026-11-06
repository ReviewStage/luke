import type { DatabaseServices } from "@repo/database/core/query";
import type {
  AdminWorkspaceInstallation,
  AdminWorkspaceList,
  AdminWorkspaceOwner,
  AdminWorkspaceRow,
  AdminWorkspaceSummary,
} from "@repo/features/admin-answer-wire";
import {
  ADMIN_METRICS_WINDOW,
  type AdminMetricsScope,
  type AdminWorkspacesKind,
  type AdminWorkspacesQuery,
  adminMetricsScope,
  adminUsersSearch,
  adminWorkspacesKind,
} from "@repo/features/admin-wire";
import { Clock, Effect } from "effect";
import { ADMIN_REFUSAL, type AdminRefusal } from "./http-effect.js";
import { type AdminSeamEffect, unavailableSeam } from "./seam.js";

export const ADMIN_WORKSPACES_LIMIT = 200;

export const ADMIN_WORKSPACES_ACTIVITY_DAYS = ADMIN_METRICS_WINDOW.WEEK;

export const INVITATION_STATUS = {
  PENDING: "pending",
  ACCEPTED: "accepted",
} as const;

type AdminWorkspaceSourceRow = Omit<AdminWorkspaceRow, "owner" | "installations">;

export interface AdminWorkspaceListSource {
  total: number;
  rows: readonly AdminWorkspaceSourceRow[];
  owners: readonly { organizationId: string; owner: AdminWorkspaceOwner }[];
  installations: readonly { organizationId: string; installation: AdminWorkspaceInstallation }[];
  summary: {
    shared: number;
    sharedActiveWeek: number;
    sharedWithActive: number;
    sharedWithSuspended: number;
    invitations: readonly { status: string; count: number; pastExpiry: number }[];
  };
}

function ratio(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

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

function invitationSummary(
  counts: AdminWorkspaceListSource["summary"]["invitations"],
): AdminWorkspaceSummary["invitations"] {
  let accepted = 0;
  let pending = 0;
  let expired = 0;
  let settled = 0;
  for (const { status, count, pastExpiry } of counts) {
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

export function buildAdminWorkspaceList(
  source: AdminWorkspaceListSource,
  now: number,
  kind: AdminWorkspacesKind,
  search: string | undefined,
): AdminWorkspaceList {
  const owners = byWorkspace(source.owners, (row) => row.owner);
  const installations = byWorkspace(source.installations, (row) => row.installation);
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
