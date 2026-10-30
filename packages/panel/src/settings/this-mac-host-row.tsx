import { DEVICE_SETUP, type DeviceSetup } from "@luke/features/device-agent-wire";
import { ACT_KIND } from "@luke/host/acts";
import { THIS_MAC_HOST_STANDING, type ThisMacHostStanding } from "@luke/host/contract";
import {
  BUTTON_VARIANT,
  Button,
  SETTINGS_ROW_STATE,
  SettingsRow,
  type SettingsRowState,
  SettingsRowStateLine,
  useSecond,
} from "@luke/ui";
import { useCallback, useEffect, useState } from "react";
import { useAct } from "../act.js";
import { deviceSetupWords } from "../device-setup.js";

/**
 * this-mac-host-row.tsx -- where This Mac's `luke-host` stands, as Settings › Hosts draws it: nothing beyond the machine's own line while it runs, and otherwise not turned on with Turn on, getting ready, not running yet, waiting for approval in Login Items, removed from Luke with Turn on again, or a turn-on or setup that failed with why and Retry.
 *
 * A setup is said in the words every host's row says it in
 * (`setupLineOf`), so This Mac getting ready or failing to set up reads as
 * any other host does, with Retry beside it here alone, since only This
 * Mac's own app can ask its host to try again.
 *
 * The host keeps where it stands (`@luke/host`'s `compose-this-mac-host.ts`)
 * and Hosts reads it every `READ_EVERY_MS` while it is drawn, so a Mac
 * approved in System Settings, or one `luke-host` just started following,
 * reads so within seconds. Turn on, Turn on again, and Retry are the
 * member's own act, the only one that enrolls this Mac or starts `luke-host`
 * again; Turn on's line says what turning it on does, since it runs
 * `luke-host` at login and downloads what agents run on. A browser tab runs
 * no local agents and refuses the read, so it draws none of this.
 */

/** How often Hosts reads where `luke-host` stands while it is drawn. */
const READ_EVERY_MS = 5_000;

/** What a host's row says of where it stands, its tint, and the act it offers where it offers one. */
export interface HostLine {
  readonly words: string;
  readonly state: SettingsRowState;
  readonly act?: string;
}

/** What a host's row says of its setup: getting ready, plain, or couldn't set up and why, tinted. */
export function setupLineOf(setup: DeviceSetup, failure: string | undefined): HostLine {
  return {
    words: deviceSetupWords(setup, failure),
    state: setup === DEVICE_SETUP.FAILED ? SETTINGS_ROW_STATE.ATTENTION : SETTINGS_ROW_STATE.PLAIN,
  };
}

/** What This Mac's row says for a standing; nothing where there is nothing to draw, a running Mac among them, whose machine line already reads online. */
function lineOf(standing: ThisMacHostStanding): HostLine | null {
  switch (standing.standing) {
    case THIS_MAC_HOST_STANDING.OFF:
    case THIS_MAC_HOST_STANDING.RUNNING:
      return null;
    case THIS_MAC_HOST_STANDING.NOT_TURNED_ON:
      return {
        words:
          "Run agents here, straight on this Mac, each in a folder of its own. Turning on downloads " +
          "Claude Code, Codex, and GitHub's CLI and starts Luke's host at login.",
        state: SETTINGS_ROW_STATE.PLAIN,
        act: "Turn on",
      };
    case THIS_MAC_HOST_STANDING.TURNING_ON:
      return { words: "Turning on…", state: SETTINGS_ROW_STATE.PLAIN };
    case THIS_MAC_HOST_STANDING.GETTING_READY:
      return setupLineOf(DEVICE_SETUP.PREPARING, undefined);
    case THIS_MAC_HOST_STANDING.NOT_RUNNING:
      return { words: "Not running yet.", state: SETTINGS_ROW_STATE.PLAIN };
    case THIS_MAC_HOST_STANDING.REQUIRES_APPROVAL:
      return {
        words: "Allow Luke in System Settings › General › Login Items.",
        state: SETTINGS_ROW_STATE.ATTENTION,
      };
    case THIS_MAC_HOST_STANDING.REMOVED:
      return {
        words: "Removed from Luke.",
        state: SETTINGS_ROW_STATE.ATTENTION,
        act: "Turn on again",
      };
    case THIS_MAC_HOST_STANDING.FAILED:
      return { words: standing.reason, state: SETTINGS_ROW_STATE.ATTENTION, act: "Retry" };
    case THIS_MAC_HOST_STANDING.SETUP_FAILED:
      return { ...setupLineOf(DEVICE_SETUP.FAILED, standing.reason), act: "Retry" };
    case THIS_MAC_HOST_STANDING.OTHER_ACCOUNT:
      return { words: "Used by another Luke account.", state: SETTINGS_ROW_STATE.PLAIN };
  }
}

/** This Mac as Hosts draws it: where it stands and the line for it, none before the first read or in a browser tab, and the member's own Turn on, Turn on again, or Retry. */
export interface ThisMacHost {
  readonly standing: ThisMacHostStanding | undefined;
  readonly line: HostLine | null;
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

/** A line under a host's row: where it stands, tinted. */
export function HostStateLine({ line }: { line: HostLine }): React.JSX.Element {
  return (
    <SettingsRowStateLine state={line.state} block>
      {line.words}
    </SettingsRowStateLine>
  );
}

/** The act a This Mac row offers, Turn on, Turn on again, or Retry; nothing where it offers none. */
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

/** This Mac's own row, where the service lists no machine for it: not turned on, removed, a turn-on that failed, or another account's. */
export function ThisMacHostRow({
  thisMac,
  line,
}: {
  thisMac: ThisMacHost;
  line: HostLine;
}): React.JSX.Element {
  return (
    <SettingsRow label="This Mac" description={<HostStateLine line={line} />}>
      {line.act === undefined ? undefined : () => <ThisMacAct thisMac={thisMac} />}
    </SettingsRow>
  );
}
