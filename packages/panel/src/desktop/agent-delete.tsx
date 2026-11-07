import type { AgentSummary } from "@repo/features/agent-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { IRREVERSIBLE_WORDS } from "@repo/features/words";
import {
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  nextRowOrHead,
  useConfirmDialog,
} from "@repo/ui";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { useMutation } from "@tanstack/react-query";
import { commandAction, PANEL_COMMAND } from "../command-items.js";
import { sameAnswer, useConfirmAct } from "../confirm-act.js";
import { confirmFailure } from "../failure-report.js";
import { agentName } from "../tasks/agent-model.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import type { MenuAction } from "./action-menu.js";
import { useRefusalHeard } from "./use-refusal-heard.js";

/**
 * agent-delete.tsx -- a coding agent's Permanently delete, asked first, as a task's is.
 *
 * It stands last and alone in every menu that offers the agent's actions,
 * red, as a task's does (`task-actions.tsx`): an agent's tab and its own
 * page through `useAgentActions`, and its sidebar row beside its Archive.
 * It always asks, since nothing brings the agent back, naming the agent and
 * what goes with it, and, for one not archived, saying an archive would keep
 * it out of the way instead. Once asked, the host takes the agent out of its
 * list at once. A refusal puts it back and is said in the dialog, which
 * stays, or in a toast where the row it stood on took it away
 * (`use-refusal-heard.ts`); a delete that landed says so in a toast
 * (`use-agents.ts`), and the surface it was asked on closes its tab or its
 * page (`onDeleted`).
 */

/** What asking to delete an agent says: what goes, and, for one not archived, the archive that keeps it instead. */
function deleteQuestion(name: string, archived: boolean): DialogQuestion {
  const lost = `“${name}” and its transcript will be deleted. ${IRREVERSIBLE_WORDS}`;
  return {
    title: "Permanently delete agent?",
    body: archived ? lost : `${lost} To keep it out of the way instead, archive it.`,
    verb: "Permanently delete agent",
    running: "Deleting",
    loss: CONFIRM_LOSS.IRREVERSIBLE,
    replayUnmasked: true,
    bodyReplayMasked: true,
  };
}

/** An agent's Permanently delete as a menu offers it, and the question it asks through. */
export interface AgentDelete {
  action: MenuAction;
  dialog: React.JSX.Element;
}

/**
 * One agent's Permanently delete as a menu offers it, and the dialog it
 * asks through, which the caller draws beside the menu; `onDeleted` runs
 * once the delete landed, for the surface to close what showed the agent.
 * The question goes with the surface it was asked on.
 */
export function useAgentDelete(
  agent: Pick<AgentSummary, "id" | "title" | "automationName" | "model" | "archivedAt">,
  agents: Pick<AgentsControl, "deleteAgent" | "models">,
  input: { readonly shown: boolean; readonly onDeleted?: (() => void) | undefined },
): AgentDelete {
  const { shown, onDeleted } = input;
  const heard = useRefusalHeard(shown, {
    surface: FAILURE_SURFACE.AGENT_DELETE,
    about: { agentId: agent.id },
  });
  const deleting = useMutation(agents.deleteAgent);
  const confirmAct = useConfirmAct(deleting, {
    send: () =>
      deleting.mutateAsync(agent.id).then((result) => {
        if (result.status === ACTION_RESULT_STATUS.ACCEPTED) onDeleted?.();
        return heard(result);
      }),
    answered: sameAnswer,
  });
  const confirm = useConfirmDialog(
    { subject: true, surfaceOpen: shown },
    confirmAct,
    confirmFailure(FAILURE_SURFACE.AGENT_DELETE, { agentId: agent.id }),
  );
  return {
    action: { ...commandAction(PANEL_COMMAND.DELETE_AGENT, confirm.ask, false), danger: true },
    dialog: (
      <ConfirmDialog
        open
        confirm={confirm}
        question={deleteQuestion(agentName(agent, agents.models), agent.archivedAt !== undefined)}
        restoreTo={nextRowOrHead}
      />
    ),
  };
}
