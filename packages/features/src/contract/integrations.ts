import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
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

const RENAME_BODY_BYTES = 2_048;

export const integrationStatusesReadSchema = EffectSchema.Struct({
  integrations: EffectSchema.Record(EffectSchema.String, EffectSchema.String),
  accounts: EffectSchema.optionalKey(EffectSchema.Array(EffectSchema.Unknown)),
  addable: EffectSchema.optionalKey(EffectSchema.Array(EffectSchema.Unknown)),
  signInFailures: EffectSchema.optionalKey(EffectSchema.Array(EffectSchema.Unknown)),
});

function providerPath(action: string): `/${string}` {
  return `${HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS}/{provider}/${action}`;
}

const providerParams = EffectSchema.Struct({ provider: EffectSchema.String });

const accountQuery = EffectSchema.StructWithRest(
  EffectSchema.Struct({
    [INTEGRATION_QUERY.CONNECTION]: EffectSchema.optionalKey(EffectSchema.String),
    [INTEGRATION_QUERY.ADD]: EffectSchema.optionalKey(EffectSchema.String),
  }),
  [EffectSchema.Record(EffectSchema.String, EffectSchema.Unknown)],
);

const accountInput = EffectSchema.Struct({
  params: providerParams,
  query: EffectSchema.optionalKey(accountQuery),
});

const toolsInput = EffectSchema.Struct({
  provider: EffectSchema.String,
  [INTEGRATION_QUERY.CONNECTION]: EffectSchema.optionalKey(EffectSchema.String),
});

const renameInput = EffectSchema.Struct({
  params: providerParams,
  query: EffectSchema.optionalKey(accountQuery),
  headers: EffectSchema.optionalKey(EffectSchema.Record(EffectSchema.String, EffectSchema.Unknown)),
  body: integrationRenameRequestSchema,
});

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
  github: hostedProcedure
    .meta(
      openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_INTEGRATIONS_GITHUB }),
    )
    .output(EffectSchema.flip(integrationStatusAnswerSchema)),
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
