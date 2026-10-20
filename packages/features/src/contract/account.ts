/**
 * account.ts -- the signed-in account's own reads and writes (`account-wire.ts`, `plan-document-template.ts`, `provider-key-wire.ts`), as procedures.
 *
 * Its deletion, its preferences snapshot, its plan template with the
 * template's history, and its own provider keys, each on the path and
 * method it has always answered on. A revision's number travels in the
 * path, and a page of the history names the revision it is read before in
 * the query, each as the text a URL carries, read as a revision number;
 * a key is removed by the provider its query names, since a `DELETE`
 * carries no body. A JSON body is read whole, a key it does not name
 * refused (`exactInput`), but for the preferences write, whose parts the
 * service has always read one by one and whose other keys it passes over.
 *
 * The outputs are the wire schemas flipped, so oRPC's output check encodes
 * the handler's value into the bytes the wire carries (`packages/service/src/orpc/base.ts`).
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  accountDeleteAnswerSchema,
  accountPreferencesAnswerSchema,
  accountPreferencesWriteSchema,
} from "../account-wire.js";
import {
  PLAN_TEMPLATE_BOUNDS,
  planTemplateAnswerSchema,
  planTemplateRevisionAnswerSchema,
  planTemplateRevisionsAnswerSchema,
  planTemplateWriteRequestSchema,
} from "../plan-document-template.js";
import {
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_QUERY,
  providerKeySaveRequestSchema,
  providerKeysAnswerSchema,
} from "../provider-key-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { planRevisionSeqSchema } from "../task-wire.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

/** A template write is the template at its bound with every character escaped, and the key around it. */
const PLAN_TEMPLATE_BODY_BYTES = PLAN_TEMPLATE_BOUNDS.MAX_CHARS * 6 + 1_024;

/** A key's save is a provider and a key bounded at 512 characters, so a body past this is not one. */
const PROVIDER_KEY_BODY_BYTES = 2_048;

/** A revision's number as a path or a query carries it: text, read as a whole number from one. */
const revisionSeqText = EffectSchema.FiniteFromString.pipe(
  EffectSchema.decodeTo(planRevisionSeqSchema),
);

/** One revision of the template, by the number its path names. */
const PLAN_TEMPLATE_REVISION_PATH =
  `${HOSTED_SERVICE_PATH.ACCOUNT_PLAN_TEMPLATE_REVISIONS}/{seq}` as const;

export const accountContract = {
  delete: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.ACCOUNT_DELETE }))
    .output(EffectSchema.flip(accountDeleteAnswerSchema)),
  preferences: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES }))
    .output(EffectSchema.flip(accountPreferencesAnswerSchema)),
  writePreferences: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.PUT, path: HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES }))
    .input(accountPreferencesWriteSchema)
    .output(EffectSchema.flip(accountPreferencesAnswerSchema)),
  planTemplate: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_PLAN_TEMPLATE }))
    .output(EffectSchema.flip(planTemplateAnswerSchema)),
  writePlanTemplate: hostedProcedure
    .meta(bodyCap(PLAN_TEMPLATE_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.PUT, path: HOSTED_SERVICE_PATH.ACCOUNT_PLAN_TEMPLATE }))
    .input(exactInput(planTemplateWriteRequestSchema))
    .output(EffectSchema.flip(planTemplateAnswerSchema)),
  planTemplateRevisions: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.GET,
        path: HOSTED_SERVICE_PATH.ACCOUNT_PLAN_TEMPLATE_REVISIONS,
      }),
    )
    .input(EffectSchema.Struct({ before: EffectSchema.optionalKey(revisionSeqText) }))
    .output(EffectSchema.flip(planTemplateRevisionsAnswerSchema)),
  planTemplateRevision: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: PLAN_TEMPLATE_REVISION_PATH }))
    .input(EffectSchema.Struct({ seq: revisionSeqText }))
    .output(EffectSchema.flip(planTemplateRevisionAnswerSchema)),
  restorePlanTemplate: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: `${PLAN_TEMPLATE_REVISION_PATH}/restore` as const,
      }),
    )
    .input(EffectSchema.Struct({ seq: revisionSeqText }))
    .output(EffectSchema.flip(planTemplateAnswerSchema)),
  providerKeys: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_PROVIDER_KEYS }))
    .output(EffectSchema.flip(providerKeysAnswerSchema)),
  saveProviderKey: hostedProcedure
    .meta(bodyCap(PROVIDER_KEY_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.PUT, path: HOSTED_SERVICE_PATH.ACCOUNT_PROVIDER_KEYS }))
    .input(exactInput(providerKeySaveRequestSchema))
    .output(EffectSchema.flip(providerKeysAnswerSchema)),
  removeProviderKey: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.DELETE,
        path: HOSTED_SERVICE_PATH.ACCOUNT_PROVIDER_KEYS,
        inputStructure: "detailed",
      }),
    )
    .input(
      EffectSchema.Struct({
        query: EffectSchema.Struct({
          [PROVIDER_KEY_QUERY.PROVIDER]: EffectSchema.Literals(
            Object.values(PROVIDER_KEY_PROVIDER),
          ),
        }),
      }),
    )
    .output(EffectSchema.flip(providerKeysAnswerSchema)),
};
