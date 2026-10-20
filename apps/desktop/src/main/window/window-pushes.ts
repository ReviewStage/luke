/**
 * window-pushes.ts -- what main pushes each window, one table for the process, as Electron's own IPC is one.
 *
 * Every push to a window is published here by the platform's handle on it,
 * its `webContents`, and reaches the window on the push stream of its act
 * port, which `bridge-host.ts` serves from this same table. A window whose
 * page has not opened its stream, or has gone, hears nothing, as a page with
 * no listener on a channel heard nothing.
 */

import { WindowPushes } from "@luke/host/act-port";
import type { WebContents } from "electron";

export const windowPushes = new WindowPushes<WebContents>();
