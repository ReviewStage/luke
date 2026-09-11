import { HttpApiSchema, HttpServerResponse } from "@effect/platform";
import { Schema } from "effect";
import { ADMIN_ERROR, ADMIN_HTTP_STATUS } from "./http.js";

/**
 * The admin response vocabulary as the schemas the dashboard's route group
 * declares its refusals from, answering the same statuses and the same bytes
 * `server/admin/http.ts` answers with. It stays the admin's own rather than
 * the hosted tier's for the reason that module gives: these slugs are a
 * browser's, not the desktop wire contract's.
 *
 * Every admin answer is viewer-gated account data, refusals included, so each
 * one carries `no-store` exactly as the promise-shaped answers do: a shared
 * machine's browser must never replay one admin's view to whoever sits down
 * next.
 */

const RESPONSE_HEADER = { CACHE_CONTROL: "cache-control" } as const;
const NO_STORE = "no-store";

/** The status each gate refusal is answered with, which is a function of the refusal alone. */
const ADMIN_REFUSAL_STATUS = {
  [ADMIN_ERROR.METHOD_NOT_ALLOWED]: ADMIN_HTTP_STATUS.METHOD_NOT_ALLOWED,
  [ADMIN_ERROR.UNAVAILABLE]: ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE,
  [ADMIN_ERROR.NOT_SIGNED_IN]: ADMIN_HTTP_STATUS.UNAUTHORIZED,
  [ADMIN_ERROR.NOT_AUTHORIZED]: ADMIN_HTTP_STATUS.FORBIDDEN,
  [ADMIN_ERROR.NOT_FOUND]: ADMIN_HTTP_STATUS.NOT_FOUND,
} as const;

type AdminRefusalSlug = keyof typeof ADMIN_REFUSAL_STATUS;

function refusalSchema<Slug extends AdminRefusalSlug>(slug: Slug) {
  return Schema.Struct({ error: Schema.Literal(slug) }).annotations(
    HttpApiSchema.annotations({ status: ADMIN_REFUSAL_STATUS[slug] }),
  );
}

export const MethodNotAllowedRefusal = refusalSchema(ADMIN_ERROR.METHOD_NOT_ALLOWED);
export const UnavailableRefusal = refusalSchema(ADMIN_ERROR.UNAVAILABLE);
export const NotSignedInRefusal = refusalSchema(ADMIN_ERROR.NOT_SIGNED_IN);
export const NotAuthorizedRefusal = refusalSchema(ADMIN_ERROR.NOT_AUTHORIZED);
export const NotFoundRefusal = refusalSchema(ADMIN_ERROR.NOT_FOUND);

export type AdminRefusal = { readonly error: AdminRefusalSlug };

/** The refusal values themselves, since not one of them carries a field. */
export const ADMIN_REFUSAL = {
  METHOD_NOT_ALLOWED: { error: ADMIN_ERROR.METHOD_NOT_ALLOWED },
  /** A seam — the auth service — did not answer, which is an outage and never a sign-out. */
  UNAVAILABLE: { error: ADMIN_ERROR.UNAVAILABLE },
  NOT_SIGNED_IN: { error: ADMIN_ERROR.NOT_SIGNED_IN },
  NOT_AUTHORIZED: { error: ADMIN_ERROR.NOT_AUTHORIZED },
  /** A path the group the request reached declares no route for. */
  NOT_FOUND: { error: ADMIN_ERROR.NOT_FOUND },
} as const satisfies Record<string, AdminRefusal>;

/** A refusal as the response the group answers with. */
export function adminRefusalResponse(refusal: AdminRefusal): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.unsafeJson(refusal, {
    status: ADMIN_REFUSAL_STATUS[refusal.error],
    headers: { [RESPONSE_HEADER.CACHE_CONTROL]: NO_STORE },
  });
}
