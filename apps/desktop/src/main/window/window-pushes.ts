import { WindowPushes } from "@repo/host/act-port";
import type { WebContents } from "electron";

export const windowPushes = new WindowPushes<WebContents>();
