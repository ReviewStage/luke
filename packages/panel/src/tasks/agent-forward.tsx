import { AGENT_MACHINE, type AgentSummary } from "@repo/features/agent-wire";
import { PORT_FORWARD_STATE, type PortForwardingAnswer } from "@repo/features/port-forward-acts";
import { ACT_KIND } from "@repo/host/acts";
import { HOST_CAPABILITY } from "@repo/settings";
import {
  CHIP_LOOK,
  Chip,
  ChipName,
  dropBelow,
  MENU_ITEM_MARK,
  Menu,
  type MenuAction,
  STATUS_TONE,
  StatusGlyph,
  useMenu,
} from "@repo/ui";
import { PlugIcon } from "@repo/ui/icons";
import { useQuery } from "@tanstack/react-query";
import { pressAct } from "../act.js";
import { appPlatform } from "../app-platform.js";
import type { MenuSubmenu } from "../desktop/action-menu.js";
import { appStateQuery, selectCapability, selectPortForwarding } from "../use-app-state.js";

/**
 * agent-forward.tsx -- the Forward chip an agent's Terminal tab wears in its bar: whether the agent's cloud ports are forwarded to this Mac's localhost, and the menu that turns it on and opens them.
 *
 * Only the desktop's host listens on the Mac's loopback
 * (`HOST_CAPABILITY.PORT_FORWARDS`), and only an agent in a cloud sandbox
 * has ports to forward, so the chip stands nowhere else. Off, it reads
 * "Forward" beside a plug; on, it reads the first forwarded port's local
 * address ("localhost:3000") and its plug wears a dot in the complete tone.
 * It stands beside the sandbox's shells, where its dev servers run, and a
 * press drops a menu under it with the Forward to localhost switch and, while it
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
function useForwarding(agentId: string | undefined): PortForwardingAnswer {
  const forwarding = useQuery({ ...appStateQuery, select: selectPortForwarding }).data;
  return agentId !== undefined && forwarding?.agentId === agentId ? forwarding : OFF;
}

/** Whether this platform forwards ports and the agent has any to forward: one in a cloud sandbox. */
function useOffered(agent: Pick<AgentSummary, "machine"> | undefined): boolean {
  const offered =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.PORT_FORWARDS) }).data ===
    true;
  return offered && agent !== undefined && agent.machine !== AGENT_MACHINE.DEVICE;
}

/** The menu's switch and its port rows, as the chip and a phone's ⋯ both offer them. */
function forwardItems(
  agentId: string,
  answer: PortForwardingAnswer,
): { toggle: MenuAction; ports: MenuAction[] } {
  return {
    toggle: {
      label: WORDS.MENU,
      checked: answer.on,
      mark: MENU_ITEM_MARK.SWITCH,
      stays: true,
      onSelect: () => void pressAct(ACT_KIND.PORT_FORWARD_SET, { agentId, on: !answer.on }),
    },
    ports: portRows(answer, (localPort) =>
      appPlatform().openWeb(`http://${localAddress(localPort)}`),
    ),
  };
}

/** The chip and its menu. */
function ForwardControl({ agentId }: { agentId: string }): React.JSX.Element {
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
  const { toggle, ports } = forwardItems(agentId, answer);
  return (
    <>
      <Chip
        look={CHIP_LOOK.TOOLBAR}
        aria-label={`${WORDS.MENU}: ${words}`}
        {...menu.trigger(dropBelow)}
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
}: {
  agent: Pick<AgentSummary, "id" | "machine"> | undefined;
}): React.JSX.Element | null {
  const offered = useOffered(agent);
  if (!offered || agent === undefined) return null;
  return <ForwardControl agentId={agent.id} />;
}

/**
 * The chip's menu as a submenu of the Terminal tab's ⋯, for a room too
 * narrow for the tab's bar, where the chip would otherwise stand nowhere;
 * none where the chip draws nothing. A port's row says where it is
 * forwarded, its press opening it, without the chip's Open hint.
 */
export function useForwardEntry(
  agent: Pick<AgentSummary, "id" | "machine"> | undefined,
): MenuSubmenu | undefined {
  const offered = useOffered(agent);
  const answer = useForwarding(agent?.id);
  if (!offered || agent === undefined) return undefined;
  const { toggle, ports } = forwardItems(agent.id, answer);
  return {
    label: forwardChipWords(answer),
    icon: <PlugIcon aria-hidden="true" />,
    items: [toggle, ...ports].map(({ hint: _hint, ...item }) => item),
  };
}
