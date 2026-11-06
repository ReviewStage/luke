import type {
  AdminDayDetail,
  AdminMetrics,
  AdminReliability,
  AdminUserDetail,
  AdminUserList,
  AdminWorkspaceDetail,
  AdminWorkspaceList,
} from "@repo/features/admin-answer-wire";
import type { AdminCost } from "@repo/features/admin-cost-wire";
import type {
  AdminDayQuery,
  AdminRefused,
  AdminUserQuery,
  AdminUsersQuery,
  AdminWindowedQuery,
  AdminWorkspaceQuery,
  AdminWorkspacesQuery,
} from "@repo/features/admin-wire";
import { createContext, useContext } from "react";

export class AdminReadRefused extends Error {
  constructor(readonly refused: AdminRefused) {
    super(`The admin read was refused: ${refused}.`);
    this.name = "AdminReadRefused";
  }
}

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
  readonly workspace: (
    query: AdminWorkspaceQuery,
    signal: AbortSignal,
  ) => Promise<AdminWorkspaceDetail>;
  readonly favorite: (id: string, favorite: boolean) => Promise<boolean>;
}

interface AdminGate {
  readonly heldAtGate: () => boolean;
  readonly signedOut: () => React.JSX.Element;
  readonly forbidden: (props: {
    email: string | undefined;
    onSignOut: () => void;
  }) => React.JSX.Element;
}

interface AdminAddress {
  readonly accountHref: (id: string) => string | undefined;
  readonly workspaceHref: (id: string) => string | undefined;
  readonly search: () => string;
  readonly keepSearch: (query: string) => void;
  readonly onSearchMoved: (listener: () => void) => () => void;
}

export interface AdminDoors {
  readonly reads: AdminReads;
  readonly gate: AdminGate;
  readonly address: AdminAddress;
  readonly impersonate?: (userId: string) => Promise<string | undefined>;
}

const AdminDoorsContext = createContext<AdminDoors | undefined>(undefined);

export const AdminDoorsProvider = AdminDoorsContext.Provider;

export function useAdminDoorsIfAny(): AdminDoors | undefined {
  return useContext(AdminDoorsContext);
}

export function useAdminDoors(): AdminDoors {
  const doors = useContext(AdminDoorsContext);
  if (doors === undefined)
    throw new Error("An admin screen was drawn with no AdminDoorsProvider above it.");
  return doors;
}
