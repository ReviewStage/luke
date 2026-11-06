import type { AgentSummary } from "@repo/features/agent-wire";
import {
  AGENT_STATUS_WORDS,
  type AutomationRunPlace,
  automationFiringTitle,
  automationRunLine,
  automationRunPlace,
} from "@repo/features/automation-list-model";
import { automationRun } from "@repo/features/model-label";
import { momentText, sinceText } from "@repo/features/time-format";
import {
  FiringGlyph,
  GAP,
  Inline,
  PAGER_AXIS,
  PAGER_COUNT,
  Pager,
  PaneBar,
  QuietWords,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  type ToolbarPlace,
  Tooltip,
  useMinute,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab.js";
import { useAutomationRuns } from "./use-automation-runs.js";

const AUTOMATIONS_PLACE = "Automations";

const OLDER_RUN = "Older run";
const NEWER_RUN = "Newer run";

const RUN_NOUN = "Run";

export function automationTrail(
  agent: Pick<AgentSummary, "automationId" | "automationName">,
  tasks: Pick<TasksControl, "automationsView">,
): readonly ToolbarPlace[] | undefined {
  const name = automationRun(agent)?.name;
  if (name === undefined) return undefined;
  const { automationId } = agent;
  const { onOpen } = tasks.automationsView;
  const automations: ToolbarPlace = {
    label: AUTOMATIONS_PLACE,
    icon: <GLYPH.AUTOMATION />,
    onPress: () => onOpen({ kind: AUTOMATIONS_PAGE.LIST }),
  };
  if (automationId === undefined) return [automations];
  return [
    automations,
    {
      label: name,
      onPress: () => onOpen({ kind: AUTOMATIONS_PAGE.EDIT, automationId }),
    },
  ];
}

export function useAutomationRunPlace(
  agent: Pick<AgentSummary, "id" | "automationId"> | undefined,
): AutomationRunPlace | undefined {
  const { read } = useAutomationRuns(agent?.automationId);
  if (agent === undefined || read === undefined || !("runs" in read)) return undefined;
  return automationRunPlace(read.runs, agent.id);
}

export function AutomationRunStrip({
  place,
  status,
}: {
  place: AutomationRunPlace;
  status: AgentSummary["status"];
}): React.JSX.Element {
  const now = useMinute();
  const { run } = place;
  const line = automationRunLine(run);
  return (
    <PaneBar
      mark={<FiringGlyph of={run.firing} />}
      title={automationFiringTitle(run.firing)}
      detail={
        <Inline gap={GAP.ITEM} wrap={false}>
          <Tooltip label={momentText(run.firedAt)}>
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              <ReplayUnmask>{sinceText(run.firedAt, now)}</ReplayUnmask>
            </Text>
          </Tooltip>
          <Tooltip label={line}>
            <span>
              <QuietWords>
                <ReplayUnmask>{AGENT_STATUS_WORDS[status]}</ReplayUnmask>
              </QuietWords>
            </span>
          </Tooltip>
        </Inline>
      }
    />
  );
}

export function AutomationRunSteps({
  place,
  onOpenAgent,
}: {
  place: AutomationRunPlace;
  onOpenAgent: (agentId: string) => void;
}): React.JSX.Element {
  const { older, newer } = place;
  return (
    <Pager
      axis={PAGER_AXIS.HORIZONTAL}
      count={PAGER_COUNT.BETWEEN}
      place={{ at: place.at, total: place.count, noun: RUN_NOUN }}
      previous={{
        label: OLDER_RUN,
        onStep: older === undefined ? undefined : () => onOpenAgent(older),
      }}
      next={{
        label: NEWER_RUN,
        onStep: newer === undefined ? undefined : () => onOpenAgent(newer),
      }}
    />
  );
}
