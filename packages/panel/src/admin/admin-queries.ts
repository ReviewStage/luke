import type { AdminUserList } from "@repo/features/admin-answer-wire";
import {
  ADMIN_READ,
  type AdminDayQuery,
  type AdminUserQuery,
  type AdminUsersQuery,
  type AdminWindowedQuery,
  type AdminWorkspaceQuery,
  type AdminWorkspacesQuery,
} from "@repo/features/admin-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { STATUS_TONE } from "@repo/ui";
import { keepPreviousData, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { QUERY_ROOT } from "../query-keys.js";
import { showToast, TOAST_HOLD } from "../toast.js";
import type { AdminReads } from "./admin-doors.js";

const ADMIN_WRITE = {
  FAVORITE: "favorite",
  SIGN_OUT: "sign-out",
} as const;

const FAVORITE_FAILED = "The favorite could not be saved. Try again.";

const ADMIN_READ_OPTIONS = { retry: false } as const;

export function adminMetricsQuery(reads: AdminReads, query: AdminWindowedQuery) {
  return queryOptions({
    queryKey: [QUERY_ROOT.ADMIN, ADMIN_READ.METRICS, query.scope, query.window],
    queryFn: ({ signal }) => reads.metrics(query, signal),
    placeholderData: keepPreviousData,
    ...ADMIN_READ_OPTIONS,
  });
}

export function adminCostQuery(reads: AdminReads, query: AdminWindowedQuery) {
  return queryOptions({
    queryKey: [QUERY_ROOT.ADMIN, ADMIN_READ.COST, query.scope, query.window],
    queryFn: ({ signal }) => reads.cost(query, signal),
    placeholderData: keepPreviousData,
    ...ADMIN_READ_OPTIONS,
  });
}

export function adminReliabilityQuery(reads: AdminReads, query: AdminWindowedQuery) {
  return queryOptions({
    queryKey: [QUERY_ROOT.ADMIN, ADMIN_READ.RELIABILITY, query.scope, query.window],
    queryFn: ({ signal }) => reads.reliability(query, signal),
    placeholderData: keepPreviousData,
    ...ADMIN_READ_OPTIONS,
  });
}

export function adminUsersQuery(reads: AdminReads, query: AdminUsersQuery) {
  return queryOptions({
    queryKey: [QUERY_ROOT.ADMIN, ADMIN_READ.USERS, query.scope, query.window, query.search],
    queryFn: ({ signal }) => reads.users(query, signal),
    placeholderData: keepPreviousData,
    ...ADMIN_READ_OPTIONS,
  });
}

export function adminWorkspacesQuery(reads: AdminReads, query: AdminWorkspacesQuery) {
  return queryOptions({
    queryKey: [QUERY_ROOT.ADMIN, ADMIN_READ.WORKSPACES, query.scope, query.kind, query.search],
    queryFn: ({ signal }) => reads.workspaces(query, signal),
    placeholderData: keepPreviousData,
    ...ADMIN_READ_OPTIONS,
  });
}

export function adminUserQuery(reads: AdminReads, query: AdminUserQuery) {
  return queryOptions({
    queryKey: [QUERY_ROOT.ADMIN, ADMIN_READ.USER, query.id, query.window],
    queryFn: ({ signal }) => reads.user(query, signal),
    placeholderData: (shown) => (shown?.account.id === query.id ? shown : undefined),
    ...ADMIN_READ_OPTIONS,
  });
}

export function adminWorkspaceQuery(reads: AdminReads, query: AdminWorkspaceQuery) {
  return queryOptions({
    queryKey: [QUERY_ROOT.ADMIN, ADMIN_READ.WORKSPACE, query.id],
    queryFn: ({ signal }) => reads.workspace(query, signal),
    placeholderData: (shown) => (shown?.workspace.id === query.id ? shown : undefined),
    ...ADMIN_READ_OPTIONS,
  });
}

export function adminDayQuery(reads: AdminReads, query: AdminDayQuery) {
  return queryOptions({
    queryKey: [QUERY_ROOT.ADMIN, ADMIN_READ.DAY, query.date, query.scope],
    queryFn: ({ signal }) => reads.day(query, signal),
    placeholderData: (shown) => (shown?.day === query.date ? shown : undefined),
    ...ADMIN_READ_OPTIONS,
  });
}

interface FavoritePress {
  readonly id: string;
  readonly favorite: boolean;
}

function pressOf(variables: unknown, id: string): boolean {
  return (
    typeof variables === "object" && variables !== null && "id" in variables && variables.id === id
  );
}

export function useFavoriteMutation(reads: AdminReads) {
  const queryClient = useQueryClient();
  const rosters = { queryKey: [QUERY_ROOT.ADMIN, ADMIN_READ.USERS] };
  const mutationKey = [QUERY_ROOT.ADMIN, ADMIN_WRITE.FAVORITE];
  const draw = ({ id, favorite }: FavoritePress) =>
    queryClient.setQueriesData<AdminUserList>(rosters, (list) =>
      list === undefined
        ? undefined
        : { ...list, rows: list.rows.map((row) => (row.id === id ? { ...row, favorite } : row)) },
    );
  return useMutation({
    mutationKey,
    scope: { id: ADMIN_WRITE.FAVORITE },
    mutationFn: async (press: FavoritePress) => {
      if (!(await reads.favorite(press.id, press.favorite)))
        throw new Error("The favorite was not saved.");
    },
    onMutate: async (press) => {
      await queryClient.cancelQueries(rosters);
      draw(press);
    },
    onSuccess: (_, press) => draw(press),
    onError: (cause, press) => {
      showToast({
        words: FAVORITE_FAILED,
        tone: STATUS_TONE.DANGER,
        hold: TOAST_HOLD.FAILED,
        failure: { surface: FAILURE_SURFACE.ADMIN_WRITE, cause },
      });
      const newer = queryClient.isMutating({
        mutationKey,
        predicate: (mutation) => pressOf(mutation.state.variables, press.id),
      });
      if (newer <= 1) draw({ ...press, favorite: !press.favorite });
    },
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey }) <= 1) void queryClient.invalidateQueries(rosters);
    },
  });
}

export function useAdminSignOut(signOut: () => Promise<void>) {
  const queryClient = useQueryClient();
  const reads = { queryKey: [QUERY_ROOT.ADMIN] };
  return useMutation({
    mutationKey: [QUERY_ROOT.ADMIN, ADMIN_WRITE.SIGN_OUT],
    mutationFn: async () => {
      await queryClient.cancelQueries(reads);
      await signOut();
    },
    onSuccess: () => queryClient.resetQueries(reads),
  });
}
