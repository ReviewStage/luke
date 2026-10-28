import { ACT_KIND } from "@luke/host/acts";
import { THIS_MAC_HOST_STANDING, type ThisMacHostStanding } from "@luke/host/contract";
import {
  BUTTON_VARIANT,
  Button,
  SETTINGS_ROW_STATE,
  SettingsRow,
  type SettingsRowState,
  SettingsRowStateLine,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  useSecond,
} from "@luke/ui";
import { useCallback, useEffect, useState } from "react";
import { useAct } from "../act.js";

/**
 * this-mac-host-row.tsx -- where This Mac's `luke-host` stands, as Settings › Agents › Machines draws it: getting ready, running, not running yet, waiting for approval in Login Items, removed from Luke with Turn on again, or a turn-on or setup that failed with why and Retry.
 *
 * The host keeps where it stands (`@luke/host`'s `compose-this-mac-host.ts`)
 * and Machines reads it every `READ_EVERY_MS` while it is drawn, so a Mac
 * approved in System Settings, or one `luke-host` just started following,
 * reads so within seconds. Turn on again and Retry are the member's own act,
 * the only one that enrolls a removed Mac again or starts `luke-host` again.
 * A browser tab runs no local agents and refuses the read, so it draws none
 * of this.
 */

/** How often Machines reads where `luke-host` stands while it is drawn. */
const READ_EVERY_MS = 5_000;

/** What a This Mac row says of what runs here, under its line. */
const THIS_MAC_DETAIL =
  "Coding agents on tasks that run on this Mac run here, each in a Linux VM of its own that sees " +
  "only its folder under ~/.luke, signed in through Luke. Their transcript and the files their " +
  "tools read still reach Luke.";

/** What a row says for each standing, its tint, and the act it offers where it offers one. */
export interface ThisMacLine {
  readonly words: string;
  readonly state: SettingsRowState;
  readonly act?: string;
}

/** What This Mac's row says for a standing; nothing where there is nothing to draw. */
function lineOf(standing: ThisMacHostStanding): ThisMacLine | null {
  switch (standing.standing) {
    case THIS_MAC_HOST_STANDING.OFF:
      return null;
    case THIS_MAC_HOST_STANDING.TURNING_ON:
      return { words: "Turning on…", state: SETTINGS_ROW_STATE.PLAIN };
    case THIS_MAC_HOST_STANDING.GETTING_READY:
      return {
        words: "Getting ready… Downloading what agents run on here.",
        state: SETTINGS_ROW_STATE.PLAIN,
      };
    case THIS_MAC_HOST_STANDING.RUNNING:
      return {
        words: "Running. Agents keep running when you quit Luke.",
        state: SETTINGS_ROW_STATE.CONNECTED,
      };
    case THIS_MAC_HOST_STANDING.NOT_RUNNING:
      return { words: "Not running yet.", state: SETTINGS_ROW_STATE.PLAIN };
    case THIS_MAC_HOST_STANDING.REQUIRES_APPROVAL:
      return {
        words: "Waiting for you to allow Luke in System Settings › General › Login Items.",
        state: SETTINGS_ROW_STATE.ATTENTION,
      };
    case THIS_MAC_HOST_STANDING.REMOVED:
      return {
        words: "This Mac was removed from Luke, so it runs no agents.",
        state: SETTINGS_ROW_STATE.ATTENTION,
        act: "Turn on again",
      };
    case THIS_MAC_HOST_STANDING.FAILED:
      return { words: standing.reason, state: SETTINGS_ROW_STATE.ATTENTION, act: "Retry" };
    case THIS_MAC_HOST_STANDING.SETUP_FAILED:
      return {
        words: `Couldn't set up agents here: ${standing.reason}`,
        state: SETTINGS_ROW_STATE.ATTENTION,
        act: "Retry",
      };
    case THIS_MAC_HOST_STANDING.OTHER_ACCOUNT:
      return {
        words: "This Mac runs agents for another Luke account that turned them on here.",
        state: SETTINGS_ROW_STATE.PLAIN,
      };
  }
}

/** This Mac as Machines draws it: where it stands and the line for it, none before the first read or in a browser tab, and the member's own Turn on again or Retry. */
export interface ThisMacHost {
  readonly standing: ThisMacHostStanding | undefined;
  readonly line: ThisMacLine | null;
  readonly turnOn: () => void;
  readonly turningOn: boolean;
}

/** Where This Mac's `luke-host` stands, read every few seconds while `reading`. */
export function useThisMacHost(reading: boolean): ThisMacHost {
  const { act } = useAct();
  const tick = Math.floor(useSecond() / READ_EVERY_MS);
  const [standing, setStanding] = useState<ThisMacHostStanding | undefined>(undefined);
  const [turningOn, setTurningOn] = useState(false);

  // Note that tick is read so the effect runs again every few seconds.
  useEffect(() => {
    if (!reading || tick < 0) return;
    let live = true;
    act(ACT_KIND.THIS_MAC_HOST_READ).then(
      (answer) => {
        if (live && !("failure" in answer)) setStanding(answer);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [act, reading, tick]);

  const turnOn = useCallback(() => {
    setTurningOn(true);
    act(ACT_KIND.THIS_MAC_HOST_TURN_ON)
      .then(
        (answer) => {
          if (!("failure" in answer)) setStanding(answer);
        },
        () => undefined,
      )
      .finally(() => setTurningOn(false));
  }, [act]);

  return {
    standing,
    line: standing === undefined ? null : lineOf(standing),
    turnOn,
    turningOn,
  };
}

/** What runs on this Mac, said under its row. */
export function ThisMacDetail(): React.JSX.Element {
  return (
    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
      {THIS_MAC_DETAIL}
    </Text>
  );
}

/** The line under a This Mac row: where it stands, tinted. */
export function ThisMacStateLine({ line }: { line: ThisMacLine }): React.JSX.Element {
  return (
    <SettingsRowStateLine state={line.state} block>
      {line.words}
    </SettingsRowStateLine>
  );
}

/** The act a This Mac row offers, Turn on again or Retry; nothing where it offers none. */
export function ThisMacAct({ thisMac }: { thisMac: ThisMacHost }): React.JSX.Element | null {
  const offered = thisMac.line?.act;
  if (offered === undefined) return null;
  return (
    <Button
      variant={BUTTON_VARIANT.OUTLINE}
      busy={thisMac.turningOn}
      busyLabel="Turning on"
      onClick={thisMac.turnOn}
    >
      {offered}
    </Button>
  );
}

/** This Mac's own row, where the service lists no machine for it: removed, never enrolled, a turn-on that failed, or another account's. */
export function ThisMacHostRow({
  thisMac,
  line,
}: {
  thisMac: ThisMacHost;
  line: ThisMacLine;
}): React.JSX.Element {
  return (
    <SettingsRow
      label="This Mac"
      description={<ThisMacStateLine line={line} />}
      below={() => <ThisMacDetail />}
    >
      {line.act === undefined ? undefined : () => <ThisMacAct thisMac={thisMac} />}
    </SettingsRow>
  );
}
