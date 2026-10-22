/**
 * admin-procedures.ts -- the admin dashboard's reads and its one star write, as one hosted resource.
 *
 * The reads answer the dashboard's screens (metrics, cost, reliability, the
 * roster, one account, one day, and the workspaces); the write is the Users
 * tab's star, PUT to set it and DELETE to take it back. Each answers for its
 * own query and its own refusals (`admin-*.ts`) and is answered as it was
 * built, the bytes the old group wrote.
 *
 * What the resource owns is the gate (`gate.ts`), on its implementer rather
 * than on each procedure, so it runs before oRPC reads the input, as the old
 * group resolved the viewer before it read a query: an auth seam that fails
 * is a 503, an anonymous request a 401 the page answers with a sign-in, and a
 * signed-in non-admin a 403 the page answers with a plain refusal. A method
 * an address does not answer is the handler's 405 before any of them.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { hosted } from "../orpc/base.js";
import type { ModelCatalog } from "../providers/model-catalog.js";
import { type AdminCostOptions, handleAdminCost } from "./admin-cost.js";
import { type AdminDayOptions, handleAdminDay } from "./admin-day.js";
import { type AdminFavoriteOptions, handleAdminFavorite } from "./admin-favorite.js";
import { type AdminMetricsOptions, handleAdminMetrics } from "./admin-metrics.js";
import { type AdminReliabilityOptions, handleAdminReliability } from "./admin-reliability.js";
import { type AdminUserOptions, handleAdminUser } from "./admin-user.js";
import { type AdminUsersOptions, handleAdminUsers } from "./admin-users.js";
import { type AdminWorkspacesOptions, handleAdminWorkspaces } from "./admin-workspaces.js";
import { type AdminViewerResolver, adminGateMiddleware } from "./gate.js";

/** What the resource is handed that the deployment alone can answer for. */
export interface AdminProcedureSeams {
  /** The browser session the request rides in on; a refusal is an outage, never a sign-out. */
  resolveViewer: AdminViewerResolver;
  readMetrics: AdminMetricsOptions["readMetrics"];
  /** The Cost screen's read, which prices at the model catalog the instance holds. */
  readCost: AdminCostOptions<DatabaseServices | ModelCatalog>["readCost"];
  readUsers: AdminUsersOptions["readUsers"];
  readUser: AdminUserOptions["readUser"];
  readDay: AdminDayOptions["readDay"];
  readWorkspaces: AdminWorkspacesOptions["readWorkspaces"];
  readReliability: AdminReliabilityOptions["readReliability"];
  writeFavorite: AdminFavoriteOptions["writeFavorite"];
}

export function adminProcedures(seams: AdminProcedureSeams) {
  const gated = hosted.admin.use(adminGateMiddleware(seams.resolveViewer));
  return {
    cost: gated.cost.effect(function* ({ input }) {
      return yield* handleAdminCost({ query: input, readCost: seams.readCost });
    }),
    day: gated.day.effect(function* ({ input }) {
      return yield* handleAdminDay({ query: input, readDay: seams.readDay });
    }),
    favorite: gated.favorite.effect(function* ({ context, input }) {
      return yield* handleAdminFavorite({
        favorite: true,
        query: input.query,
        viewer: context.viewer,
        writeFavorite: seams.writeFavorite,
      });
    }),
    metrics: gated.metrics.effect(function* ({ input }) {
      return yield* handleAdminMetrics({ query: input, readMetrics: seams.readMetrics });
    }),
    reliability: gated.reliability.effect(function* ({ input }) {
      return yield* handleAdminReliability({
        query: input,
        readReliability: seams.readReliability,
      });
    }),
    unfavorite: gated.unfavorite.effect(function* ({ context, input }) {
      return yield* handleAdminFavorite({
        favorite: false,
        query: input.query,
        viewer: context.viewer,
        writeFavorite: seams.writeFavorite,
      });
    }),
    user: gated.user.effect(function* ({ input }) {
      return yield* handleAdminUser({ query: input, readUser: seams.readUser });
    }),
    users: gated.users.effect(function* ({ context, input }) {
      return yield* handleAdminUsers({
        query: input,
        viewer: context.viewer,
        readUsers: seams.readUsers,
      });
    }),
    workspaces: gated.workspaces.effect(function* ({ input }) {
      return yield* handleAdminWorkspaces({ query: input, readWorkspaces: seams.readWorkspaces });
    }),
  };
}
