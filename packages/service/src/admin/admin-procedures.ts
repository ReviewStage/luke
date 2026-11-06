import type { DatabaseServices } from "@repo/database/core/query";
import { hosted } from "../orpc/base.js";
import type { ModelCatalog } from "../providers/model-catalog.js";
import { type AdminCostOptions, handleAdminCost } from "./admin-cost.js";
import { type AdminDayOptions, handleAdminDay } from "./admin-day.js";
import { type AdminFavoriteOptions, handleAdminFavorite } from "./admin-favorite.js";
import { type AdminMetricsOptions, handleAdminMetrics } from "./admin-metrics.js";
import { type AdminReliabilityOptions, handleAdminReliability } from "./admin-reliability.js";
import { type AdminUserOptions, handleAdminUser } from "./admin-user.js";
import { type AdminUsersOptions, handleAdminUsers } from "./admin-users.js";
import { type AdminWorkspaceOptions, handleAdminWorkspace } from "./admin-workspace.js";
import { type AdminWorkspacesOptions, handleAdminWorkspaces } from "./admin-workspaces.js";
import { type AdminViewerResolver, adminGateMiddleware } from "./gate.js";

export interface AdminProcedureSeams {
  resolveViewer: AdminViewerResolver;
  readMetrics: AdminMetricsOptions["readMetrics"];
  readCost: AdminCostOptions<DatabaseServices | ModelCatalog>["readCost"];
  readUsers: AdminUsersOptions["readUsers"];
  readUser: AdminUserOptions["readUser"];
  readDay: AdminDayOptions["readDay"];
  readWorkspaces: AdminWorkspacesOptions["readWorkspaces"];
  readWorkspace: AdminWorkspaceOptions["readWorkspace"];
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
    workspace: gated.workspace.effect(function* ({ input }) {
      return yield* handleAdminWorkspace({ query: input, readWorkspace: seams.readWorkspace });
    }),
    workspaces: gated.workspaces.effect(function* ({ input }) {
      return yield* handleAdminWorkspaces({ query: input, readWorkspaces: seams.readWorkspaces });
    }),
  };
}
