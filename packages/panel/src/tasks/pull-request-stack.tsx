import {
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
  type PullRequestStackEntry,
} from "@luke/features/coding-agent-wire";
import { LINK_PLACE, type LinkPlace } from "@luke/features/link-grammar";
import { ACT_KIND } from "@luke/host/acts";
import { BUTTON_VARIANT, Button, dropBelowStart, Tooltip, useMenu } from "@luke/ui";
import { pullRequestLabelOf } from "@luke/ui/tab-strip-model";
import { LayersIcon } from "lucide-react";
import { useAct } from "../act.js";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { PullRequestMark, type PullRequestMarked } from "./pull-request-mark.js";
import { useOpenPlace } from "./use-open-link.js";

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

/** What an entry in GitHub's merge queue says, as its Pull request tab's pill says it. */
const QUEUED = "Queued";

/** The words under an entry: queued where the merge queue holds it, and that it opens on GitHub where no agent of the workspace opened it and it is not the one shown. */
function entryDetail(entry: PullRequestStackEntry, current: boolean): string | undefined {
  const onGitHub = current || entry.agent !== undefined ? undefined : ON_GITHUB;
  if (entry.queued !== true) return onGitHub;
  return onGitHub === undefined ? QUEUED : `${QUEUED} · ${onGitHub}`;
}

/** What a stacked entry's mark is drawn from: the stack lists open and draft pull requests only, and carries no checks, so its mark says none of them. */
function markOf(entry: PullRequestStackEntry): PullRequestMarked {
  return {
    number: entry.number,
    state: entry.draft ? PULL_REQUEST_STATE.DRAFT : PULL_REQUEST_STATE.OPEN,
    checks: CHECK_SUMMARY.NONE,
    ...(entry.queued === true ? { queued: true } : undefined),
  };
}

/** The place in Luke a stacked pull request's agent stands: its Pull request tab on its task, or its own page for an agent on none. */
function placeOf(agent: NonNullable<PullRequestStackEntry["agent"]>): LinkPlace {
  return agent.taskId === null
    ? { kind: LINK_PLACE.AGENT, agentId: agent.id }
    : { kind: LINK_PLACE.CHANGES, planId: agent.taskId, agentId: agent.id };
}

/** How a pull request of the stack opens: its agent's Pull request tab where an agent owns it and the window can open one, else its page on GitHub. */
function useOpenEntry(): (entry: PullRequestStackEntry) => void {
  const { press } = useAct();
  const openPlace = useOpenPlace();
  return (entry) => {
    if (entry.agent !== undefined && openPlace !== undefined) {
      openPlace(placeOf(entry.agent));
    } else {
      press(ACT_KIND.GITHUB_OPEN, { url: entry.url });
    }
  };
}

/**
 * The stack the pull request numbered `number` stands in, as a button
 * saying where in it this one stands, whose menu lists the stack tip first,
 * each by its number and title wearing its state's mark, this one checked
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
  const menu = useMenu(shown);
  const open = useOpenEntry();
  if (!shown) return null;
  const label = `Stack, ${at + 1} of ${stack.length}`;
  const actions: MenuAction[] = [...stack].reverse().map((entry) => {
    const current = entry.number === number;
    return {
      label: pullRequestLabelOf(entry),
      icon: <PullRequestMark pullRequest={markOf(entry)} />,
      detail: entryDetail(entry, current),
      ...(current ? { checked: true, disabled: true } : undefined),
      onSelect: () => open(entry),
    };
  });
  return (
    <>
      <Tooltip label={label}>
        <Button
          variant={BUTTON_VARIANT.OUTLINE}
          icon={<LayersIcon aria-hidden="true" />}
          label={label}
          {...menu.trigger(dropBelowStart)}
        >
          Stack{" "}
          <span className="text-muted-foreground tabular-nums">
            {at + 1}/{stack.length}
          </span>
        </Button>
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
