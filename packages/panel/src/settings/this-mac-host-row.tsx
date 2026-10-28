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

/**
 * this-mac-host-row.tsx -- where This Mac's `luke-host` stands, under Run agents on this Mac: running, not running yet, waiting for approval in Login Items, removed from Luke with Turn on again, or a turn-on that failed with why and Retry.
 *
 * The host keeps where it stands (`@luke/host`'s `compose-this-mac-host.ts`)
 * and the row reads it every `READ_EVERY` while it is drawn, so a Mac
 * approved in System Settings, or one `luke-host` just started following,
 * reads so within seconds. Turn on again and Retry are the member's own act,
 * the only one that enrolls a removed Mac again. Nothing is drawn while the
 * switch is off.
 */

/** How often the row reads where `luke-host` stands while it is drawn. */
const READ_EVERY_MS = 5_000;

/** What the row says for each standing, its tint, and the act it offers where it offers one. */
function lineOf(standing: ThisMacHostStanding): {
  readonly words: string;
  readonly state: SettingsRowState;
  readonly act?: string;
} | null {
  switch (standing.standing) {
    case THIS_MAC_HOST_STANDING.OFF:
      return null;
    case THIS_MAC_HOST_STANDING.TURNING_ON:
      return { words: "Turning on…", state: SETTINGS_ROW_STATE.PLAIN };
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
    case THIS_MAC_HOST_STANDING.OTHER_ACCOUNT:
      return {
        words: "This Mac runs agents for another Luke account that turned them on here.",
        state: SETTINGS_ROW_STATE.PLAIN,
      };
  }
}

/** The line under Run agents on this Mac, read while it is drawn; nothing while the switch is off or before the first read. */
export function ThisMacHostRow(): React.JSX.Element | null {
  const { act } = useAct();
  const tick = Math.floor(useSecond() / READ_EVERY_MS);
  const [standing, setStanding] = useState<ThisMacHostStanding | undefined>(undefined);
  const [turningOn, setTurningOn] = useState(false);

  // Note that tick is read so the effect runs again every few seconds.
  useEffect(() => {
    if (tick < 0) return;
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
  }, [act, tick]);

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

  const line = standing === undefined ? null : lineOf(standing);
  if (line === null) return null;
  const offered = line.act;
  return (
    <SettingsRow
      label={null}
      description={<SettingsRowStateLine state={line.state}>{line.words}</SettingsRowStateLine>}
    >
      {offered === undefined
        ? undefined
        : () => (
            <Button
              variant={BUTTON_VARIANT.OUTLINE}
              busy={turningOn}
              busyLabel="Turning on"
              onClick={turnOn}
            >
              {offered}
            </Button>
          )}
    </SettingsRow>
  );
}
