import type { CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { ConfirmDialog, type DialogQuestion, TrashIcon, useConfirmDialog } from "@luke/ui";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { agentName } from "../tasks/coding-agent-model.js";
import type { CodingAgentsControl } from "../tasks/use-coding-agents.js";
import type { MenuAction } from "./action-menu.js";

/**
 * agent-delete.tsx -- a coding agent's Permanently delete, asked first, as a task's is.
 *
 * It stands last and alone in every menu that offers the agent's actions,
 * red, as a task's does (`task-actions.tsx`): an agent's tab and its own
 * page through `useAgentActions`, and its sidebar row beside its Archive.
 * It always asks, since nothing brings the agent back, naming the agent and
 * what goes with it, and, for one not archived, saying an archive would keep
 * it out of the way instead. A refusal is said in the dialog, which stays;
 * a delete that landed takes the agent out of its list and says so in a
 * toast (`use-coding-agents.ts`), and the surface it was asked on closes its
 * tab or its page (`onDeleted`).
 */

/** What the item says, as a task's does. */
const DELETE_LABEL = "Permanently delete";

/** What asking to delete an agent says: what goes, and, for one not archived, the archive that keeps it instead. */
function deleteQuestion(name: string, archived: boolean): DialogQuestion {
  const lost = `“${name}” and its transcript will be deleted. This can’t be undone.`;
  return {
    title: "Permanently delete agent?",
    body: archived ? lost : `${lost} To keep it out of the way instead, archive it.`,
    verb: DELETE_LABEL,
    running: "Deleting",
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
  agent: Pick<CodingAgentSummary, "id" | "title" | "automationName" | "model" | "archivedAt">,
  agents: Pick<CodingAgentsControl, "onDelete" | "models">,
  input: { readonly shown: boolean; readonly onDeleted?: (() => void) | undefined },
): AgentDelete {
  const { shown, onDeleted } = input;
  const confirm = useConfirmDialog({ subject: true, surfaceOpen: shown }, () =>
    agents.onDelete(agent.id).then((result) => {
      if (result.status === ACTION_RESULT_STATUS.ACCEPTED) onDeleted?.();
      return result;
    }),
  );
  return {
    action: { label: DELETE_LABEL, icon: <TrashIcon />, onSelect: confirm.ask, danger: true },
    dialog: (
      <ConfirmDialog
        confirm={confirm}
        question={deleteQuestion(agentName(agent, agents.models), agent.archivedAt !== undefined)}
      />
    ),
  };
}
