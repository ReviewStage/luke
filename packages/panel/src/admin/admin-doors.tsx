import type {
  AdminDayDetail,
  AdminMetrics,
  AdminReliability,
  AdminUserDetail,
  AdminUserList,
  AdminWorkspaceList,
} from "@luke/features/admin-answer-wire";
import type { AdminCost } from "@luke/features/admin-cost-wire";
import type {
  AdminDayQuery,
  AdminRefused,
  AdminUserQuery,
  AdminUsersQuery,
  AdminWindowedQuery,
  AdminWorkspacesQuery,
} from "@luke/features/admin-wire";
import { createContext, useContext } from "react";

/**
 * admin-doors.tsx -- what the admin screens reach through the shell that mounts them: the service's admin reads and its one write, and the gate's own words.
 *
 * The screens are the panel's, mounted by the web's standalone `/admin` page
 * and by the app's Admin place, and each mount reaches the service its own
 * way: the page under the browser's session cookie, the app through its host.
 * So the screens name no client. A mount hands its doors in through
 * `AdminDoorsProvider`, and a screen reads them with `useAdminDoors` at the
 * moment it reads or writes.
 */

/** A read the mount's client refused, by the word the screens tell it apart by (`ADMIN_REFUSED`). */
export class AdminReadRefused extends Error {
  constructor(readonly refused: AdminRefused) {
    super(`The admin read was refused: ${refused}.`);
    this.name = "AdminReadRefused";
  }
}

/**
 * The service's admin reads and its one write, each under the signal its
 * screen aborts it with. A read answers its procedure's answer, or rejects;
 * a rejection that is no `AdminReadRefused` is the screen's own failure.
 * The write answers whether it landed and never rejects.
 */
export interface AdminReads {
  readonly metrics: (query: AdminWindowedQuery, signal: AbortSignal) => Promise<AdminMetrics>;
  readonly cost: (query: AdminWindowedQuery, signal: AbortSignal) => Promise<AdminCost>;
  readonly reliability: (
    query: AdminWindowedQuery,
    signal: AbortSignal,
  ) => Promise<AdminReliability>;
  readonly users: (query: AdminUsersQuery, signal: AbortSignal) => Promise<AdminUserList>;
  readonly user: (query: AdminUserQuery, signal: AbortSignal) => Promise<AdminUserDetail>;
  readonly day: (query: AdminDayQuery, signal: AbortSignal) => Promise<AdminDayDetail>;
  readonly workspaces: (
    query: AdminWorkspacesQuery,
    signal: AbortSignal,
  ) => Promise<AdminWorkspaceList>;
  readonly favorite: (id: string, favorite: boolean, signal: AbortSignal) => Promise<boolean>;
}

/** What a screen draws in its place where the gate refused it, in the mount's own words. */
interface AdminGate {
  /**
   * Whether the mount already knows no read can pass the gate, so a screen
   * shows the sign-in from its first frame rather than a read nobody sent.
   */
  readonly heldAtGate: () => boolean;
  readonly signedOut: () => React.JSX.Element;
  readonly forbidden: (props: {
    email: string | undefined;
    onSignOut: () => void;
  }) => React.JSX.Element;
}

export interface AdminDoors {
  readonly reads: AdminReads;
  readonly gate: AdminGate;
}

const AdminDoorsContext = createContext<AdminDoors | undefined>(undefined);

/** Hands a mount's doors to every admin screen under it. */
export const AdminDoorsProvider = AdminDoorsContext.Provider;

/** The doors the mount above handed in; a screen drawn under none is a wiring fault. */
export function useAdminDoors(): AdminDoors {
  const doors = useContext(AdminDoorsContext);
  if (doors === undefined)
    throw new Error("An admin screen was drawn with no AdminDoorsProvider above it.");
  return doors;
}
