import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import type { MacShell } from "@repo/host/act-port";
import type * as NodePty from "node-pty";
import { nativeHelperPath } from "./native-helper";

/**
 * mac-shell.ts -- the developer's login shell on this Mac, run in a pseudoterminal by node-pty, as the act port's shells ask for one (`@repo/host/act-port`'s `MacShell`).
 *
 * node-pty's folder (`scripts/package-layout.mjs`'s `NODE_PTY`) is loaded
 * from beside the helpers rather than bundled, since its JavaScript finds
 * its N-API addon and `spawn-helper` from its own folder. Each shell is a
 * child of main, so it lives as long as the app and no longer: a quit
 * closes its terminal, and the shell hangs up. What a shell prints is handed
 * on as bytes and never read, logged, or kept here.
 */

/** The shell a Mac account starts with when its own is unknown. */
const FALLBACK_SHELL = "/bin/zsh";

/** What the shell is told its terminal is, as the Terminal tab's xterm draws it. */
const TERMINAL_NAME = "xterm-256color";

/** The locale a shell gets where the app was launched without one, as Finder launches it, so a shell reads and writes UTF-8. */
const FALLBACK_LANG = "en_US.UTF-8";

/** The size a shell opens at, before its first attach tells it the tab's. */
const OPENING_SIZE = { cols: 80, rows: 24 } as const;

let nodePty: typeof NodePty | null | undefined;

/** node-pty, loaded once; null where it cannot be. */
function loadedNodePty(): typeof NodePty | null {
  if (nodePty !== undefined) return nodePty;
  try {
    const loaded: typeof NodePty = createRequire(__filename)(nativeHelperPath("node-pty"));
    nodePty = loaded;
  } catch {
    nodePty = null;
  }
  return nodePty;
}

/** Whether `folder` is a folder on this Mac. */
function isFolder(folder: string): boolean {
  try {
    return fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

/** The developer's login shell started in `folder`; none where that is no folder, or node-pty did not load or start it. */
export function spawnMacShell(folder: string): MacShell | undefined {
  const pty = loadedNodePty();
  if (pty === null || !isFolder(folder)) return undefined;
  const shell = process.env.SHELL || os.userInfo().shell || FALLBACK_SHELL;
  let running: NodePty.IPty;
  try {
    running = pty.spawn(shell, ["-l"], {
      name: TERMINAL_NAME,
      cwd: folder,
      ...OPENING_SIZE,
      env: {
        ...process.env,
        TERM: TERMINAL_NAME,
        COLORTERM: "truecolor",
        LANG: process.env.LANG || FALLBACK_LANG,
      },
    });
  } catch {
    return undefined;
  }
  const encoder = new TextEncoder();
  return {
    onData: (listener) => void running.onData((text) => listener(encoder.encode(text))),
    onExit: (listener) => void running.onExit(({ exitCode }) => listener(exitCode)),
    write: (data) => running.write(data),
    resize: (cols, rows) => {
      // Note that a terminal that closed under a resize is let be, because its exit is already on its way.
      try {
        running.resize(cols, rows);
      } catch {}
    },
    pause: () => running.pause(),
    resume: () => running.resume(),
    kill: () => running.kill(),
  };
}
