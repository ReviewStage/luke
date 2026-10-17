import type { PullRequestStackEntry } from "@luke/features/coding-agent-wire";
import { LINK_PLACE, type LinkPlace } from "@luke/features/luke-link";
import { ACT_KIND } from "@luke/host/acts";
import { GitPullRequestDraftIcon, GitPullRequestIcon, LayersIcon } from "lucide-react";
import { useAct } from "../act";
import { ActionMenu, dropBelowStart, type MenuAction, useActionMenu } from "../desktop/action-menu";
import { Tooltip } from "../tooltip";
import { useOpenPlace } from "./use-open-link";

/**
 * pull-request-stack.tsx -- the stack a pull request stands in, on its header, as stage-cli shows one: "Stack 2/4", whose menu lists the stack from its tip down to its base and opens any of it.
 *
 * The service works the stack out (`pull-request-stack.ts`) and names the
 * agent of the workspace whose branch is each one's head. A pull request an
 * agent owns opens that agent's Pull request tab, on its own task's side
 * panel whatever task this one is on, through the window's own opener for a
 * Luke link (`LINK_PLACE.CHANGES`), as a link to that tab would; an agent
 * on no task opens its own page. One no agent owns opens on GitHub, and so
 * does every one outside the window, where there is no opener.
 */

/** What the menu says beside a pull request no agent owns, which opens on GitHub. */
const ON_GITHUB = "Opens on GitHub";

/** The place in Luke a stacked pull request's agent stands: its Pull request tab on its task, or its own page for an agent on none. */
function placeOf(agent: NonNullable<PullRequestStackEntry["agent"]>): LinkPlace {
  return agent.taskId === null
    ? { kind: LINK_PLACE.AGENT, agentId: agent.id }
    : { kind: LINK_PLACE.CHANGES, planId: agent.taskId, agentId: agent.id };
}

/** How a pull request of the stack opens: its agent's Pull request tab where an agent owns it and the window can open one, else its page on GitHub. */
function useOpenEntry(): (entry: PullRequestStackEntry) => void {
  const { tell } = useAct();
  const openPlace = useOpenPlace();
  return (entry) => {
    if (entry.agent !== undefined && openPlace !== undefined) {
      openPlace({ workspace: "", place: placeOf(entry.agent) });
    } else {
      tell(ACT_KIND.GITHUB_OPEN, { url: entry.url });
    }
  };
}

/**
 * The stack the pull request numbered `number` stands in, as a button
 * saying where in it this one stands, whose menu lists the stack tip first,
 * each by its number and title with a draft's own mark, this one checked
 * and not pressable; nothing where it stands in no stack.
 */
export function PullRequestStack({
  stack,
  number,
}: {
  /** The stack, base first, as the service lists it. */
  stack: readonly PullRequestStackEntry[];
  number: number;
}): React.JSX.Element | null {
  const at = stack.findIndex((entry) => entry.number === number);
  const shown = stack.length > 1 && at !== -1;
  const menu = useActionMenu(shown);
  const open = useOpenEntry();
  if (!shown) return null;
  const label = `Stack, ${at + 1} of ${stack.length}`;
  const actions: MenuAction[] = [...stack].reverse().map((entry) => {
    const current = entry.number === number;
    return {
      label: `#${entry.number} ${entry.title}`,
      icon: entry.draft ? (
        <GitPullRequestDraftIcon aria-hidden="true" />
      ) : (
        <GitPullRequestIcon aria-hidden="true" />
      ),
      detail: current || entry.agent !== undefined ? undefined : ON_GITHUB,
      ...(current ? { checked: true, disabled: true } : undefined),
      onSelect: () => open(entry),
    };
  });
  return (
    <>
      <Tooltip label={label}>
        <button
          type="button"
          className="pull-request-stack"
          aria-label={label}
          {...menu.trigger(dropBelowStart)}
        >
          <LayersIcon aria-hidden="true" />
          Stack
          <span className="pull-request-stack-count">
            {at + 1}/{stack.length}
          </span>
        </button>
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label="Pull requests in the stack"
          heading={`${stack.length} pull requests`}
          menu={menu.drawn}
          groups={[actions]}
          onClose={menu.close}
        />
      )}
    </>
  );
}
