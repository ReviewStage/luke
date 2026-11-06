import {
  AGENT_MACHINE,
  type AgentRunsOnRequest,
  type AgentSummary,
} from "@repo/features/agent-wire";
import type { MacOffer } from "@repo/features/models-wire";
import { EXPERIMENT } from "@repo/settings";
import { GLYPH } from "@repo/ui/icons";
import { useQuery } from "@tanstack/react-query";
import { commandHead, PANEL_COMMAND } from "../command-items.js";
import type { MenuAction, MenuSubmenu } from "../desktop/action-menu.js";
import { useDevicePresence } from "../device-presence.js";
import { machineName, useThisMac } from "../machine-name.js";
import { appStateQuery, selectExperiment } from "../use-app-state.js";
import { agentStillWriting, offersContinue } from "./agent-model.js";
import { deviceMark, RUNS_ON_WORDS } from "./runs-on.js";
import type { AgentsControl } from "./use-agents.js";

export const MOVE_WORDS = {
  PUSHED_ONLY: "Only pushed work comes along",
} as const;

const NO_DEVICES: readonly MacOffer[] = [];

const TO_THE_CLOUD: AgentRunsOnRequest = { machine: AGENT_MACHINE.VERCEL };

type MovedAgent = Pick<AgentSummary, "id" | "status" | "archivedAt" | "machine" | "mac" | "pilot">;

type MoveDoors = Pick<AgentsControl, "agents" | "continueAgent" | "macs" | "mode" | "onUnarchive">;

function useMoveOffered(agent: MovedAgent, agents: MoveDoors): boolean {
  return (
    useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.BRING_YOUR_OWN_HOST) })
      .data === true &&
    agents.onUnarchive === undefined &&
    agents.agents?.some((each) => each.id === agent.id) === true &&
    agent.archivedAt === undefined &&
    !agentStillWriting(agent.status) &&
    offersContinue(agents.mode, agent)
  );
}

export function useMoveToCloud(agent: MovedAgent, agents: MoveDoors): (() => void) | undefined {
  const offered = useMoveOffered(agent, agents);
  const { continueAgent } = agents;
  if (!offered || continueAgent === undefined || agent.machine !== AGENT_MACHINE.DEVICE)
    return undefined;
  return () => void continueAgent(agent.id, undefined, [], TO_THE_CLOUD);
}

export function useMoveToEntry(agent: MovedAgent, agents: MoveDoors): MenuSubmenu | undefined {
  const { continueAgent } = agents;
  const offered = useMoveOffered(agent, agents);
  const devices = (offered ? agents.macs : undefined) ?? NO_DEVICES;
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
  const here = local ? agent.mac?.deviceId : undefined;
  const elsewhere =
    local && here === undefined ? NO_DEVICES : devices.filter((each) => each.deviceId !== here);
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
