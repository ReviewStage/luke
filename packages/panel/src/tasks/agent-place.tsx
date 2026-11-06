import { AGENT_TOOL } from "@repo/features/agent-tools";
import {
  AGENT_MACHINE,
  type AgentSummary,
  DEVICE_STANDING,
  type DeviceStanding,
} from "@repo/features/agent-wire";
import { RUN_ON_MAC_REASON_WORDS } from "@repo/features/workspace-tools-model";
import {
  ChipName,
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  HoverCardRow,
  HoverCardRule,
  STATUS_TONE,
  StaticChip,
  StatusGlyph,
  Tooltip,
  useSecond,
  VisuallyHidden,
} from "@repo/ui";
import { actorName, personActor } from "@repo/ui/actor-model";
import { GLYPH } from "@repo/ui/icons";
import type { ReactNode } from "react";
import { presenceStanding, useDevicePresence } from "../device-presence.js";
import { machineName, useThisMac } from "../machine-name.js";
import { type RunOnMacRead, useRunOnMac } from "./run-on-mac.js";
import { DeviceGlyph, RUNS_ON_WORDS } from "./runs-on.js";

/**
 * agent-place.tsx -- the chip an agent's message box wears saying where the agent runs: its device by name, or the cloud.
 *
 * It is a start's Runs on chip as the agent keeps it (`runs-on.tsx`): the
 * same toolbar chip, the same glyph by the device's platform, and the same
 * name every list of machines gives it (`machine-name.ts`), This Mac among
 * them, so an agent reads alike before and after it starts. Since where an
 * agent runs is set as it starts, the chip ends in no chevron and
 * takes no press (`StaticChip`); a rest on it, or a tap under a finger,
 * hangs a card saying where the agent runs and whether the
 * device is online, and a reader hears "Runs on:" before its words. An
 * agent in a sandbox says "Cloud" beside the cloud glyph, and its card names
 * under a rule the Mac its `run_on_mac` runs shell commands on, the task's
 * assignee's or else its starter's, "Your Mac" for the reader's own, its
 * glyph wearing a dot for how it stands: online, offline, or off in this
 * Mac's Settings (`run-on-mac.ts`), which a reader hears after "Cloud".
 *
 * While a device has not beaten lately, asleep or with the app closed,
 * judged from how long ago the service says it last beat, the label adds
 * that it is offline ("Charles's MacBook Pro · Offline"), as the Runs on
 * chips do, its glyph in the attention tone, since the agent's messages
 * wait for it to come back. The beat comes from the window's shared presence
 * read (`device-presence.ts`), so a device that keeps beating never reads
 * offline for want of a read; where that read fails and the beat held is
 * old, the label says it cannot check rather than that the device is away.
 * A device the read does not name is a teammate's, which the window cannot
 * speak for, so its label is its name alone. Nothing is drawn for an agent
 * on a device the service no longer names, since it is neither in the cloud
 * nor anywhere that can be named. In a box too narrow for its words, where
 * the branch's chip draws its mark alone too, the chip draws its glyph alone
 * in a square and keeps the words for a reader and its hint.
 */

/** What a reader hears before the name, which the glyph says to the eye. */
const RUNS_ON = "Runs on: ";

/** The label's words, by where the device stands. */
function macWords(name: string, standing: DeviceStanding | undefined): string {
  if (standing === undefined || standing === DEVICE_STANDING.ONLINE) return name;
  if (standing === DEVICE_STANDING.CHECKING) return name;
  return standing === DEVICE_STANDING.OFFLINE
    ? `${name} · Offline`
    : `${name} · Can't check status`;
}

/** What the card says under its head of the agent, in the cloud or on a device. */
const SHARED_NOTE = {
  CLOUD: "This agent runs in a cloud sandbox. Set when it was started.",
  DEVICE: "This agent runs on this device. Set when it was started.",
} as const;

/** Whose Mac the agent's `run_on_mac` runs on and how it stands, as words: "run_on_mac · Your Mac" and "Online". */
function runOnMacWords(
  read: RunOnMacRead,
  readerId: string | undefined,
): { readonly mac: string; readonly stands: string } | undefined {
  const { standing, reason } = read;
  if (standing === undefined) return undefined;
  const owner = actorName(personActor(standing.owner, undefined, readerId), { possessive: true });
  return {
    mac: `${AGENT_TOOL.RUN_ON_MAC} · ${owner} Mac`,
    stands: reason === undefined ? RUNS_ON_WORDS.ONLINE : RUN_ON_MAC_REASON_WORDS[reason],
  };
}

/**
 * A cloud agent's chip, whose card names under a rule the Mac its
 * `run_on_mac` runs shell commands on, drawn as the Runs on menu draws a
 * device: the Mac's glyph wearing its standing's dot, green while it
 * listens and gray while it is offline or off in Settings, beside
 * "run_on_mac · Your Mac". The chip takes no focus, so a reader hears the
 * same after "Cloud". Note that the Mac is named by its owner, since any of
 * their Macs that listens runs the commands; nothing is said while it is
 * read, or for an agent offered none.
 */
function CloudChip({
  agentId,
  readerId,
  narrow,
}: {
  agentId: string;
  readerId: string | undefined;
  narrow: boolean;
}): React.JSX.Element {
  const read = useRunOnMac(agentId, (userId) => userId === readerId);
  const words = runOnMacWords(read, readerId);
  return (
    <PlaceChip
      glyph={<GLYPH.CLOUD aria-hidden="true" />}
      words={RUNS_ON_WORDS.CLOUD}
      sub={undefined}
      note={SHARED_NOTE.CLOUD}
      said={words === undefined ? undefined : `, ${words.mac}, ${words.stands}`}
      more={
        words === undefined ? undefined : (
          <>
            <HoverCardRule />
            <HoverCardRow
              glyph={
                <StatusGlyph
                  tone={read.reason === undefined ? STATUS_TONE.COMPLETE : STATUS_TONE.NEUTRAL}
                  label={words.stands}
                >
                  <DeviceGlyph device={undefined} />
                </StatusGlyph>
              }
              label={words.mac}
            />
          </>
        )
      }
      narrow={narrow}
    />
  );
}

export function AgentPlace({
  agent,
  readerId,
  narrow = false,
}: {
  agent: Pick<AgentSummary, "id" | "mac" | "machine">;
  /** The reader's account, whose own Mac the card calls "Your Mac". */
  readerId: string | undefined;
  /** Whether the box is too narrow for the chip's words, so it draws its glyph alone. */
  narrow?: boolean;
}): React.JSX.Element | null {
  if (agent.machine !== AGENT_MACHINE.DEVICE) {
    return <CloudChip agentId={agent.id} readerId={readerId} narrow={narrow} />;
  }
  if (agent.mac === undefined) return null;
  return <MacChip mac={agent.mac} narrow={narrow} />;
}

/** The chip and its card: the glyph, the words a reader hears after "Runs on:", and the card's head and note. */
function PlaceChip({
  glyph,
  words,
  sub,
  note,
  said,
  more,
  quiet = true,
  narrow,
}: {
  glyph: ReactNode;
  words: string;
  sub: string | undefined;
  note: string;
  /** What a reader hears after the words, which the card says to the eye; none where it says nothing more. */
  said?: string | undefined;
  /** What the card lists after its note, where it lists anything. */
  more?: ReactNode;
  quiet?: boolean;
  narrow: boolean;
}): React.JSX.Element {
  return (
    <Tooltip
      label={`${RUNS_ON}${words}`}
      card={
        <HoverCard>
          <HoverCardHead glyph={glyph} name={words} sub={sub} />
          <HoverCardNote>{note}</HoverCardNote>
          {more}
        </HoverCard>
      }
    >
      <StaticChip tone={quiet ? undefined : STATUS_TONE.ATTENTION} iconOnly={narrow}>
        {glyph}
        <VisuallyHidden>{RUNS_ON}</VisuallyHidden>
        <ChipName>{words}</ChipName>
        {said === undefined ? null : <VisuallyHidden>{said}</VisuallyHidden>}
      </StaticChip>
    </Tooltip>
  );
}

/** The chip of an agent on a device, held against the window's clock, so a Mac that goes quiet reads offline without another read. */
function MacChip({
  mac,
  narrow,
}: {
  mac: NonNullable<AgentSummary["mac"]>;
  narrow: boolean;
}): React.JSX.Element {
  const presence = useDevicePresence(true);
  const thisMac = useThisMac();
  // Note that the clock only redraws the label as a beat ages, since the standing is read off the book's own monotonic clock.
  useSecond();
  const standing = presenceStanding(presence, mac.deviceId);
  const quiet =
    standing === undefined ||
    standing === DEVICE_STANDING.ONLINE ||
    standing === DEVICE_STANDING.CHECKING;
  const name = machineName({ deviceId: mac.deviceId, name: mac.name }, [], thisMac);
  return (
    <PlaceChip
      glyph={<DeviceGlyph device={undefined} />}
      words={macWords(name, standing)}
      sub={standing === DEVICE_STANDING.ONLINE ? RUNS_ON_WORDS.ONLINE : undefined}
      note={SHARED_NOTE.DEVICE}
      quiet={quiet}
      narrow={narrow}
    />
  );
}
