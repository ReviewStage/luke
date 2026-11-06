import {
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
  type PullRequestStackEntry,
} from "@repo/features/agent-wire";
import { LINK_PLACE, type LinkPlace } from "@repo/features/link-grammar";
import { ACT_KIND } from "@repo/host/acts";
import { BUTTON_VARIANT, Button, dropBelowStart, Tooltip, useMenu } from "@repo/ui";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { pullRequestLabelOf } from "@repo/ui/tab-strip-model";
import { useMutation } from "@tanstack/react-query";
import { LayersIcon } from "lucide-react";
import { pressMutation } from "../act-mutations.js";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { PullRequestMark, type PullRequestMarked } from "./pull-request-mark.js";
import { useOpenPlace } from "./use-open-link.js";

const ON_GITHUB = "Opens on GitHub";

const QUEUED = "Queued";

function entryDetail(entry: PullRequestStackEntry, current: boolean): string | undefined {
  const onGitHub = current || entry.agent !== undefined ? undefined : ON_GITHUB;
  if (entry.queued !== true) return onGitHub;
  return onGitHub === undefined ? QUEUED : `${QUEUED} · ${onGitHub}`;
}

function markOf(entry: PullRequestStackEntry): PullRequestMarked {
  return {
    number: entry.number,
    state: entry.draft ? PULL_REQUEST_STATE.DRAFT : PULL_REQUEST_STATE.OPEN,
    checks: CHECK_SUMMARY.NONE,
    ...(entry.queued === true ? { queued: true } : undefined),
  };
}

function placeOf(agent: NonNullable<PullRequestStackEntry["agent"]>): LinkPlace {
  const task = agent.taskId === null ? undefined : { planId: agent.taskId };
  return { kind: LINK_PLACE.CHANGES, ...task, agentId: agent.id };
}

function useOpenEntry(): (entry: PullRequestStackEntry) => void {
  const { mutate: openOnGitHub } = useMutation(pressMutation(ACT_KIND.GITHUB_OPEN));
  const openPlace = useOpenPlace();
  return (entry) => {
    if (entry.agent !== undefined && openPlace !== undefined) {
      openPlace(placeOf(entry.agent));
    } else {
      openOnGitHub({ url: entry.url });
    }
  };
}

export function PullRequestStack({
  stack,
  number,
}: {
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
      replayMasked: true,
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
          replayUnmasked
          label="Pull requests in the stack"
          heading={<ReplayUnmask>{`${stack.length} pull requests`}</ReplayUnmask>}
          menu={menu.drawn}
          groups={[actions]}
          onClose={menu.close}
        />
      )}
    </>
  );
}
