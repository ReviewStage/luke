import type { ErrorMapItem } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { ADMIN_ERROR, ADMIN_QUERY, ADMIN_ROUTE_PATH, type AdminError } from "../admin-wire.js";
import { hostedProcedure } from "./base.js";

const ADMIN_ERRORS = {
  [ADMIN_ERROR.NOT_SIGNED_IN]: {},
  [ADMIN_ERROR.NOT_AUTHORIZED]: {},
  [ADMIN_ERROR.METHOD_NOT_ALLOWED]: {},
  [ADMIN_ERROR.MISSING_USER_ID]: {},
  [ADMIN_ERROR.INVALID_WINDOW]: {},
  [ADMIN_ERROR.INVALID_SEARCH]: {},
  [ADMIN_ERROR.INVALID_DAY]: {},
  [ADMIN_ERROR.USER_NOT_FOUND]: {},
  [ADMIN_ERROR.MISSING_WORKSPACE_ID]: {},
  [ADMIN_ERROR.WORKSPACE_NOT_FOUND]: {},
  [ADMIN_ERROR.NOT_FOUND]: {},
  [ADMIN_ERROR.UNAVAILABLE]: {},
} as const satisfies Record<AdminError, ErrorMapItem>;

const adminProcedure = hostedProcedure.errors(ADMIN_ERRORS);

const parameter = EffectSchema.optionalKey(EffectSchema.String);

const windowedQuerySchema = EffectSchema.Struct({
  [ADMIN_QUERY.SCOPE]: parameter,
  [ADMIN_QUERY.WINDOW]: parameter,
});

const usersQuerySchema = EffectSchema.Struct({
  [ADMIN_QUERY.SCOPE]: parameter,
  [ADMIN_QUERY.WINDOW]: parameter,
  [ADMIN_QUERY.SEARCH]: parameter,
});

const userQuerySchema = EffectSchema.Struct({
  [ADMIN_QUERY.USER_ID]: parameter,
  [ADMIN_QUERY.WINDOW]: parameter,
});

const dayQuerySchema = EffectSchema.Struct({
  [ADMIN_QUERY.DAY]: parameter,
  [ADMIN_QUERY.SCOPE]: parameter,
});

const workspaceQuerySchema = EffectSchema.Struct({
  [ADMIN_QUERY.WORKSPACE_ID]: parameter,
});

const workspacesQuerySchema = EffectSchema.Struct({
  [ADMIN_QUERY.SCOPE]: parameter,
  [ADMIN_QUERY.KIND]: parameter,
  [ADMIN_QUERY.SEARCH]: parameter,
});

const favoriteInputSchema = EffectSchema.Struct({
  query: EffectSchema.Struct({ [ADMIN_QUERY.USER_ID]: parameter }),
});

const read = (path: (typeof ADMIN_ROUTE_PATH)[keyof typeof ADMIN_ROUTE_PATH]) =>
  adminProcedure.meta(openapi({ method: HTTP_METHOD.GET, path }));

const favorite = (method: typeof HTTP_METHOD.PUT | typeof HTTP_METHOD.DELETE) =>
  adminProcedure
    .meta(openapi({ method, path: ADMIN_ROUTE_PATH.FAVORITE, inputStructure: "detailed" }))
    .input(favoriteInputSchema);

export const adminContract = {
  cost: read(ADMIN_ROUTE_PATH.COST).input(windowedQuerySchema),
  day: read(ADMIN_ROUTE_PATH.DAY).input(dayQuerySchema),
  favorite: favorite(HTTP_METHOD.PUT),
  metrics: read(ADMIN_ROUTE_PATH.METRICS).input(windowedQuerySchema),
  reliability: read(ADMIN_ROUTE_PATH.RELIABILITY).input(windowedQuerySchema),
  unfavorite: favorite(HTTP_METHOD.DELETE),
  user: read(ADMIN_ROUTE_PATH.USER).input(userQuerySchema),
  users: read(ADMIN_ROUTE_PATH.USERS).input(usersQuerySchema),
  workspace: read(ADMIN_ROUTE_PATH.WORKSPACE).input(workspaceQuerySchema),
  workspaces: read(ADMIN_ROUTE_PATH.WORKSPACES).input(workspacesQuerySchema),
};
