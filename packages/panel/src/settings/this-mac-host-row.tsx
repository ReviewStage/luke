import { DEVICE_SETUP, type DeviceSetup } from "@luke/features/device-agent-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { ThisMacHostRead } from "@luke/host/contract";
import {
  SETTINGS_ROW_STATE,
  type SettingsRowState,
  SettingsRowStateLine,
  useSecond,
} from "@luke/ui";
import { useEffect, useState } from "react";
import { useAct } from "../act.js";
import { deviceSetupWords } from "../device-setup.js";

/**
 * this-mac-host-row.tsx -- This Mac as Settings › Hosts finds it: the device its host's record names, read every few seconds; beside it, the line any host's row says where it stands in.
 *
 * The host reads the record of the account install on this Mac
 * (`@luke/host`'s `compose-this-mac-host.ts`), and Hosts reads it every
 * `READ_EVERY_MS` while it is drawn, so a Mac the app just enrolled finds
 * its row within seconds of the service listing it. A browser tab has no
 * This Mac and refuses the read, so it draws none of this.
 */

/** How often Hosts reads the device This Mac's host's record names while it is drawn. */
const READ_EVERY_MS = 5_000;

/** What a host's row says of where it stands, and its tint. */
export interface HostLine {
  readonly words: string;
  readonly state: SettingsRowState;
}

/** What a host's row says of its setup: getting ready, plain, or couldn't set up and why, tinted. */
export function setupLineOf(setup: DeviceSetup, failure: string | undefined): HostLine {
  return {
    words: deviceSetupWords(setup, failure),
    state: setup === DEVICE_SETUP.FAILED ? SETTINGS_ROW_STATE.ATTENTION : SETTINGS_ROW_STATE.PLAIN,
  };
}

/** The device This Mac's host's record names, read every few seconds while `reading`; none before the first read, while not reading, or in a browser tab. */
export function useThisMacHost(reading: boolean): ThisMacHostRead | undefined {
  const { act } = useAct();
  const tick = Math.floor(useSecond() / READ_EVERY_MS);
  const [read, setRead] = useState<ThisMacHostRead | undefined>(undefined);

  // Note that tick is read so the effect runs again every few seconds.
  useEffect(() => {
    if (!reading || tick < 0) return;
    let live = true;
    act(ACT_KIND.THIS_MAC_HOST_READ).then(
      (answer) => {
        if (live && !("failure" in answer)) setRead(answer);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [act, reading, tick]);

  return reading ? read : undefined;
}

/** A line under a host's row: where it stands, tinted. */
export function HostStateLine({ line }: { line: HostLine }): React.JSX.Element {
  return (
    <SettingsRowStateLine state={line.state} block>
      {line.words}
    </SettingsRowStateLine>
  );
}
