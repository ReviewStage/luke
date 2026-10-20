import type { CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { ConfirmDialog, DIALOG_TONE, type DialogQuestion, useConfirmDialog } from "@luke/ui";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { UserRoundCheckIcon } from "lucide-react";
import { agentStillWriting, agentTabLabel, takeOverEffects } from "../tasks/coding-agent-model.js";
import type { CodingAgentsControl } from "../tasks/use-coding-agents.js";
import type { MenuAction } from "./action-menu.js";

/**
 * agent-take-over.tsx -- Take over, from a teammate's agent's tab menu or its page's ⋯: the question it asks first, saying what taking it over does.
 *
 * An agent runs as the member who started it, so a teammate's agent is
 * taken over rather than handed: a new agent of the reader's goes on from it
 * (`coder-host/take-over.ts`). The menu offers it on an agent another member
 * started, while it is not archived and its task is not, and never on the
 * reader's own, nor where the window cannot tell who started it. It always
 * asks first, since it runs on the reader's keys and Mac and archives the
 * teammate's agent, and the question says so (`takeOverEffects`); one still
 * working asks to stop and take over, since the take-over stops the turn it
 * is on. The question goes with the surface it was asked on; a take-over
 * that landed opens the new agent's tab, or its page for an agent with no
 * task (`use-coding-agents.ts`), and one refused keeps the question up
 * saying why.
 */

/** What the menu item says. */
const TAKE_OVER_LABEL = "Take over";

/** Who started the agent, where the window was not told their name. */
const UNNAMED_OWNER = "A teammate";

/** What a question still standing says once its task was archived meanwhile, which no agent is taken over on. */
const TAKE_OVER_GONE = "This agent can't be taken over now.";

/** What asking to take over an agent says, and does, while it is at rest or still working: who started it, and that a new agent goes on from it. */
function takeOverQuestion(name: string, owner: string, working: boolean): DialogQuestion {
  return {
    title: `${working ? "Stop and take over" : "Take over"} “${name}”?`,
    body: `${owner} started it. A new agent of yours goes on from where it stopped.`,
    verb: working ? "Stop and take over" : TAKE_OVER_LABEL,
    running: "Taking over…",
    tone: DIALOG_TONE.PRIMARY,
  };
}

/** Whether the menu offers the reader a take-over of the agent: another member's, standing, on a task that is not archived. */
function offersTakeOver(agent: CodingAgentSummary, agents: CodingAgentsControl): boolean {
  const owner = agent.startedBy?.userId;
  return (
    agents.onTakeOver !== undefined &&
    agents.me !== undefined &&
    owner !== undefined &&
    owner !== agents.me &&
    agent.archivedAt === undefined
  );
}

/** An agent's Take over as a menu offers it, where it does, and the question it asks through. */
export interface AgentTakeOver {
  action: MenuAction | undefined;
  dialog: React.JSX.Element;
}

/**
 * One agent's Take over as a menu offers it, none where it offers none, and
 * the dialog it asks through, which the caller draws beside the menu.
 */
export function useAgentTakeOver(
  agent: CodingAgentSummary,
  agents: CodingAgentsControl,
  shown: boolean,
): AgentTakeOver {
  const offered = offersTakeOver(agent, agents);
  const { onTakeOver } = agents;
  const confirm = useConfirmDialog({ subject: offered, surfaceOpen: shown }, () =>
    onTakeOver === undefined
      ? Promise.resolve({ status: ACTION_RESULT_STATUS.REJECTED, reason: TAKE_OVER_GONE })
      : onTakeOver(agent.id),
  );
  const owner = agent.startedBy?.name ?? UNNAMED_OWNER;
  const effects = takeOverEffects(owner, agents.pullRequests.get(agent.id));
  return {
    action: offered
      ? { label: TAKE_OVER_LABEL, icon: <UserRoundCheckIcon />, onSelect: confirm.ask }
      : undefined,
    dialog: (
      <ConfirmDialog
        confirm={confirm}
        question={takeOverQuestion(
          agentTabLabel(agent, agents.models),
          owner,
          agentStillWriting(agent.status),
        )}
      >
        <ul className="take-over-effects">
          {effects.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </ConfirmDialog>
    ),
  };
}
