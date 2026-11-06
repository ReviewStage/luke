import { AGENT_MACHINE, type AgentSummary } from "@repo/features/agent-wire";
import { PORT_FORWARD_STATE, type PortForwardingAnswer } from "@repo/features/port-forward-acts";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { APP_SETTING_DEFAULTS, HOST_CAPABILITY } from "@repo/settings";
import {
  CHIP_LOOK,
  Chip,
  ChipCount,
  ChipName,
  MENU_DETAIL,
  MENU_ITEM_MARK,
  riseAbove,
  STATUS_TONE,
  StatusGlyph,
  useMenu,
} from "@repo/ui";
import { GlobeIcon, PlugIcon } from "@repo/ui/icons";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { pressAct } from "../act.js";
import { appPlatform } from "../app-platform.js";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { useToast } from "../toast.js";
import {
  appStateQuery,
  selectAppSettingsView,
  selectCapability,
  selectPortForwarding,
} from "../use-app-state.js";
import { agentStillWriting } from "./agent-model.js";

/**
 * agent-forward.tsx -- an agent's cloud ports forwarded to this Mac's localhost: forwarded on their own while its tab is open, a toast saying so once, a chip at its box's foot while they are, and the + menu's switch while they are not.
 *
 * Only the desktop's host listens on the Mac's loopback
 * (`HOST_CAPABILITY.PORT_FORWARDS`), and only an agent in a cloud sandbox
 * has ports to forward, so none of it stands anywhere else. The host
 * forwards one agent at a time and follows its sandbox's ports itself, which
 * it keeps in app state (`portForwarding`), so all of this only reads it and
 * asks the host to turn forwarding on or off.
 *
 * With Forward cloud agents' ports to this Mac on (Settings › This Mac, on
 * by default), an agent at work whose tab is open is forwarded once no agent
 * is: the first keeps the ports until its forwarding is turned off or its
 * sandbox stops, so a browser tab open on one never starts showing another
 * agent's app. One the developer turned off in this window is left off
 * until they turn it on again. As the first port reaches the Mac, a toast
 * says its address once, with Open.
 *
 * While the agent is forwarded, its box's foot wears a chip after the
 * Cloud chip: the plug wearing a dot in the complete tone and the first
 * address, "localhost:3000", how many more beside it. Its menu holds the
 * Forward to localhost switch and one row per port, "localhost:3000", whose
 * press opens it in the default browser, with where it came from beside it
 * where the Mac's port differs ("from :3000"). While it is not, the + menu
 * offers the same switch. Every word drawn is the app's own, port numbers
 * among them, so a screen recording shows them as they read.
 */

/** What an agent forwarding is off for reads. */
const OFF: PortForwardingAnswer = { on: false, running: false, ports: [] };

/** What the chip, its menu, the + row, and the toast say. */
const WORDS = {
  SWITCH: "Forward to localhost",
  PLUS: "Forward ports to localhost",
  FORWARDING: "Forwarding to this Mac",
  PORTS: "Ports",
  WAITING: "Waiting for a port to listen",
  BUSY: "Port busy on this Mac",
  FORWARDED: "Forwarded",
  FROM_SANDBOX: "From the agent's sandbox",
  OPEN: "Open",
} as const;

/** The agents whose forwarding the developer turned off in this window, which none is forwarded again on its own. */
const declined = new Set<string>();

/** The turn each agent was last forwarded on its own in, by agent, so a forward the host let go as its sandbox stopped is not taken again in the same turn. */
const forwardedInTurn = new Map<string, string | null>();

const selectForwardsPorts = (state: AppStateSnapshot): boolean =>
  selectAppSettingsView(state)?.forwardPorts ?? APP_SETTING_DEFAULTS.forwardPorts;

/** The local address a port is forwarded to. */
function localAddress(localPort: number): string {
  return `localhost:${localPort}`;
}

/** The local ports that reached this Mac, the lowest sandbox port first. */
function reached(answer: PortForwardingAnswer): number[] {
  return answer.ports.flatMap((each) =>
    each.localPort === undefined || each.state === PORT_FORWARD_STATE.UNAVAILABLE
      ? []
      : [each.localPort],
  );
}

/** Forwarding turned on or off for the agent, an off kept in mind so it is not turned on again on its own. */
function setForwarding(agentId: string, on: boolean): void {
  if (on) declined.delete(agentId);
  else declined.add(agentId);
  void pressAct(ACT_KIND.PORT_FORWARD_SET, { agentId, on });
}

function openLocal(localPort: number): void {
  appPlatform().openWeb(`http://${localAddress(localPort)}`);
}

/** How forwarding stands for the agent, where it is offered: this Mac forwards, and the agent runs in the cloud. */
function useForwarding(agent: Pick<AgentSummary, "id" | "machine">): {
  offered: boolean;
  /** The one agent forwarded and how it stands; none while no agent is, and unknown until app state is read. */
  forwarding: ReturnType<typeof selectPortForwarding> | undefined;
  answer: PortForwardingAnswer;
} {
  const capable =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.PORT_FORWARDS) }).data ===
    true;
  const forwarding = useQuery({ ...appStateQuery, select: selectPortForwarding }).data;
  return {
    offered: capable && agent.machine !== AGENT_MACHINE.DEVICE,
    forwarding,
    answer: forwarding?.agentId === agent.id ? forwarding : OFF,
  };
}

/**
 * Forwards the agent on its own while its tab is shown and it is at work,
 * where the setting is on, no agent is forwarded, and the developer did not
 * turn this one off, at most once a turn; then says so once, as its first
 * port reaches the Mac.
 */
export function useAutoForward(
  agent: Pick<AgentSummary, "id" | "machine" | "status" | "archivedAt" | "turnId">,
  shown: boolean,
): void {
  const { offered, forwarding, answer } = useForwarding(agent);
  const wanted = useQuery({ ...appStateQuery, select: selectForwardsPorts }).data === true;
  const free = forwarding === null;
  const working = agentStillWriting(agent.status) && agent.archivedAt === undefined;
  const { id, turnId } = agent;
  useEffect(() => {
    if (!shown || !offered || !wanted || !free || !working || declined.has(id)) return;
    if (forwardedInTurn.has(id) && forwardedInTurn.get(id) === turnId) return;
    forwardedInTurn.set(id, turnId);
    void pressAct(ACT_KIND.PORT_FORWARD_SET, { agentId: id, on: true });
  }, [shown, offered, wanted, free, working, id, turnId]);

  // Note that the toast answers the first port reaching the Mac, not each read, so a forward that stands says nothing more.
  const toast = useToast();
  const ports = reached(answer);
  const first = ports[0];
  const hadPorts = useRef(first !== undefined);
  useEffect(() => {
    const had = hadPorts.current;
    hadPorts.current = first !== undefined;
    if (had || first === undefined) return;
    const more = ports.length - 1;
    toast({
      tone: STATUS_TONE.COMPLETE,
      glyph: () => <PlugIcon aria-hidden="true" />,
      words: `${WORDS.FORWARDED} ${localAddress(first)}`,
      detail: more > 0 ? `And ${more} more from the agent's sandbox` : WORDS.FROM_SANDBOX,
      replayUnmasked: true,
      action: { label: WORDS.OPEN, replayUnmasked: true, onPress: () => openLocal(first) },
    });
  }, [first, ports.length, toast]);
}

/** One row of the chip's menu per port: the address it opens, or why it has none; the line saying none listens yet where none does. */
function portRows(answer: PortForwardingAnswer): MenuAction[] {
  if (answer.ports.length === 0)
    return [{ label: WORDS.WAITING, disabled: true, onSelect: () => {} }];
  return answer.ports.map(({ port, localPort, state }) =>
    localPort === undefined || state === PORT_FORWARD_STATE.UNAVAILABLE
      ? {
          key: port,
          label: `:${port}`,
          icon: <GlobeIcon aria-hidden="true" />,
          detail: WORDS.BUSY,
          detailPlace: MENU_DETAIL.BESIDE,
          disabled: true,
          onSelect: () => {},
        }
      : {
          key: port,
          label: localAddress(localPort),
          icon: <GlobeIcon aria-hidden="true" />,
          ...(localPort === port
            ? {}
            : { detail: `from :${port}`, detailPlace: MENU_DETAIL.BESIDE }),
          onSelect: () => openLocal(localPort),
        },
  );
}

/**
 * The chip at the agent's box's foot while its ports are forwarded: the
 * first address and how many more, its menu the switch and the ports; none
 * while they are not.
 */
export function ForwardChip({
  agent,
  narrow = false,
}: {
  agent: Pick<AgentSummary, "id" | "machine">;
  /** Whether the box is too narrow for the chip's words, so it draws its plug alone. */
  narrow?: boolean;
}): React.JSX.Element | null {
  const { offered, answer } = useForwarding(agent);
  const menu = useMenu(true);
  if (!offered || !answer.on) return null;
  const ports = reached(answer);
  const first = ports[0];
  const words = first === undefined ? WORDS.FORWARDING : localAddress(first);
  const groups: MenuAction[][] = [
    [
      {
        label: WORDS.SWITCH,
        icon: <PlugIcon aria-hidden="true" />,
        checked: true,
        mark: MENU_ITEM_MARK.SWITCH,
        onSelect: () => setForwarding(agent.id, false),
      },
    ],
    portRows(answer),
  ];
  return (
    <>
      <Chip
        look={CHIP_LOOK.PILL}
        chevron
        iconOnly={narrow}
        aria-label={`${WORDS.PORTS}: ${words}`}
        {...menu.trigger(riseAbove)}
      >
        {/* The dot's hint, Forwarding to this Mac, is the chip's, so no hint of its own hangs over it. */}
        <StatusGlyph tone={STATUS_TONE.COMPLETE} label={WORDS.FORWARDING}>
          <PlugIcon aria-hidden="true" />
        </StatusGlyph>
        <ChipName mono>{words}</ChipName>
        {ports.length > 1 ? <ChipCount>{`+${ports.length - 1}`}</ChipCount> : null}
      </Chip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          replayUnmasked
          label={WORDS.PORTS}
          menu={menu.drawn}
          groups={groups}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/**
 * The + menu's switch that forwards the agent's ports, while they are not
 * forwarded on a platform that forwards them; none otherwise, the chip
 * holding it while they are.
 */
export function useForwardEntry(
  agent: Pick<AgentSummary, "id" | "machine">,
): MenuAction | undefined {
  const { offered, answer } = useForwarding(agent);
  if (!offered || answer.on) return undefined;
  return {
    label: WORDS.PLUS,
    icon: <PlugIcon aria-hidden="true" />,
    checked: false,
    mark: MENU_ITEM_MARK.SWITCH,
    onSelect: () => setForwarding(agent.id, true),
  };
}
