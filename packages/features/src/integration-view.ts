import { Schema as EffectSchema } from "effect";
import {
  INTEGRATION_LABEL_MAX,
  integrationAccountAnswerSchema,
  integrationConnectionNameSchema,
  integrationProviderSchema,
  integrationStatusAnswerSchema,
  integrationToolsAnswerSchema,
} from "./integration-wire.js";

export const INTEGRATION_CALL_FAILURE = {
  UNANSWERED: "unanswered",
  UNAVAILABLE: "unavailable",
  NOT_OPENED: "not-opened",
} as const;

export type IntegrationCallFailure =
  (typeof INTEGRATION_CALL_FAILURE)[keyof typeof INTEGRATION_CALL_FAILURE];

const failed = EffectSchema.Struct({
  failure: EffectSchema.Literals(Object.values(INTEGRATION_CALL_FAILURE)),
});

export const integrationProviderParamsSchema = EffectSchema.Struct({
  provider: integrationProviderSchema,
  connection: EffectSchema.optionalKey(integrationConnectionNameSchema),
  add: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type IntegrationProviderParams = typeof integrationProviderParamsSchema.Type;

export const integrationRenameParamsSchema = EffectSchema.Struct({
  provider: integrationProviderSchema,
  connection: integrationConnectionNameSchema,
  label: EffectSchema.String.check(EffectSchema.isMaxLength(INTEGRATION_LABEL_MAX)),
});

export type IntegrationRenameParams = typeof integrationRenameParamsSchema.Type;

export const integrationStatusViewSchema = EffectSchema.Union([
  integrationStatusAnswerSchema,
  failed,
]);

export type IntegrationStatusView = typeof integrationStatusViewSchema.Type;

export const integrationToolsViewSchema = EffectSchema.Union([
  integrationToolsAnswerSchema,
  failed,
]);

export type IntegrationToolsView = typeof integrationToolsViewSchema.Type;

export const integrationConnectViewSchema = EffectSchema.Union([
  EffectSchema.Struct({
    opened: EffectSchema.Literal(true),
    connection: EffectSchema.optionalKey(integrationConnectionNameSchema),
  }),
  failed,
]);

export type IntegrationConnectView = typeof integrationConnectViewSchema.Type;

export const integrationAccountViewSchema = EffectSchema.Union([
  integrationAccountAnswerSchema,
  failed,
]);

export type IntegrationAccountView = typeof integrationAccountViewSchema.Type;
