import { eventIterator, type } from "@orpc/contract";
import {
  integrationAccountViewSchema,
  integrationConnectViewSchema,
  integrationProviderParamsSchema,
  integrationRenameParamsSchema,
  integrationStatusesViewSchema,
  integrationStatusViewSchema,
} from "@repo/features/integration-view";
import { mcpClientRevokeParamsSchema, mcpClientsViewSchema } from "@repo/features/mcp-client-view";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { INTEGRATION_ACT_KIND } from "./kinds.js";

/**
 * integrations.ts -- Settings' integration rows: the panel's asks of the host about the account's integrations, as procedures.
 *
 * The status read carries nothing, so its input is `undefined` alone and a
 * window calls it with no payload. Each output is its view schema flipped,
 * so oRPC's output check encodes the row's value into what crosses the port.
 */
export const integrationActsContract = {
  [INTEGRATION_ACT_KIND.INTEGRATIONS_STATUS]: actProcedure(
    "Could not read your integrations on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.flip(integrationStatusesViewSchema)),
  [INTEGRATION_ACT_KIND.INTEGRATIONS_CONNECT]: actProcedure(
    "Could not connect that integration on this system.",
  )
    .input(exactInput(integrationProviderParamsSchema))
    .output(EffectSchema.flip(integrationConnectViewSchema)),
  // Note that the hold's stream carries nothing: the held tools reach the panel on app state, and the stream is the window's hold on them.
  [INTEGRATION_ACT_KIND.INTEGRATIONS_TOOLS_FOLLOW]: actProcedure(
    "Could not follow that integration's tools on this system.",
  )
    .input(exactInput(integrationProviderParamsSchema))
    .output(eventIterator(type<never>())),
  [INTEGRATION_ACT_KIND.INTEGRATIONS_TOOLS_RETRY]: actProcedure(
    "Could not read that integration's tools again on this system.",
  )
    .input(exactInput(integrationProviderParamsSchema))
    .output(EffectSchema.Void),
  [INTEGRATION_ACT_KIND.INTEGRATIONS_CANCEL]: actProcedure(
    "Could not cancel connecting that integration on this system.",
  )
    .input(exactInput(integrationProviderParamsSchema))
    .output(EffectSchema.flip(integrationStatusViewSchema)),
  [INTEGRATION_ACT_KIND.INTEGRATIONS_DISCONNECT]: actProcedure(
    "Could not disconnect that integration on this system.",
  )
    .input(exactInput(integrationProviderParamsSchema))
    .output(EffectSchema.flip(integrationStatusViewSchema)),
  [INTEGRATION_ACT_KIND.INTEGRATIONS_RENAME]: actProcedure(
    "Could not rename that account on this system.",
  )
    .input(exactInput(integrationRenameParamsSchema))
    .output(EffectSchema.flip(integrationAccountViewSchema)),
  // Note that the hold's stream carries nothing: the held clients reach the panel on app state, and the stream is the window's hold on them.
  [INTEGRATION_ACT_KIND.MCP_CLIENTS_FOLLOW]: actProcedure(
    "Could not read the apps that can use your account on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(eventIterator(type<never>())),
  [INTEGRATION_ACT_KIND.MCP_CLIENTS_RETRY]: actProcedure(
    "Could not read the apps that can use your account again on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Void),
  [INTEGRATION_ACT_KIND.MCP_CLIENTS_REVOKE]: actProcedure(
    "Could not revoke that app on this system.",
  )
    .input(exactInput(mcpClientRevokeParamsSchema))
    .output(EffectSchema.flip(mcpClientsViewSchema)),
};
