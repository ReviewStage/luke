import { type HttpApp, HttpRouter } from "@effect/platform";
import { Effect } from "effect";
import type { AdminViewer } from "./admin/admin-access.js";
import { type AdminDayOptions, handleAdminDay } from "./admin/admin-day.js";
import { type AdminFavoriteOptions, handleAdminFavorite } from "./admin/admin-favorite.js";
import { type AdminMetricsOptions, handleAdminMetrics } from "./admin/admin-metrics.js";
import { type AdminUserOptions, handleAdminUser } from "./admin/admin-user.js";
import { type AdminUsersOptions, handleAdminUsers } from "./admin/admin-users.js";
import { adminViewerGate } from "./admin/gate.js";
import { ADMIN_ROUTE_PATH } from "./admin/http.js";
import { ADMIN_REFUSAL, adminRefusalResponse } from "./admin/http-effect.js";

/**
 * The dashboard as the one route group its five functions serve: four reads
 * and the Users tab's one star write. Each is its own function and the group
 * declares all five, so a function answers its own address and the admin
 * vocabulary's `not-found` anywhere else.
 *
 * What the group owns is the gate, in the order the pages depend on: a method
 * this address does not answer is a 405 before a session is even looked for,
 * an auth seam that throws is a 503 rather than a crash, an anonymous request
 * is a 401 the page answers with a sign-in, and a signed-in non-admin is a 403
 * the page answers with a plain refusal. A read runs only for a viewer past
 * all four, so no read restates any of them, and each read still answers for
 * its own parameters and its own body — the group carries that answer
 * unchanged.
 */

/** What the group is handed that the deployment alone can answer for. */
export interface AdminSeams {
  /** The browser session the request rides in on; a throw is an outage, never a sign-out. */
  resolveViewer: (request: Request) => Promise<AdminViewer | undefined>;
  readMetrics: AdminMetricsOptions["readMetrics"];
  readUsers: AdminUsersOptions["readUsers"];
  readUser: AdminUserOptions["readUser"];
  readDay: AdminDayOptions["readDay"];
  writeFavorite: AdminFavoriteOptions["writeFavorite"];
}

const READ_METHOD = ["GET"] as const;
const FAVORITE_METHODS = ["PUT", "DELETE"] as const;

/** One address of the group, behind the gate it declares its methods to. */
function gate(
  seams: AdminSeams,
  methods: readonly string[],
  handler: (viewer: AdminViewer, request: Request) => Promise<Response>,
): HttpApp.Default {
  return adminViewerGate({ methods, resolveViewer: seams.resolveViewer, handler });
}

/** The group, which is the dashboard's five addresses and the refusal anywhere else. */
export function adminApp(seams: AdminSeams): HttpApp.Default {
  return HttpRouter.empty.pipe(
    HttpRouter.all(
      ADMIN_ROUTE_PATH.METRICS,
      gate(seams, READ_METHOD, (_viewer, request) =>
        handleAdminMetrics({ request, readMetrics: seams.readMetrics }),
      ),
    ),
    HttpRouter.all(
      ADMIN_ROUTE_PATH.USERS,
      gate(seams, READ_METHOD, (viewer, request) =>
        handleAdminUsers({ request, viewer, readUsers: seams.readUsers }),
      ),
    ),
    HttpRouter.all(
      ADMIN_ROUTE_PATH.USER,
      gate(seams, READ_METHOD, (_viewer, request) =>
        handleAdminUser({ request, readUser: seams.readUser }),
      ),
    ),
    HttpRouter.all(
      ADMIN_ROUTE_PATH.DAY,
      gate(seams, READ_METHOD, (_viewer, request) =>
        handleAdminDay({ request, readDay: seams.readDay }),
      ),
    ),
    HttpRouter.all(
      ADMIN_ROUTE_PATH.FAVORITE,
      gate(seams, FAVORITE_METHODS, (viewer, request) =>
        handleAdminFavorite({ request, viewer, writeFavorite: seams.writeFavorite }),
      ),
    ),
    Effect.catchTag("RouteNotFound", () =>
      Effect.succeed(adminRefusalResponse(ADMIN_REFUSAL.NOT_FOUND)),
    ),
  );
}
