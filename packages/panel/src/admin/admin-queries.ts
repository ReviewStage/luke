/**
 * admin-queries.ts -- the admin screens' reads as `queryOptions` factories, and their two writes, the star and the sign-out, as mutations.
 *
 * A read's key is `[QUERY_ROOT.ADMIN, <procedure>, ...its query's fields]`,
 * each field its own element in a fixed order, so two screens asking the
 * same question share one entry and a changed field is another. Its
 * `queryFn` asks the mount's door (`admin-doors.tsx`) under the signal Query
 * hands it, and a refusal of the gate rejects as `AdminReadRefused`, the
 * error the screens tell apart by `instanceof` (`admin-read-view.tsx`).
 *
 * A read is never tried again by itself (`retry: false`), as a read always
 * failed at once, and a question changed under a shown answer keeps that
 * answer up while the next is read (`placeholderData`), as the Paginated
 * Queries guide keeps a page: a detail screen keeps it only for the same
 * subject, since the browser's own back and forward can swap the subject
 * under it, and one subject's numbers must not stand behind another's read.
 */

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

/** The admin writes, each a mutation key's second element. */
const ADMIN_WRITE = {
  FAVORITE: "favorite",
  SIGN_OUT: "sign-out",
} as const;

/** What a toast says when the star's write did not land. */
const FAVORITE_FAILED = "The favorite could not be saved. Try again.";

/** What every admin read asks of Query beside its key and its door. */
const ADMIN_READ_OPTIONS = { retry: false } as const;

/** The overview's read. */
export function adminMetricsQuery(reads: AdminReads, query: AdminWindowedQuery) {
  return queryOptions({
    queryKey: [QUERY_ROOT.ADMIN, ADMIN_READ.METRICS, query.scope, query.window],
    queryFn: ({ signal }) => reads.metrics(query, signal),
    placeholderData: keepPreviousData,
    ...ADMIN_READ_OPTIONS,
  });
}

/** The Cost page's read. */
export function adminCostQuery(reads: AdminReads, query: AdminWindowedQuery) {
  return queryOptions({
    queryKey: [QUERY_ROOT.ADMIN, ADMIN_READ.COST, query.scope, query.window],
    queryFn: ({ signal }) => reads.cost(query, signal),
    placeholderData: keepPreviousData,
    ...ADMIN_READ_OPTIONS,
  });
}

/** The Reliability page's read. */
export function adminReliabilityQuery(reads: AdminReads, query: AdminWindowedQuery) {
  return queryOptions({
    queryKey: [QUERY_ROOT.ADMIN, ADMIN_READ.RELIABILITY, query.scope, query.window],
    queryFn: ({ signal }) => reads.reliability(query, signal),
    placeholderData: keepPreviousData,
    ...ADMIN_READ_OPTIONS,
  });
}

/** The roster's read, which the star writes into. */
export function adminUsersQuery(reads: AdminReads, query: AdminUsersQuery) {
  return queryOptions({
    queryKey: [QUERY_ROOT.ADMIN, ADMIN_READ.USERS, query.scope, query.window, query.search],
    queryFn: ({ signal }) => reads.users(query, signal),
    placeholderData: keepPreviousData,
    ...ADMIN_READ_OPTIONS,
  });
}

/** The Workspaces page's read. */
export function adminWorkspacesQuery(reads: AdminReads, query: AdminWorkspacesQuery) {
  return queryOptions({
    queryKey: [QUERY_ROOT.ADMIN, ADMIN_READ.WORKSPACES, query.scope, query.kind, query.search],
    queryFn: ({ signal }) => reads.workspaces(query, signal),
    placeholderData: keepPreviousData,
    ...ADMIN_READ_OPTIONS,
  });
}

/** One account's read, keeping a shown answer only while it is that account's. */
export function adminUserQuery(reads: AdminReads, query: AdminUserQuery) {
  return queryOptions({
    queryKey: [QUERY_ROOT.ADMIN, ADMIN_READ.USER, query.id, query.window],
    queryFn: ({ signal }) => reads.user(query, signal),
    placeholderData: (shown) => (shown?.account.id === query.id ? shown : undefined),
    ...ADMIN_READ_OPTIONS,
  });
}

/** One workspace's read, keeping a shown answer only while it is that workspace's. */
export function adminWorkspaceQuery(reads: AdminReads, query: AdminWorkspaceQuery) {
  return queryOptions({
    queryKey: [QUERY_ROOT.ADMIN, ADMIN_READ.WORKSPACE, query.id],
    queryFn: ({ signal }) => reads.workspace(query, signal),
    placeholderData: (shown) => (shown?.workspace.id === query.id ? shown : undefined),
    ...ADMIN_READ_OPTIONS,
  });
}

/** One day's read, keeping a shown answer only while it is that day's. */
export function adminDayQuery(reads: AdminReads, query: AdminDayQuery) {
  return queryOptions({
    queryKey: [QUERY_ROOT.ADMIN, ADMIN_READ.DAY, query.date, query.scope],
    queryFn: ({ signal }) => reads.day(query, signal),
    placeholderData: (shown) => (shown?.day === query.date ? shown : undefined),
    ...ADMIN_READ_OPTIONS,
  });
}

/** One press of an account's star. */
interface FavoritePress {
  readonly id: string;
  readonly favorite: boolean;
}

/** Whether a mutation's variables are a press of the star of account `id`. */
function pressOf(variables: unknown, id: string): boolean {
  return (
    typeof variables === "object" && variables !== null && "id" in variables && variables.id === id
  );
}

/**
 * The star's write: the press draws at once in every roster held (the
 * Optimistic Updates guide's cache form), the landed write draws its own
 * outcome, so a roster read that crossed it cannot leave a stale star, and
 * a refusal says so in a toast and puts the old value back unless a newer
 * press of the same star is still out. The presses share one scope, so they
 * reach the service in the order they were made, and once the last settles
 * the rosters are read again, as the guide invalidates them.
 */
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
      // Note that this press is still counted while its onError runs.
      const newer = queryClient.isMutating({
        mutationKey,
        predicate: (mutation) => pressOf(mutation.state.variables, press.id),
      });
      if (newer <= 1) draw({ ...press, favorite: !press.favorite });
    },
    // Note that the rosters are read again once the last press of any star
    // settles, since `onMutate` canceled whatever roster read was out (a
    // search's among them), and a refetch while another press is out would
    // overwrite its star.
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey }) <= 1) void queryClient.invalidateQueries(rosters);
    },
  });
}

/**
 * The sign-out: every admin read out is canceled first, since an answer
 * that left carrying the old cookie would otherwise land behind the
 * sign-out, then `signOut` withdraws the session, and the admin reads are
 * reset, so no answer stands in front of a consent just withdrawn. A refused
 * sign-out rejects and leaves the answers up.
 */
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
