import {
  AGENT_MACHINE,
  type AgentRunsOnRequest,
  type AgentSummary,
} from "@repo/features/agent-wire";
import type { MacOffer } from "@repo/features/models-wire";
import { EXPERIMENT } from "@repo/settings";
import { GLYPH } from "@repo/ui/icons";
import { commandHead, PANEL_COMMAND } from "../command-items.js";
import type { MenuAction, MenuSubmenu } from "../desktop/action-menu.js";
import { useDevicePresence } from "../device-presence.js";
import { machineName, useThisMac } from "../machine-name.js";
import { useExperiment } from "../use-app-state.js";
import { agentStillWriting, offersContinue } from "./agent-model.js";
import { deviceMark, RUNS_ON_WORDS } from "./runs-on.js";
import type { AgentsControl } from "./use-agents.js";

/**
 * move-agent.tsx -- an agent moved between the cloud and the member's own devices: its menu's Move to ›, which continues it at the place picked.
 *
 * A move is a continue onto another place (`use-agents.ts`'s
 * `continueAgent` with a `runsOn`), not a mechanism of its own: the service
 * stops the source, replays its transcript into a new agent at the place,
 * named `<title> (continued)`, and copies a cloud source's work, what it had
 * not committed included, to a branch of its own; the new agent's tab opens
 * as a continue's does, and a refusal is said in a toast. An agent on a
 * device brings only what it pushed, which each place says under its name,
 * and its folder stays on that device. Move to lists Cloud, then each device
 * the member registered, by what every list of machines calls it, its glyph
 * wearing its standing's dot (`runs-on.tsx`), less the place the agent runs
 * now; a device that takes no agent now is listed dimmed, saying why. It
 * stands only while Bring your own host is on, and only where a Continue is
 * offered: where a Start from the agent could run (`continueAgent`), under
 * nothing archived, on an agent not archived and at rest, of a task whose
 * mode offers it a continue (`offersContinue`). Note that it also stands
 * only where the control lists the agent, its task's or its own page's,
 * because a surface drawing agents of other tasks, such as a person's page,
 * hands the open task's control, whose continue would start on that task.
 */

/** What Move to says beyond the places' names. */
export const MOVE_WORDS = {
  PUSHED_ONLY: "Only pushed work comes along",
} as const;

/** No devices, held steady for a member with none, or while the menu offers no move. */
const NO_DEVICES: readonly MacOffer[] = [];

/** The cloud, as a move names it. */
const TO_THE_CLOUD: AgentRunsOnRequest = { machine: AGENT_MACHINE.VERCEL };

/** The agent's Move to ›, the places it may move to, or none where it offers no move or has nowhere to go. */
export function useMoveToEntry(
  agent: Pick<AgentSummary, "id" | "status" | "archivedAt" | "machine" | "mac" | "pilot">,
  agents: Pick<AgentsControl, "agents" | "continueAgent" | "macs" | "mode" | "onUnarchive">,
): MenuSubmenu | undefined {
  const { continueAgent } = agents;
  const offered =
    useExperiment(EXPERIMENT.BRING_YOUR_OWN_HOST) &&
    agents.onUnarchive === undefined &&
    agents.agents?.some((each) => each.id === agent.id) === true &&
    agent.archivedAt === undefined &&
    !agentStillWriting(agent.status) &&
    offersContinue(agents.mode, agent);
  const devices = (offered ? agents.macs : undefined) ?? NO_DEVICES;
  // Note that the beats are read only while a device is listed, so a member with none reads nothing.
  const book = useDevicePresence(devices.length > 0);
  const thisMac = useThisMac();
  if (!offered || continueAgent === undefined) return undefined;
  const local = agent.machine === AGENT_MACHINE.DEVICE;
  const pushedOnly = local ? MOVE_WORDS.PUSHED_ONLY : undefined;
  const moveTo = (runsOn: AgentRunsOnRequest) => () =>
    void continueAgent(agent.id, undefined, [], runsOn);
  const cloud: MenuAction[] = local
    ? [
        {
          label: RUNS_ON_WORDS.CLOUD,
          icon: <GLYPH.CLOUD />,
          detail: pushedOnly,
          onSelect: moveTo(TO_THE_CLOUD),
        },
      ]
    : [];
  const elsewhere = devices.filter((device) => !local || device.deviceId !== agent.mac?.deviceId);
  const items = [
    ...cloud,
    ...elsewhere.map((device): MenuAction => {
      const { icon, unready } = deviceMark(device, book);
      return {
        label: machineName(device, devices, thisMac),
        key: device.deviceId,
        icon,
        detail: unready ?? pushedOnly,
        disabled: unready !== undefined,
        onSelect: moveTo({ machine: AGENT_MACHINE.DEVICE, deviceId: device.deviceId }),
      };
    }),
  ];
  return items.length === 0 ? undefined : { ...commandHead(PANEL_COMMAND.MOVE_AGENT), items };
}
