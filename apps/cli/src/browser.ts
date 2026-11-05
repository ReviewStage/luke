/**
 * browser.ts -- a page opened in the person's own browser, as the platform opens one.
 *
 * The opener is started and let go: the command never waits on it, and one
 * that is missing or fails says nothing, because the page's address is
 * always printed beside it for the person to open by hand.
 */

import { spawn } from "node:child_process";

/** The command each platform opens an address with, its arguments before the address. */
const OPENER = {
  darwin: { command: "open", args: [] },
  linux: { command: "xdg-open", args: [] },
} as const satisfies Partial<
  Record<NodeJS.Platform, { readonly command: string; readonly args: readonly string[] }>
>;

function isOpenerPlatform(platform: NodeJS.Platform): platform is keyof typeof OPENER {
  return platform in OPENER;
}

/** Opens an address in the default browser: `open` on a Mac, `xdg-open` elsewhere, and nothing where that is missing. */
export function openInBrowser(url: string): void {
  const platform = process.platform;
  const opener = isOpenerPlatform(platform) ? OPENER[platform] : OPENER.linux;
  const child = spawn(opener.command, [...opener.args, url], { stdio: "ignore", detached: true });
  child.on("error", () => undefined);
  child.unref();
}
