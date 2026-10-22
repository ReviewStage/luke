/**
 * web-admin-doors.tsx -- the standalone `/admin` page's doors into the admin screens: the service's admin procedures on this page's browser client, under the session cookie, and the page's own sign-in and refusal cards.
 *
 * The screens are the panel's (`@luke/panel/admin/*`) and name no client;
 * this page hands them its own (`admin-doors.tsx`). A refusal is worded
 * here, by its status, as the screens tell it apart, and an answer that came
 * through a redirect is something in front of the service answering, such as
 * a preview's deployment protection. The page keeps an account's page and a
 * typed search in its address bar. Until a sign-in has been pressed on
 * this page once, every read is held at the gate, whatever cookie the
 * browser holds (`SIGN_IN_CHOSEN`).
 */

import type {
  AdminDayDetail,
  AdminMetrics,
  AdminReliability,
  AdminUserDetail,
  AdminUserList,
  AdminWorkspaceList,
} from "@luke/features/admin-answer-wire";
import type { AdminCost } from "@luke/features/admin-cost-wire";
import {
  ADMIN_HTTP_STATUS,
  ADMIN_REFUSED,
  ADMIN_USER_ID_PARAM,
  type AdminRefused,
} from "@luke/features/admin-wire";
import {
  BrowserRedirected,
  browserClient,
  browserRefusal,
} from "@luke/features/contract/browser-client";
import {
  type AdminDoors,
  AdminDoorsProvider,
  AdminReadRefused,
  type AdminReads,
} from "@luke/panel/admin/admin-doors";
import { SIGN_IN_CHOSEN } from "@luke/panel/admin/prefs";
import { accountHref, searchFromLocation, searchHref } from "@luke/panel/admin/routing";
import { ForbiddenCard, SignInCard } from "./chrome/gate-cards";

/** The word the screens tell a refusal apart by, from the status it was answered under. */
const REFUSED_BY_STATUS: ReadonlyMap<number, AdminRefused> = new Map([
  [ADMIN_HTTP_STATUS.UNAUTHORIZED, ADMIN_REFUSED.SIGNED_OUT],
  [ADMIN_HTTP_STATUS.FORBIDDEN, ADMIN_REFUSED.FORBIDDEN],
  [ADMIN_HTTP_STATUS.NOT_FOUND, ADMIN_REFUSED.MISSING],
  [ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE, ADMIN_REFUSED.UNAVAILABLE],
]);

/**
 * One read on the browser client, its refusal worded for the screens; any
 * other failure passes through as it came, as the screen's own.
 */
async function asked<T>(read: () => Promise<unknown>): Promise<T> {
  try {
    // SAFETY: each admin procedure answers the shape `@luke/features/admin-answer-wire` names for it, for which the contract declares no output.
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
  // A refusal of the star did not land, whatever it was.
  favorite: (id, favorite, signal) => {
    const input = { query: { [ADMIN_USER_ID_PARAM]: id } };
    const write = favorite ? browserClient.admin.favorite : browserClient.admin.unfavorite;
    return write(input, { signal }).then(
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
  // The page keeps an account's page and a typed search in its address bar,
  // the search in place, so the back button walks views rather than keystrokes.
  address: {
    accountHref,
    search: searchFromLocation,
    keepSearch: (query) => window.history.replaceState(null, "", searchHref(query)),
    onSearchMoved: (listener) => {
      window.addEventListener("popstate", listener);
      return () => window.removeEventListener("popstate", listener);
    },
  },
};

/** The page's doors, handed to every admin screen under it. */
export function WebAdminDoors({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <AdminDoorsProvider value={WEB_ADMIN_DOORS}>{children}</AdminDoorsProvider>;
}
