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
import {
  ADMIN_HTTP_STATUS,
  ADMIN_REFUSED,
  ADMIN_USER_ID_PARAM,
  type AdminRefused,
} from "@repo/features/admin-wire";
import {
  BrowserRedirected,
  browserClient,
  browserRefusal,
} from "@repo/features/contract/browser-client";
import {
  type AdminDoors,
  AdminDoorsProvider,
  AdminReadRefused,
  type AdminReads,
} from "@repo/panel/admin/admin-doors";
import { SIGN_IN_CHOSEN } from "@repo/panel/admin/prefs";
import {
  accountHref,
  searchFromLocation,
  searchHref,
  workspaceHref,
} from "@repo/panel/admin/routing";
import { impersonate } from "../auth-client";
import { ForbiddenCard, SignInCard } from "./chrome/gate-cards";

const REFUSED_BY_STATUS: ReadonlyMap<number, AdminRefused> = new Map([
  [ADMIN_HTTP_STATUS.UNAUTHORIZED, ADMIN_REFUSED.SIGNED_OUT],
  [ADMIN_HTTP_STATUS.FORBIDDEN, ADMIN_REFUSED.FORBIDDEN],
  [ADMIN_HTTP_STATUS.NOT_FOUND, ADMIN_REFUSED.MISSING],
  [ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE, ADMIN_REFUSED.UNAVAILABLE],
]);

async function asked<T>(read: () => Promise<unknown>): Promise<T> {
  try {
    return (await read()) as T;
  } catch (cause) {
    if (cause instanceof BrowserRedirected) throw new AdminReadRefused(ADMIN_REFUSED.INTERCEPTED);
    const status = browserRefusal(cause)?.status;
    const refused = status === undefined ? undefined : REFUSED_BY_STATUS.get(status);
    if (refused !== undefined) throw new AdminReadRefused(refused);
    throw cause;
  }
}

const WEB_ADMIN_READS: AdminReads = {
  metrics: (query, signal) =>
    asked<AdminMetrics>(() => browserClient.admin.metrics(query, { signal })),
  cost: (query, signal) => asked<AdminCost>(() => browserClient.admin.cost(query, { signal })),
  reliability: (query, signal) =>
    asked<AdminReliability>(() => browserClient.admin.reliability(query, { signal })),
  users: (query, signal) =>
    asked<AdminUserList>(() => browserClient.admin.users(query, { signal })),
  user: (query, signal) =>
    asked<AdminUserDetail>(() => browserClient.admin.user(query, { signal })),
  day: (query, signal) => asked<AdminDayDetail>(() => browserClient.admin.day(query, { signal })),
  workspaces: (query, signal) =>
    asked<AdminWorkspaceList>(() => browserClient.admin.workspaces(query, { signal })),
  workspace: (query, signal) =>
    asked<AdminWorkspaceDetail>(() => browserClient.admin.workspace(query, { signal })),
  favorite: (id, favorite) => {
    const input = { query: { [ADMIN_USER_ID_PARAM]: id } };
    const write = favorite ? browserClient.admin.favorite : browserClient.admin.unfavorite;
    return write(input).then(
      () => true,
      () => false,
    );
  },
};

const WEB_ADMIN_DOORS: AdminDoors = {
  reads: WEB_ADMIN_READS,
  gate: {
    heldAtGate: () => !SIGN_IN_CHOSEN.read(),
    signedOut: () => <SignInCard />,
    forbidden: ({ email, onSignOut }) => <ForbiddenCard email={email} onSignOut={onSignOut} />,
  },
  address: {
    accountHref,
    workspaceHref,
    search: searchFromLocation,
    keepSearch: (query) => window.history.replaceState(null, "", searchHref(query)),
    onSearchMoved: (listener) => {
      window.addEventListener("popstate", listener);
      return () => window.removeEventListener("popstate", listener);
    },
  },
  impersonate,
};

export function WebAdminDoors({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <AdminDoorsProvider value={WEB_ADMIN_DOORS}>{children}</AdminDoorsProvider>;
}
