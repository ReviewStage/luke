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
import { pressAct } from "../act.js";
import { appPlatform } from "../app-platform.js";
import { APP_SLICE, useAppSlice, useCapability } from "../use-app-state.js";

/**
 * agent-forward.tsx -- the Forward chip an agent's message box wears beside its Cloud chip: whether the agent's cloud ports are forwarded to this Mac's localhost, and the menu that turns it on and opens them.
 *
 * Only the desktop's host listens on the Mac's loopback
 * (`HOST_CAPABILITY.PORT_FORWARDS`), and only an agent in a cloud sandbox
 * has ports to forward, so the chip stands nowhere else. Off, it reads
 * "Forward" beside a plug; on, it reads the first forwarded port's local
 * address ("localhost:3000") and its plug wears a dot in the complete tone.
 * A press raises a menu with the Forward to localhost switch and, while it
 * is on, one row per port, "3000 → localhost:3000", whose press opens that
 * address in the default browser; "No ports detected" where none listens,
 * and "Sandbox not running" while the sandbox is stopped. The host keeps
 * how forwarding stands in app state (`portForwarding`), following the
 * sandbox's ports itself, so the chip only reads it. Every word it draws is the app's own, port
 * numbers among them, so a screen recording shows them as they read.
 */

/** What an agent forwarding is off for reads. */
const OFF: PortForwardingAnswer = { on: false, running: false, ports: [] };

/** What the chip and its menu say. */
const WORDS = {
  FORWARD: "Forward",
  MENU: "Forward to localhost",
  FORWARDING: "Forwarding",
  OPEN: "Open",
  NO_PORTS: "No ports detected",
  NOT_RUNNING: "Sandbox not running",
  NO_LOCAL_PORT: "No local port free",
} as const;

/** The local address a port is forwarded to. */
function localAddress(localPort: number): string {
  return `localhost:${localPort}`;
}

/** What the chip reads: the first forwarded port's local address while on, "Forward" otherwise. */
function forwardChipWords(answer: PortForwardingAnswer): string {
  if (!answer.on) return WORDS.FORWARD;
  const first = answer.ports.find((each) => each.localPort !== undefined);
  return first?.localPort === undefined ? WORDS.FORWARD : localAddress(first.localPort);
}

/** The rows under the switch while forwarding is on: one per port, or the line saying why there are none. */
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

/** The agent's forwarding as the host keeps it: off for any agent but the one forwarded. */
function useForwarding(agentId: string): PortForwardingAnswer {
  const forwarding = useAppSlice(APP_SLICE.PORT_FORWARDING);
  return forwarding?.agentId === agentId ? forwarding : OFF;
}

/** The chip and its menu. */
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

/** The Forward chip for an agent in a cloud sandbox, on a platform that forwards ports; nothing otherwise. */
export function AgentForward({
  agent,
  narrow = false,
}: {
  agent: Pick<AgentSummary, "id" | "machine">;
  /** Whether the box is too narrow for the chip's words, so it draws its glyph alone. */
  narrow?: boolean;
}): React.JSX.Element | null {
  const offered = useCapability(HOST_CAPABILITY.PORT_FORWARDS);
  if (!offered || agent.machine === AGENT_MACHINE.DEVICE) return null;
  return <ForwardControl agentId={agent.id} narrow={narrow} />;
}
