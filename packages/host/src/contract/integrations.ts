import { eventIterator, type } from "@orpc/contract";
import {
  INTEGRATION_CALL_FAILURE,
  integrationAccountViewSchema,
  integrationConnectViewSchema,
  integrationProviderParamsSchema,
  integrationRenameParamsSchema,
  integrationStatusViewSchema,
} from "@repo/features/integration-view";
import {
  MCP_CLIENTS_CALL_FAILURE,
  mcpClientRevokeParamsSchema,
  mcpClientsViewSchema,
} from "@repo/features/mcp-client-view";
import { ACT } from "@repo/sync";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { contractOf, declaredActs, hostAct } from "./declared-act.js";
import { INTEGRATION_ACT_KIND } from "./kinds.js";

/**
 * integrations.ts -- Settings' integration rows: the panel's asks of the host about the account's integrations, each plain ask declared, and the procedures of the holds and their Try again beside them.
 *
 * Only a panel draws Settings, so every ask is the panel's alone. A refusal
 * or a defect of the host's is drawn as the integration calls' unanswered
 * failure, or the outside MCP clients' for a revoke, as every one was
 * before it was declared. The holds and their Try again stay procedures of
 * their own (`act-port/integration-procedures.ts`): live reads, not plain
 * acts. The hold on where the integrations stand, the clients' hold, and
 * each Try again of theirs carry nothing, so their input is `undefined`
 * alone and a window calls each with no payload.
 */

/** What the window draws for an integration ask the host could not answer. */
const UNANSWERED = { failure: INTEGRATION_CALL_FAILURE.UNANSWERED } as const;

/** The integrations' plain asks, each answered by the integrations' composer. */
export const INTEGRATION_ACTS = declaredActs({
  INTEGRATIONS_CONNECT: hostAct({
    input: integrationProviderParamsSchema,
    output: integrationConnectViewSchema,
    refusal: "Could not connect that integration on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  INTEGRATIONS_CANCEL: hostAct({
    input: integrationProviderParamsSchema,
    output: integrationStatusViewSchema,
    refusal: "Could not cancel connecting that integration on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  INTEGRATIONS_DISCONNECT: hostAct({
    input: integrationProviderParamsSchema,
    output: integrationStatusViewSchema,
    refusal: "Could not disconnect that integration on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: UNANSWERED,
  }),
  INTEGRATIONS_RENAME: hostAct({
    input: integrationRenameParamsSchema,
    output: integrationAccountViewSchema,
    refusal: "Could not rename that account on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: UNANSWERED,
  }),
  MCP_CLIENTS_REVOKE: hostAct({
    input: mcpClientRevokeParamsSchema,
    output: mcpClientsViewSchema,
    refusal: "Could not revoke that app on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: { failure: MCP_CLIENTS_CALL_FAILURE.UNANSWERED },
  }),
});

export const integrationActsContract = {
  ...contractOf(INTEGRATION_ACTS),
  // Note that the hold's stream carries nothing: the held integrations reach the panel on app state, and the stream is the window's hold on them.
  [INTEGRATION_ACT_KIND.INTEGRATIONS_FOLLOW]: actProcedure(
    "Could not follow your integrations on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(eventIterator(type<never>())),
  [INTEGRATION_ACT_KIND.INTEGRATIONS_RETRY]: actProcedure(
    "Could not read your integrations again on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Void),
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
};
