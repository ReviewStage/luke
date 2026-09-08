/**
 * The one bridge from an admitted action to the request its provider adapter
 * takes. Each function here needs a {@link ValidatedAction} to answer at all, so
 * nothing can build an adapter request without admission having run, and each
 * only renames fields: what the action carries — the identity the roster held,
 * the advertised control, the bounded text — is what the request carries.
 *
 * The creation and the spawn take one thing beside the action: the developer's
 * stored agent default, which is read after admission and under the turn's own
 * guard, and which rides along only where the ask left the choice open. A
 * stored default was held to the build's documented table when it was written,
 * and the adapter holds whatever rides to its own table again before anything
 * reaches the network.
 */

import type {
  ProviderControlRequest,
  ProviderSessionMessage,
  ProviderSessionRenameRequest,
  ProviderWorkspaceAgentRequest,
  ProviderWorkspaceRenameRequest,
  ProviderWorkspaceRequest,
  WorkspaceAgentSelection,
} from "@sidecar/session";
import { reshapeAdmitted } from "@sidecar/wire";
import type { ACTION_KIND } from "./action-kinds.js";
import type { ValidatedAction } from "./admit.js";

export function providerSessionMessage(
  action: ValidatedAction<typeof ACTION_KIND.MESSAGE>,
): ProviderSessionMessage {
  return reshapeAdmitted(action, {
    providerSessionId: action.identity.providerSessionId,
    text: action.text,
  });
}

export function providerControlRequest(
  action: ValidatedAction<typeof ACTION_KIND.CONTROL>,
): ProviderControlRequest {
  return reshapeAdmitted(action, {
    providerSessionId: action.identity.providerSessionId,
    control: action.control,
  });
}

export function providerWorkspaceRequest(
  action: ValidatedAction<typeof ACTION_KIND.CREATE_WORKSPACE>,
  storedSelection?: WorkspaceAgentSelection,
): ProviderWorkspaceRequest {
  const selection = action.agentSelection ?? storedSelection;
  return reshapeAdmitted(action, {
    providerProjectId: action.providerProjectId,
    ...(action.providerTargetId === undefined
      ? undefined
      : { providerTargetId: action.providerTargetId }),
    ...(action.agent === undefined ? undefined : { agent: action.agent }),
    ...(action.name === undefined ? undefined : { name: action.name }),
    ...(action.task === undefined ? undefined : { task: action.task }),
    ...(selection === undefined ? undefined : { agentSelection: selection }),
  });
}

/**
 * A stored pairing rides along only when it names the very agent kind the
 * developer asked for, and a model the ask named brings its own effort or
 * none: a preference rides with an ask, never against it.
 */
export function providerWorkspaceAgentRequest(
  action: ValidatedAction<typeof ACTION_KIND.ADD_AGENT>,
  storedSelection?: WorkspaceAgentSelection,
): ProviderWorkspaceAgentRequest {
  const stored = storedSelection?.agent === action.agent ? storedSelection : undefined;
  const model = action.model ?? stored?.model;
  const effort = action.model === undefined ? stored?.effort : action.effort;
  return reshapeAdmitted(action, {
    providerSessionId: action.identity.providerSessionId,
    agent: action.agent,
    ...(action.name === undefined ? undefined : { name: action.name }),
    ...(action.task === undefined ? undefined : { task: action.task }),
    ...(model === undefined ? undefined : { model }),
    ...(effort === undefined ? undefined : { effort }),
  });
}

export function providerWorkspaceRenameRequest(
  action: ValidatedAction<typeof ACTION_KIND.RENAME_WORKSPACE>,
): ProviderWorkspaceRenameRequest {
  return reshapeAdmitted(action, {
    providerSessionId: action.identity.providerSessionId,
    name: action.name,
  });
}

export function providerSessionRenameRequest(
  action: ValidatedAction<typeof ACTION_KIND.RENAME_SESSION>,
): ProviderSessionRenameRequest {
  return reshapeAdmitted(action, {
    providerSessionId: action.identity.providerSessionId,
    name: action.name,
  });
}
