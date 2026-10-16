import { Schema as EffectSchema } from "effect";
import {
  INTEGRATION_LABEL_MAX,
  integrationAccountAnswerSchema,
  integrationConnectionNameSchema,
  integrationProviderSchema,
  integrationStatusAnswerSchema,
  integrationStatusesAnswerSchema,
  integrationToolsAnswerSchema,
} from "./integration-wire.js";

/**
 * integration-view.ts -- the account's integrations as one Mac's window hears them: where they stand, or why there is no answer.
 *
 * The host asks the service on the window's behalf and answers the window
 * one of the shapes here. A Connect's answer is only whether the browser
 * was sent to sign in: the address the service answered is opened by the
 * host and never reaches a window, since it begins a grant for the account.
 */

/** Why an integration call answered nothing a window can draw. */
export const INTEGRATION_CALL_FAILURE = {
  /** The call never reached an answer: no credential, the network, a shape not read. */
  UNANSWERED: "unanswered",
  /** The service could not do it now: no such connector on this deployment, or Vercel Connect unreachable. */
  UNAVAILABLE: "unavailable",
  /** The sign-in address could not be opened on this Mac. */
  NOT_OPENED: "not-opened",
} as const;

export type IntegrationCallFailure =
  (typeof INTEGRATION_CALL_FAILURE)[keyof typeof INTEGRATION_CALL_FAILURE];

const failed = EffectSchema.Struct({
  failure: EffectSchema.Literals(Object.values(INTEGRATION_CALL_FAILURE)),
});

/**
 * The one account a Connect, a Cancel, a Disconnect, or a tools read is
 * about, as the window names it to the host: the provider, the account by
 * its connection name (the provider's first where none is named), and on a
 * Connect whether it signs in a new account.
 */
export const integrationProviderParamsSchema = EffectSchema.Struct({
  provider: integrationProviderSchema,
  connection: EffectSchema.optionalKey(integrationConnectionNameSchema),
  add: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type IntegrationProviderParams = typeof integrationProviderParamsSchema.Type;

/** One account a rename names, and the label it is to carry, as the window names it to the host. */
export const integrationRenameParamsSchema = EffectSchema.Struct({
  provider: integrationProviderSchema,
  connection: integrationConnectionNameSchema,
  label: EffectSchema.String.check(EffectSchema.isMaxLength(INTEGRATION_LABEL_MAX)),
});

export type IntegrationRenameParams = typeof integrationRenameParamsSchema.Type;

/** Where every provider's connection stands, as the window hears it. */
export const integrationStatusesViewSchema = EffectSchema.Union([
  integrationStatusesAnswerSchema,
  failed,
]);

export type IntegrationStatusesView = typeof integrationStatusesViewSchema.Type;

/** Where one provider's connection stands once a Disconnect ended it, as the window hears it. */
export const integrationStatusViewSchema = EffectSchema.Union([
  integrationStatusAnswerSchema,
  failed,
]);

export type IntegrationStatusView = typeof integrationStatusViewSchema.Type;

/** One provider's tools as the window hears them, or why there are none to draw. */
export const integrationToolsViewSchema = EffectSchema.Union([
  integrationToolsAnswerSchema,
  failed,
]);

export type IntegrationToolsView = typeof integrationToolsViewSchema.Type;

/** A Connect as the window hears it: the browser sent to sign in, and the account it signs in where the service named one, or why not. */
export const integrationConnectViewSchema = EffectSchema.Union([
  EffectSchema.Struct({
    opened: EffectSchema.Literal(true),
    connection: EffectSchema.optionalKey(integrationConnectionNameSchema),
  }),
  failed,
]);

export type IntegrationConnectView = typeof integrationConnectViewSchema.Type;

/** One account as a rename left it, as the window hears it, or why there is no answer. */
export const integrationAccountViewSchema = EffectSchema.Union([
  integrationAccountAnswerSchema,
  failed,
]);

export type IntegrationAccountView = typeof integrationAccountViewSchema.Type;
