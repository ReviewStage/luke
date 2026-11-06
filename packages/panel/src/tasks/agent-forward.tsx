import { AGENT_MACHINE, type AgentSummary } from "@repo/features/agent-wire";
import { PORT_FORWARD_STATE, type PortForwardingAnswer } from "@repo/features/port-forward-acts";
import { ACT_KIND } from "@repo/host/acts";
import { HOST_CAPABILITY } from "@repo/settings";
import { MENU_ITEM_MARK, STATUS_TONE, StatusGlyph } from "@repo/ui";
import { PlugIcon } from "@repo/ui/icons";
import { useQuery } from "@tanstack/react-query";
import { pressAct } from "../act.js";
import { appPlatform } from "../app-platform.js";
import type { MenuAction, MenuSubmenu } from "../desktop/action-menu.js";
import { appStateQuery, selectCapability, selectPortForwarding } from "../use-app-state.js";

/**
 * agent-forward.tsx -- the Forward row an agent's + menu offers: whether the agent's cloud ports are forwarded to this Mac's localhost, and the submenu that turns it on and opens them.
 *
 * Only the desktop's host listens on the Mac's loopback
 * (`HOST_CAPABILITY.PORT_FORWARDS`), and only an agent in a cloud sandbox
 * has ports to forward, so the row stands nowhere else. Off, it reads
 * "Forward ports" beside a plug; on, it reads the first forwarded port's
 * local address ("Forwarding to localhost:3000") and its plug wears a dot in
 * the complete tone. It opens a submenu with the Forward to localhost switch
 * and, while it is on, one row per port, "3000 → localhost:3000", whose
 * press opens that address in the default browser; "No ports detected"
 * where none listens, and "Sandbox not running" while the sandbox is
 * stopped. The host keeps how forwarding stands in app state
 * (`portForwarding`), following the sandbox's ports itself, so the row only
 * reads it. Every word it draws is the app's own, port numbers among them,
 * so a screen recording shows them as they read.
 */

/** What an agent forwarding is off for reads. */
const OFF: PortForwardingAnswer = { on: false, running: false, ports: [] };

/** What the row and its submenu say. */
const WORDS = {
  FORWARD: "Forward ports",
  FORWARDING_TO: "Forwarding to",
  MENU: "Forward to localhost",
  FORWARDING: "Forwarding",
  NO_PORTS: "No ports detected",
  NOT_RUNNING: "Sandbox not running",
  NO_LOCAL_PORT: "No local port free",
} as const;

/** The local address a port is forwarded to. */
function localAddress(localPort: number): string {
  return `localhost:${localPort}`;
}

/** What the row reads: where the first forwarded port went while on, "Forward ports" otherwise. */
function forwardRowWords(answer: PortForwardingAnswer): string {
  if (!answer.on) return WORDS.FORWARD;
  const first = answer.ports.find((each) => each.localPort !== undefined);
  return first?.localPort === undefined
    ? WORDS.FORWARD
    : `${WORDS.FORWARDING_TO} ${localAddress(first.localPort)}`;
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
          onSelect: () => onOpen(localPort),
        },
  );
}

/**
 * The + menu's Forward row for an agent in a cloud sandbox, on a platform
 * that forwards ports; none otherwise.
 */
export function useForwardEntry(
  agent: Pick<AgentSummary, "id" | "machine">,
): MenuSubmenu | undefined {
  const offered =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.PORT_FORWARDS) }).data ===
    true;
  const forwarding = useQuery({ ...appStateQuery, select: selectPortForwarding }).data;
  if (!offered || agent.machine === AGENT_MACHINE.DEVICE) return undefined;
  const answer = forwarding?.agentId === agent.id ? forwarding : OFF;
  const toggle: MenuAction = {
    label: WORDS.MENU,
    checked: answer.on,
    mark: MENU_ITEM_MARK.SWITCH,
    stays: true,
    onSelect: () => void pressAct(ACT_KIND.PORT_FORWARD_SET, { agentId: agent.id, on: !answer.on }),
  };
  const ports = portRows(answer, (localPort) =>
    appPlatform().openWeb(`http://${localAddress(localPort)}`),
  );
  return {
    label: forwardRowWords(answer),
    icon: answer.on ? (
      <StatusGlyph tone={STATUS_TONE.COMPLETE} label={WORDS.FORWARDING}>
        <PlugIcon aria-hidden="true" />
      </StatusGlyph>
    ) : (
      <PlugIcon aria-hidden="true" />
    ),
    items: [toggle, ...ports],
  };
}
