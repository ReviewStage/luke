import {
  AGENT_STATUS_WORDS,
  type AutomationRunPlace,
  automationFiringTitle,
  automationRunLine,
  automationRunPlace,
} from "@luke/features/automation-list-model";
import type { CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { momentText, sinceText } from "@luke/features/time-format";
import {
  Badge,
  FiringGlyph,
  GAP,
  IconButton,
  Inline,
  PaneBar,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  type ToolbarPlace,
  Tooltip,
  useMinute,
} from "@luke/ui";
import { ChevronLeftIcon, ChevronRightIcon, GLYPH } from "@luke/ui/icons";
import { AGENT_STATUS_TONE } from "../tasks/coding-agent-model.js";
import { AUTOMATIONS_PAGE, type TasksControl } from "../tasks/use-tasks-tab.js";
import { useAutomationRuns } from "./use-automation-runs.js";

/**
 * automation-agent-run.tsx -- what an agent's page says of the automation run that started it: the path to its automation, the run's bar under the page's, and the arrows through the automation's other runs.
 *
 * An agent an automation's run started stands on a page of its own with no
 * task to place it, so its bar leads with where it came from, Automations
 * and then its automation, each a press back to that page (the
 * automation's editor), the agent's own name last. Under the bar the run's
 * own bar, a tab's (`PaneBar`), says what fired its run, as the automation's runs panel says it (the
 * firing's glyph and words), when it fired, and where the agent stands as a
 * badge, whose hint is the run's line as that panel reads it. At the bar's
 * end, before its ⋯, two arrows step to the agents of the automation's runs
 * either side, older to the left and newer to the right, with "Run 3 of 5"
 * between them, counted from the oldest. Only runs that started an agent are
 * stepped through, each agent once, at its newest run. The runs are the
 * automation's own, followed live as its runs panel follows them, so a
 * newer run lands while the page stands; an agent whose run is not among
 * them (an automation deleted, or a run older than the runs read) keeps its
 * path and draws no run's bar and no arrows.
 */

/** What the trail's outer place is called, as the automation editor's names it. */
const AUTOMATIONS_PLACE = "Automations";

/** What the arrows are called. */
const OLDER_RUN = "Older run";
const NEWER_RUN = "Newer run";

/** The trail an agent an automation started leads its bar with; none for any other agent. */
export function automationTrail(
  agent: Pick<CodingAgentSummary, "automationId" | "automationName">,
  tasks: Pick<TasksControl, "automationsView">,
): readonly ToolbarPlace[] | undefined {
  const { automationId, automationName } = agent;
  if (automationName === undefined) return undefined;
  const { onOpen } = tasks.automationsView;
  const automations: ToolbarPlace = {
    label: AUTOMATIONS_PLACE,
    icon: <GLYPH.AUTOMATION />,
    onPress: () => onOpen({ kind: AUTOMATIONS_PAGE.LIST }),
  };
  // Note that an automation deleted since keeps its name on the agent, but there is no page to open.
  if (automationId === undefined) return [automations];
  return [
    automations,
    {
      label: automationName,
      onPress: () => onOpen({ kind: AUTOMATIONS_PAGE.EDIT, automationId }),
    },
  ];
}

/** Where the page's agent's run stands among its automation's runs, followed live; none for an agent no automation started, or while its run is not read. */
export function useAutomationRunPlace(
  agent: Pick<CodingAgentSummary, "id" | "automationId"> | undefined,
): AutomationRunPlace | undefined {
  const { read } = useAutomationRuns(agent?.automationId);
  if (agent === undefined || read === undefined || !("runs" in read)) return undefined;
  return automationRunPlace(read.runs, agent.id);
}

/** The run's bar under the page's, as tall and on the same ground as a tab's: what fired the run, when, and where its agent stands. */
export function AutomationRunStrip({
  place,
  status,
}: {
  place: AutomationRunPlace;
  /** The agent's own status, read live with the page's agent rather than off the run. */
  status: CodingAgentSummary["status"];
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
              {sinceText(run.firedAt, now)}
            </Text>
          </Tooltip>
          <Tooltip label={line}>
            <span>
              <Badge tone={AGENT_STATUS_TONE[status]}>{AGENT_STATUS_WORDS[status]}</Badge>
            </span>
          </Tooltip>
        </Inline>
      }
    />
  );
}

/** The arrows through the automation's runs, older to the left and newer to the right, each stepped back at its end, and where this run stands between them. */
export function AutomationRunSteps({
  place,
  onOpenAgent,
}: {
  place: AutomationRunPlace;
  onOpenAgent: (agentId: string) => void;
}): React.JSX.Element {
  const { older, newer } = place;
  return (
    <Inline gap={GAP.TIGHT} wrap={false}>
      <Tooltip label={OLDER_RUN}>
        <IconButton
          icon={<ChevronLeftIcon />}
          label={OLDER_RUN}
          disabled={older === undefined}
          onClick={older === undefined ? undefined : () => onOpenAgent(older)}
        />
      </Tooltip>
      <Text
        as={TEXT_ELEMENT.SPAN}
        variant={TEXT_VARIANT.CAPTION}
        tone={TEXT_TONE.MUTED}
        className="automation-agent-run-count"
      >
        {`Run ${place.at} of ${place.count}`}
      </Text>
      <Tooltip label={NEWER_RUN}>
        <IconButton
          icon={<ChevronRightIcon />}
          label={NEWER_RUN}
          disabled={newer === undefined}
          onClick={newer === undefined ? undefined : () => onOpenAgent(newer)}
        />
      </Tooltip>
    </Inline>
  );
}
