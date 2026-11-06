import { spawn } from "node:child_process";

const OPENER = {
  darwin: { command: "open", args: [] },
  linux: { command: "xdg-open", args: [] },
} as const satisfies Partial<
  Record<NodeJS.Platform, { readonly command: string; readonly args: readonly string[] }>
>;

function isOpenerPlatform(platform: NodeJS.Platform): platform is keyof typeof OPENER {
  return platform in OPENER;
}

export function openInBrowser(url: string): void {
  const platform = process.platform;
  const opener = isOpenerPlatform(platform) ? OPENER[platform] : OPENER.linux;
  const child = spawn(opener.command, [...opener.args, url], { stdio: "ignore", detached: true });
  child.on("error", () => undefined);
  child.unref();
}
