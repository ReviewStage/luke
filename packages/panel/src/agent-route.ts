/**
 * agent-route.ts -- an agent's own page as the router stands it: whether it stands, the agent and workspace its address names, and the navigation that opens it.
 *
 * An agent's page, the page of an agent on no task or of an archived one
 * opened on its own, is a routed place (`panel-router.tsx`) under the
 * workspace its address names, `/<workspace>/agent/<agentId>`, read from the
 * address alone, as a person's page is (`workspace-routes.ts`). Opening one
 * is a visit; opening the one already standing moves nothing. The side
 * panel beside it is the window's, which the history saves in the step
 * beside its address (`navigation-history.ts`), as it does an Inbox item's.
 */

import { useNavigate } from "@tanstack/react-router";
import { ROUTED_PLACE, useWindowPlace } from "./places/routed-places.js";

/** An agent's page as the router stands it. */
export interface AgentRoute {
  /** The agent whose page stands, none while none does. */
  readonly agentId: string | undefined;
  /** The address step of the workspace the page stands under, while it stands. */
  readonly workspace: string | undefined;
  /** Opens the page of `agentId` under the workspace whose address step is `workspace`. */
  readonly onOpen: (agentId: string, workspace: string) => void;
  readonly onClose: () => void;
}

/** An agent's page as the router stands it, left by `onClose`, and kept standing by `onStay` where a leave was asked of it before a door asked for the page standing. */
export function useAgentRoute(input: { onClose: () => void; onStay: () => void }): AgentRoute {
  const navigate = useNavigate();
  const here = useWindowPlace();
  const open = here.place === ROUTED_PLACE.AGENT;
  const agentId = open ? here.params.agentId : undefined;
  const workspace = open ? here.params.workspace : undefined;
  const onOpen = (to: string, toWorkspace: string) => {
    // Opening the page standing moves nothing, and keeps it standing where the door that asked for it left the routed place first, as a link's and ⌘K's do.
    if (to === agentId && toWorkspace === workspace) {
      input.onStay();
      return;
    }
    void navigate({
      to: "/$workspace/agent/$agentId",
      params: { workspace: toWorkspace, agentId: to },
    });
  };
  return { agentId, workspace, onOpen, onClose: input.onClose };
}
