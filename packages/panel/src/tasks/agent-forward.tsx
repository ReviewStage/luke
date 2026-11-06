import { useAtomValue } from "@effect/atom-react";
import { AGENT_MACHINE, type AgentSummary } from "@repo/features/agent-wire";
import { PORT_FORWARD_STATE, type PortForwardingAnswer } from "@repo/features/port-forward-acts";
import { FAILURE_SURFACE, failureAboutOf } from "@repo/features/shown-failure";
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
import { Clock, Duration, Option, Schedule, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useEffect, useState } from "react";
import { askAct, toastActFailure } from "../act.js";
import { appPlatform } from "../app-platform.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { useCapability } from "../use-app-state.js";

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
 * and "Sandbox not running" while the sandbox is stopped. The host pushes
 * nothing, so the chip reads the agent's forwarding as it mounts and every
 * few seconds while it stands. Every word it draws is the app's own, port
 * numbers among them, so a screen recording shows them as they read.
 */

/** How often the chip reads the agent's forwarding while it stands. */
const READ_EVERY = Duration.seconds(3);

/** A tick each `READ_EVERY`, which runs only while a chip reads it. */
const readTickAtom = rendererRuntime.atom(
  Stream.fromEffectSchedule(Clock.currentTimeMillis, Schedule.spaced(READ_EVERY)),
);

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

/** The agent's forwarding as last read, read again each tick, and turned on or off. */
function usePortForwarding(agentId: string): {
  answer: PortForwardingAnswer | undefined;
  onTurn: (on: boolean) => void;
} {
  const tick = Option.getOrUndefined(AsyncResult.value(useAtomValue(readTickAtom)));
  const [read, setRead] = useState<{ agentId: string; answer: PortForwardingAnswer }>();
  useEffect(() => {
    // Note that the tick is read so each one reads again.
    void tick;
    let standing = true;
    askAct(ACT_KIND.PORT_FORWARD_READ, { agentId }).then(
      (answer) => {
        if (standing) setRead({ agentId, answer });
      },
      () => undefined,
    );
    return () => {
      standing = false;
    };
  }, [agentId, tick]);
  const onTurn = (on: boolean) => {
    const payload = { agentId, on };
    askAct(ACT_KIND.PORT_FORWARD_SET, payload).then(
      (answer) => setRead({ agentId, answer }),
      (cause: unknown) =>
        toastActFailure({
          surface: FAILURE_SURFACE.ACT,
          act: ACT_KIND.PORT_FORWARD_SET,
          cause,
          about: failureAboutOf(payload),
        }),
    );
  };
  return { answer: read?.agentId === agentId ? read.answer : undefined, onTurn };
}

/** The chip and its menu, once the agent's forwarding is first read. */
function ForwardControl({
  agentId,
  narrow,
}: {
  agentId: string;
  narrow: boolean;
}): React.JSX.Element | null {
  const menu = useMenu(true);
  const { answer, onTurn } = usePortForwarding(agentId);
  if (answer === undefined) return null;
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
    onSelect: () => onTurn(!answer.on),
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
