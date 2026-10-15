import { APP_COMMAND } from "#shared/shortcuts";
import { useAct } from "../act";
import { useAppCommand } from "../app-commands";
import { AgentTab } from "../planning/agent-tab";
import { agentTabLabel } from "../planning/coding-agent-model";
import { useCodingAgents } from "../planning/use-coding-agents";
import type { PlansControl } from "../planning/use-plans-tab";
import { ReadFailure } from "../read-failure";
import { SPINNER_SIZE, Spinner } from "../spinner";

/**
 * desktop-agent-page.tsx -- one agent's page: an agent an automation started with no plan, drawn as its tab would be, in the plan's place.
 *
 * An agent an automation's run starts belongs to the workspace rather than
 * to a plan, so there is no plan's column for its tab to stand in. Its page
 * stands where the plan would, beside the sidebar, as the Inbox does, and
 * draws the agent's tab whole: its transcript, its composer, its model and
 * servers, and what it published, each through the same control a plan's
 * agents are driven by, here holding the one agent read by its id
 * (`use-coding-agents.ts`'s `agentId`). Its title names the agent as its tab
 * would. Its workers open nowhere yet, since a worker opens in the side
 * panel a plan's column keeps. Escape leaves it for wherever it was opened
 * from, and so does any row of the sidebar.
 */

/** What the page says where the agent could not be read. */
const NOT_READ = "This agent could not be read.";

/** Nothing to do, for the doors a plan's column opens and this page does not have. */
const nothing = (): void => undefined;

/** One agent's page, in the plan's place: the agent read by its id, drawn as its tab. */
export function DesktopAgentPage({
  plans,
  agentId,
}: {
  plans: PlansControl;
  agentId: string;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_AGENT_PAGE, plans.agentView.onClose);
  const { act } = useAct();
  const agents = useCodingAgents({
    acts: { act },
    planId: undefined,
    agentId,
    repository: null,
    archived: false,
    onUnarchive: nothing,
    onOpenIntegrations: plans.agents.onOpenIntegrations,
    onOpenApiKeys: plans.agents.onOpenApiKeys,
    onStarted: nothing,
  });
  const agent = agents.agents?.[0] ?? agents.archived?.[0];
  // Note that the models come from the open plan's agents where this page has not read them, so the agent is named alike in both.
  const control = { ...agents, models: agents.models ?? plans.agents.models };
  return (
    <section className="agent-page" aria-label="Agent">
      <header className="desktop-toolbar">
        <div className="desktop-toolbar-heading">
          {agent === undefined ? null : (
            <h1 className="desktop-toolbar-title">{agentTabLabel(agent, control.models)}</h1>
          )}
        </div>
      </header>
      {agent !== undefined ? (
        <AgentTab agent={agent} control={control} shown onOpenSubagent={nothing} onHeld={nothing} />
      ) : agents.listFailed ? (
        <div className="agent-page-note">
          <ReadFailure line={NOT_READ} onRetry={agents.onRetryList} />
        </div>
      ) : (
        <Spinner label="Loading agent" size={SPINNER_SIZE.INLINE} />
      )}
    </section>
  );
}
