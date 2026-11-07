import { AGENT_MACHINE, type AgentSummary } from "@repo/features/agent-wire";
import { PORT_FORWARD_STATE, type PortForwardingAnswer } from "@repo/features/port-forward-acts";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { APP_SETTING_DEFAULTS, HOST_CAPABILITY } from "@repo/settings";
import {
  CHIP_LOOK,
  Chip,
  ChipName,
  MENU_DETAIL,
  MENU_ITEM_MARK,
  riseAbove,
  STATUS_TONE,
  StatusGlyph,
  Tooltip,
  useMenu,
} from "@repo/ui";
import { CopyIcon, GlobeIcon, LinkIcon, PlugIcon, UnlinkIcon } from "@repo/ui/icons";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { pressAct } from "../act.js";
import { appPlatform } from "../app-platform.js";
import { LINK_COPY, useCopyToast } from "../copy-feedback.js";
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
 * agent-forward.tsx -- an agent's cloud ports forwarded to this Mac's localhost: forwarded on their own while its tab is open, a toast saying so once, and a plug at its box's foot that says whether they are and turns them on or off.
 *
 * Only the desktop's host listens on the Mac's loopback
 * (`HOST_CAPABILITY.PORT_FORWARDS`), and only an agent in a cloud sandbox
 * has ports to forward, so none of it stands anywhere else. The host
 * forwards one agent at a time and follows its sandbox's ports itself, which
 * it keeps in app state (`portForwarding`), so all of this only reads it and
 * asks the host to turn forwarding on or off.
 *
 * With Forward cloud agents' ports automatically on (Settings › This Mac, on
 * by default), an agent at work whose tab is open is forwarded once no agent
 * is: the first keeps the ports until its forwarding is turned off or its
 * sandbox stops, so a browser tab open on one never starts showing another
 * agent's app. One the developer turned off in this window is left off
 * until they turn it on again. As the first port reaches the Mac, a toast
 * says its address once, with Open.
 *
 * The box's foot wears a plug after the Cloud chip, its glyph alone, as
 * Cursor's cloud agents wear one: while the agent is forwarded it wears a
 * dot in the complete tone, and its hint says the address,
 * "Forwarding to localhost:3000". Its menu holds the Forward to localhost
 * switch and, while on, one row per port, "localhost:3000", whose press
 * opens it in the default browser, with where it came from beside it where
 * the Mac's port differs ("from :3000"). Under them, a port may be shared
 * by a public link (`PORT_SHARE_SET`): one row per port, "Share :3000",
 * and while one is shared, its link, which opens it, Copy, and Stop
 * sharing, as the host keeps the link beside the ports. Every word drawn is the app's own,
 * port numbers among them, so a screen recording shows them as they read.
 */

/** What an agent forwarding is off for reads. */
const OFF: PortForwardingAnswer = { on: false, running: false, ports: [] };

/** What the plug, its menu, and the toast say. */
const WORDS = {
  SWITCH: "Forward to localhost",
  OFF: "Ports not forwarded",
  FORWARDING: "Forwarding to this Mac",
  FORWARDING_TO: "Forwarding to",
  PORTS: "Ports",
  WAITING: "Waiting for a port to listen",
  BUSY: "Port busy on this Mac",
  FORWARDED: "Forwarded",
  FROM_SANDBOX: "From the agent's sandbox",
  OPEN: "Open",
  SHARE: "Share",
  COPY: "Copy",
  STOP_SHARING: "Stop sharing",
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

/** The share rows: one per port, or the shared port's link, Copy, and Stop sharing. */
function shareRows(
  agentId: string,
  answer: PortForwardingAnswer,
  copy: (words: string, label: string) => void,
): MenuAction[] {
  const { shared } = answer;
  if (shared === undefined)
    return answer.ports.map(({ port }) => ({
      key: port,
      label: `${WORDS.SHARE} :${port}`,
      icon: <LinkIcon aria-hidden="true" />,
      onSelect: () => void pressAct(ACT_KIND.PORT_SHARE_SET, { agentId, port }),
    }));
  return [
    {
      label: shared.url,
      icon: <GlobeIcon aria-hidden="true" />,
      onSelect: () => appPlatform().openWeb(shared.url),
    },
    {
      label: WORDS.COPY,
      icon: <CopyIcon aria-hidden="true" />,
      onSelect: () => copy(shared.url, LINK_COPY.COPIED),
    },
    {
      label: WORDS.STOP_SHARING,
      icon: <UnlinkIcon aria-hidden="true" />,
      onSelect: () => void pressAct(ACT_KIND.PORT_SHARE_SET, { agentId, port: null }),
    },
  ];
}

/**
 * The plug at the agent's box's foot, for an agent whose ports this Mac
 * can forward: a dot in the complete tone while they are, the address in
 * its hint; its menu the switch and, while on, the ports.
 */
export function ForwardChip({
  agent,
}: {
  agent: Pick<AgentSummary, "id" | "machine">;
}): React.JSX.Element | null {
  const { offered, answer } = useForwarding(agent);
  const menu = useMenu(true);
  const copy = useCopyToast();
  if (!offered) return null;
  const first = reached(answer)[0];
  const words = !answer.on
    ? WORDS.OFF
    : first === undefined
      ? WORDS.FORWARDING
      : `${WORDS.FORWARDING_TO} ${localAddress(first)}`;
  const groups: MenuAction[][] = [
    [
      {
        label: WORDS.SWITCH,
        icon: <PlugIcon aria-hidden="true" />,
        checked: answer.on,
        mark: MENU_ITEM_MARK.SWITCH,
        onSelect: () => setForwarding(agent.id, !answer.on),
      },
    ],
    ...(answer.on ? [portRows(answer)] : []),
    ...(answer.on && answer.ports.length > 0 ? [shareRows(agent.id, answer, copy)] : []),
  ];
  const chip = (
    <Chip
      look={CHIP_LOOK.TOOLBAR}
      iconOnly
      aria-label={`${WORDS.PORTS}: ${words}`}
      {...menu.trigger(riseAbove)}
    >
      {answer.on ? (
        // Note that the dot's hint is the chip's, the address it forwards to, so no hint of its own hangs over it.
        <StatusGlyph tone={STATUS_TONE.COMPLETE} label={words}>
          <PlugIcon aria-hidden="true" />
        </StatusGlyph>
      ) : (
        <PlugIcon aria-hidden="true" />
      )}
      <ChipName>{words}</ChipName>
    </Chip>
  );
  return (
    <>
      {answer.on ? chip : <Tooltip label={words}>{chip}</Tooltip>}
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
