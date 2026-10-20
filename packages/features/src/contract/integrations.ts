/**
 * integrations.ts -- the account's integrations (`integration-wire.ts`), as procedures.
 *
 * Where every provider stands, read or settled, and the five calls about one
 * account at a provider: a sign-in begun or cancelled, a connection ended,
 * the tools its server offers, and its name. Vercel Connect's return to the
 * browser (`/api/account/integrations/connected`) is a redirect, not a
 * procedure, and stays on its own route.
 *
 * A provider's path names it as a segment the service reads as words, so a
 * provider this build does not know is the service's own not found rather
 * than an invalid request; the account a call is about is the query's
 * `connection`, and a Connect's `add` asks for a new one.
 *
 * Each output is its wire schema flipped (`packages/service/src/orpc/base.ts`),
 * but for the statuses read, whose answer a desktop reads leniently: a
 * status or a provider this build does not know hides none of the others,
 * so that read's schema is the lenient one below, and its client reads
 * each account and failure in turn.
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  INTEGRATION_QUERY,
  integrationAccountAnswerSchema,
  integrationConnectAnswerSchema,
  integrationRenameRequestSchema,
  integrationStatusAnswerSchema,
  integrationToolsAnswerSchema,
} from "../integration-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

/** The most a rename's body may carry, in bytes: one label, well past its own bound. */
const RENAME_BODY_BYTES = 2_048;

/**
 * Where every provider's connection stands, as a desktop reads the answer:
 * every status kept in words, because a service older than the desktop names
 * fewer providers and a newer one may name a status this build does not know,
 * and each account, provider, and sign-in failure kept unread until it is
 * read one at a time.
 */
export const integrationStatusesReadSchema = EffectSchema.Struct({
  integrations: EffectSchema.Record(EffectSchema.String, EffectSchema.String),
  accounts: EffectSchema.optionalKey(EffectSchema.Array(EffectSchema.Unknown)),
  addable: EffectSchema.optionalKey(EffectSchema.Array(EffectSchema.Unknown)),
  signInFailures: EffectSchema.optionalKey(EffectSchema.Array(EffectSchema.Unknown)),
});

/** A provider's own route, its provider a path segment. */
function providerPath(action: string): `/${string}` {
  return `${HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS}/{provider}/${action}`;
}

/** The provider a route is about, as the path spells it. */
const providerParams = EffectSchema.Struct({ provider: EffectSchema.String });

/**
 * The account a provider's route is about, and on a Connect whether it signs
 * in a new one; any other key is let through unread, as the old routes
 * ignored it.
 */
const accountQuery = EffectSchema.StructWithRest(
  EffectSchema.Struct({
    [INTEGRATION_QUERY.CONNECTION]: EffectSchema.optionalKey(EffectSchema.String),
    [INTEGRATION_QUERY.ADD]: EffectSchema.optionalKey(EffectSchema.String),
  }),
  [EffectSchema.Record(EffectSchema.String, EffectSchema.Unknown)],
);

/**
 * A provider's POST without a body: the provider, and the account in the
 * query, read in parts because a POST's query is not merged into its input.
 */
const accountInput = EffectSchema.Struct({
  params: providerParams,
  query: EffectSchema.optionalKey(accountQuery),
});

/** The tools read, a GET: the path's provider and the query's account, merged as oRPC reads a GET by default. */
const toolsInput = EffectSchema.Struct({
  provider: EffectSchema.String,
  [INTEGRATION_QUERY.CONNECTION]: EffectSchema.optionalKey(EffectSchema.String),
});

/**
 * A rename: the provider, the account, and the label, the body read
 * exactly as the old route read it (`exactInput`), which is
 * `exactBodyInput`'s shape with the query read, since the account a rename
 * is about is the query's; the headers the detailed input carries are let
 * through unread.
 */
const renameInput = EffectSchema.Struct({
  params: providerParams,
  query: EffectSchema.optionalKey(accountQuery),
  headers: EffectSchema.optionalKey(EffectSchema.Record(EffectSchema.String, EffectSchema.Unknown)),
  body: integrationRenameRequestSchema,
});

/** A provider's POST, its input read in parts: the path's provider, the query, and a body where it takes one. */
function providerPost(action: string) {
  return hostedProcedure.meta(
    openapi({ method: HTTP_METHOD.POST, path: providerPath(action), inputStructure: "detailed" }),
  );
}

export const integrationsContract = {
  statuses: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS }))
    .output(EffectSchema.flip(integrationStatusesReadSchema)),
  settle: hostedProcedure
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS_SETTLE }),
    )
    .output(EffectSchema.flip(integrationStatusesReadSchema)),
  connect: providerPost("connect")
    .input(accountInput)
    .output(EffectSchema.flip(integrationConnectAnswerSchema)),
  tools: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: providerPath("tools") }))
    .input(toolsInput)
    .output(EffectSchema.flip(integrationToolsAnswerSchema)),
  cancel: providerPost("cancel")
    .input(accountInput)
    .output(EffectSchema.flip(integrationStatusAnswerSchema)),
  disconnect: providerPost("disconnect")
    .input(accountInput)
    .output(EffectSchema.flip(integrationStatusAnswerSchema)),
  rename: providerPost("rename")
    .meta(bodyCap(RENAME_BODY_BYTES))
    .input(exactInput(renameInput))
    .output(EffectSchema.flip(integrationAccountAnswerSchema)),
};
