/**
 * admin.ts -- the admin dashboard's reads and its one star write, as one resource (`admin-wire.ts`).
 *
 * Every procedure declares the dashboard's own refusals beside the hosted
 * ones, since the gate answers in the dashboard's vocabulary. Each read takes
 * its query as its input, every parameter optional text: which values a
 * parameter may carry is the handler's to say, with the refusal the page
 * words for it (`invalid-window`, `invalid-search`, ...), as the old group
 * said it, so the schema checks only that each is one value. A key named more
 * than once reaches the schema as a list and is refused as an invalid request.
 *
 * The star is one address under two methods, PUT to set it and DELETE to take
 * it back, each naming the account in its query; the input is read
 * `detailed`, since a PUT's compact input would be its body.
 *
 * The answers declare no output schema: the dashboard's answers are typed
 * where the service builds them (`@luke/service/admin/*`), which this package
 * cannot import, and they are written as the handler returns them, the bytes
 * the old group wrote.
 */

import { HTTP_METHOD } from "@luke/wire";
import type { ErrorMapItem } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { ADMIN_ERROR, ADMIN_QUERY, ADMIN_ROUTE_PATH, type AdminError } from "../admin-wire.js";
import { hostedProcedure } from "./base.js";

/** Every refusal an admin procedure may answer, the slug its code. */
const ADMIN_ERRORS = {
  [ADMIN_ERROR.NOT_SIGNED_IN]: {},
  [ADMIN_ERROR.NOT_AUTHORIZED]: {},
  [ADMIN_ERROR.METHOD_NOT_ALLOWED]: {},
  [ADMIN_ERROR.MISSING_USER_ID]: {},
  [ADMIN_ERROR.INVALID_WINDOW]: {},
  [ADMIN_ERROR.INVALID_SEARCH]: {},
  [ADMIN_ERROR.INVALID_DAY]: {},
  [ADMIN_ERROR.USER_NOT_FOUND]: {},
  [ADMIN_ERROR.NOT_FOUND]: {},
  [ADMIN_ERROR.UNAVAILABLE]: {},
} as const satisfies Record<AdminError, ErrorMapItem>;

const adminProcedure = hostedProcedure.errors(ADMIN_ERRORS);

/** One query parameter: absent, or one value as text. */
const parameter = EffectSchema.optionalKey(EffectSchema.String);

/** A windowed read's query: the scope, the window, and for the roster, the search. */
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

const workspacesQuerySchema = EffectSchema.Struct({
  [ADMIN_QUERY.SCOPE]: parameter,
  [ADMIN_QUERY.KIND]: parameter,
  [ADMIN_QUERY.SEARCH]: parameter,
});

/** The star write's input, read `detailed`: the account it names, in its query. */
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
  workspaces: read(ADMIN_ROUTE_PATH.WORKSPACES).input(workspacesQuerySchema),
};
