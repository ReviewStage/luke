import {
  INTEGRATION_CALL_FAILURE,
  integrationAccountViewSchema,
  integrationConnectViewSchema,
  integrationProviderParamsSchema,
  integrationRenameParamsSchema,
  integrationStatusViewSchema,
} from "@repo/features/integration-view";
import { LIVE_READ } from "@repo/features/live-wire";
import {
  MCP_CLIENTS_CALL_FAILURE,
  mcpClientRevokeParamsSchema,
  mcpClientsViewSchema,
} from "@repo/features/mcp-client-view";
import { ACT } from "@repo/sync";
import { contractOf, declaredActs, hostAct } from "./declared-act.js";
import { followsContractOf, HOLD, liveFollow, liveFollows } from "./live-follow.js";

/**
 * integrations.ts -- Settings' integration rows: the panel's asks of the host about the account's integrations, each plain ask and live follow declared.
 *
 * Only a panel draws Settings, so every ask is the panel's alone. A refusal
 * or a defect of the host's is drawn as the integration calls' unanswered
 * failure, or the outside MCP clients' for a revoke, as every one was
 * before it was declared. Where the integrations stand, each server's
 * tools, and the outside MCP clients are live follows, each declared once
 * (`live-follow.ts`).
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

/** Where the account's integrations stand and the outside MCP clients it allowed, each held once for the account signed in, and each server's tools, by the server, followed while Settings draws them. */
export const INTEGRATION_FOLLOWS = liveFollows({
  INTEGRATIONS_FOLLOW: liveFollow({
    slice: LIVE_READ.INTEGRATIONS,
    hold: HOLD.ACCOUNT,
    refusal: "Could not follow your integrations on this system.",
    panelOnly: true,
    retry: {
      name: "INTEGRATIONS_RETRY",
      refusal: "Could not read your integrations again on this system.",
    },
  }),
  INTEGRATIONS_TOOLS_FOLLOW: liveFollow({
    slice: LIVE_READ.INTEGRATION_TOOLS,
    hold: HOLD.WINDOW,
    key: integrationProviderParamsSchema,
    refusal: "Could not follow that integration's tools on this system.",
    panelOnly: true,
    retry: {
      name: "INTEGRATIONS_TOOLS_RETRY",
      refusal: "Could not read that integration's tools again on this system.",
    },
  }),
  MCP_CLIENTS_FOLLOW: liveFollow({
    slice: LIVE_READ.MCP_CLIENTS,
    hold: HOLD.ACCOUNT,
    refusal: "Could not read the apps that can use your account on this system.",
    panelOnly: true,
    retry: {
      name: "MCP_CLIENTS_RETRY",
      refusal: "Could not read the apps that can use your account again on this system.",
    },
  }),
});

export const integrationActsContract = {
  ...contractOf(INTEGRATION_ACTS),
  ...followsContractOf(INTEGRATION_FOLLOWS),
};
