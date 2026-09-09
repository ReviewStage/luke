/**
 * The one bridge from an admitted act to the request its provider adapter
 * takes. Each function here needs a {@link ValidatedAct} to answer at all, so
 * nothing can build an adapter request without admission having run, and each
 * only renames fields: what the act carries — the identity the roster held,
 * the advertised control, the bounded text — is what the request carries.
 *
 * The creation and the spawn take one thing beside the act: the developer's
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
import type { ACT_KIND } from "./act-kinds.js";
import type { ValidatedAct } from "./admit.js";

export function providerSessionMessage(
  act: ValidatedAct<typeof ACT_KIND.MESSAGE>,
): ProviderSessionMessage {
  return reshapeAdmitted(act, {
    providerSessionId: act.identity.providerSessionId,
    text: act.text,
  });
}

export function providerControlRequest(
  act: ValidatedAct<typeof ACT_KIND.CONTROL>,
): ProviderControlRequest {
  return reshapeAdmitted(act, {
    providerSessionId: act.identity.providerSessionId,
    control: act.control,
  });
}

export function providerWorkspaceRequest(
  act: ValidatedAct<typeof ACT_KIND.CREATE_WORKSPACE>,
  storedSelection?: WorkspaceAgentSelection,
): ProviderWorkspaceRequest {
  const selection = act.agentSelection ?? storedSelection;
  return reshapeAdmitted(act, {
    providerProjectId: act.providerProjectId,
    ...(act.providerTargetId === undefined
      ? undefined
      : { providerTargetId: act.providerTargetId }),
    ...(act.agent === undefined ? undefined : { agent: act.agent }),
    ...(act.name === undefined ? undefined : { name: act.name }),
    ...(act.task === undefined ? undefined : { task: act.task }),
    ...(selection === undefined ? undefined : { agentSelection: selection }),
  });
}

/**
 * A stored pairing rides along only when it names the very agent kind the
 * developer asked for, and a model the ask named brings its own effort or
 * none: a preference rides with an ask, never against it.
 */
export function providerWorkspaceAgentRequest(
  act: ValidatedAct<typeof ACT_KIND.ADD_AGENT>,
  storedSelection?: WorkspaceAgentSelection,
): ProviderWorkspaceAgentRequest {
  const stored = storedSelection?.agent === act.agent ? storedSelection : undefined;
  const model = act.model ?? stored?.model;
  const effort = act.model === undefined ? stored?.effort : act.effort;
  return reshapeAdmitted(act, {
    providerSessionId: act.identity.providerSessionId,
    agent: act.agent,
    ...(act.name === undefined ? undefined : { name: act.name }),
    ...(act.task === undefined ? undefined : { task: act.task }),
    ...(model === undefined ? undefined : { model }),
    ...(effort === undefined ? undefined : { effort }),
  });
}

export function providerWorkspaceRenameRequest(
  act: ValidatedAct<typeof ACT_KIND.RENAME_WORKSPACE>,
): ProviderWorkspaceRenameRequest {
  return reshapeAdmitted(act, {
    providerSessionId: act.identity.providerSessionId,
    name: act.name,
  });
}

export function providerSessionRenameRequest(
  act: ValidatedAct<typeof ACT_KIND.RENAME_SESSION>,
): ProviderSessionRenameRequest {
  return reshapeAdmitted(act, {
    providerSessionId: act.identity.providerSessionId,
    name: act.name,
  });
}
