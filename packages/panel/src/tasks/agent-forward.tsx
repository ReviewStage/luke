import { AGENT_MACHINE, type AgentSummary } from "@repo/features/agent-wire";
import { PORT_FORWARD_STATE, type PortForwardingAnswer } from "@repo/features/port-forward-acts";
import { ACT_KIND } from "@repo/host/acts";
import { HOST_CAPABILITY } from "@repo/settings";
import {
  CHIP_LOOK,
  Chip,
  ChipName,
  MENU_ITEM_MARK,
  Menu,
  type MenuAction,
  riseAbove,
  STATUS_TONE,
  StatusGlyph,
  useMenu,
} from "@repo/ui";
import { PlugIcon } from "@repo/ui/icons";
import { useQuery } from "@tanstack/react-query";
import { pressAct } from "../act.js";
import { appPlatform } from "../app-platform.js";
import { appStateQuery, selectCapability, selectPortForwarding } from "../use-app-state.js";

const OFF: PortForwardingAnswer = { on: false, running: false, ports: [] };

const WORDS = {
  FORWARD: "Forward",
  MENU: "Forward to localhost",
  FORWARDING: "Forwarding",
  OPEN: "Open",
  NO_PORTS: "No ports detected",
  NOT_RUNNING: "Sandbox not running",
  NO_LOCAL_PORT: "No local port free",
} as const;

function localAddress(localPort: number): string {
  return `localhost:${localPort}`;
}

function forwardChipWords(answer: PortForwardingAnswer): string {
  if (!answer.on) return WORDS.FORWARD;
  const first = answer.ports.find((each) => each.localPort !== undefined);
  return first?.localPort === undefined ? WORDS.FORWARD : localAddress(first.localPort);
}

function portRows(answer: PortForwardingAnswer, onOpen: (localPort: number) => void): MenuAction[] {
  if (!answer.on) return [];
  const none = (label: string): MenuAction[] => [{ label, disabled: true, onSelect: () => {} }];
  if (!answer.running) return none(WORDS.NOT_RUNNING);
  if (answer.ports.length === 0) return none(WORDS.NO_PORTS);
  return answer.ports.map(({ port, localPort, state }) =>
    localPort === undefined || state === PORT_FORWARD_STATE.UNAVAILABLE
      ? {
          key: port,
          label: `${port}`,
          detail: WORDS.NO_LOCAL_PORT,
          disabled: true,
          onSelect: () => {},
        }
      : {
          key: port,
          label: `${port} → ${localAddress(localPort)}`,
          hint: WORDS.OPEN,
          onSelect: () => onOpen(localPort),
        },
  );
}

function useForwarding(agentId: string): PortForwardingAnswer {
  const forwarding = useQuery({ ...appStateQuery, select: selectPortForwarding }).data;
  return forwarding?.agentId === agentId ? forwarding : OFF;
}

function ForwardControl({
  agentId,
  narrow,
}: {
  agentId: string;
  narrow: boolean;
}): React.JSX.Element {
  const menu = useMenu(true);
  const answer = useForwarding(agentId);
  const words = forwardChipWords(answer);
  const glyph = answer.on ? (
    <StatusGlyph tone={STATUS_TONE.COMPLETE} label={WORDS.FORWARDING}>
      <PlugIcon aria-hidden="true" />
    </StatusGlyph>
  ) : (
    <PlugIcon aria-hidden="true" />
  );
  const toggle: MenuAction = {
    label: WORDS.MENU,
    checked: answer.on,
    mark: MENU_ITEM_MARK.SWITCH,
    stays: true,
    onSelect: () => void pressAct(ACT_KIND.PORT_FORWARD_SET, { agentId, on: !answer.on }),
  };
  const ports = portRows(answer, (localPort) =>
    appPlatform().openWeb(`http://${localAddress(localPort)}`),
  );
  return (
    <>
      <Chip
        look={CHIP_LOOK.TOOLBAR}
        iconOnly={narrow}
        aria-label={`${WORDS.MENU}: ${words}`}
        {...menu.trigger(riseAbove)}
      >
        {glyph}
        <ChipName>{words}</ChipName>
      </Chip>
      {menu.drawn === undefined ? null : (
        <Menu
          label={WORDS.MENU}
          menu={menu.drawn}
          replayUnmasked
          groups={[[toggle], ports].filter((group) => group.length > 0)}
          onClose={menu.close}
        />
      )}
    </>
  );
}

export function AgentForward({
  agent,
  narrow = false,
}: {
  agent: Pick<AgentSummary, "id" | "machine">;
  narrow?: boolean;
}): React.JSX.Element | null {
  const offered =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.PORT_FORWARDS) }).data ===
    true;
  if (!offered || agent.machine === AGENT_MACHINE.DEVICE) return null;
  return <ForwardControl agentId={agent.id} narrow={narrow} />;
}
