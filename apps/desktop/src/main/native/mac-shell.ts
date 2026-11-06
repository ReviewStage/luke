import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import type { MacShell } from "@repo/host/act-port";
import type * as NodePty from "node-pty";
import { nativeHelperPath } from "./native-helper";

const FALLBACK_SHELL = "/bin/zsh";

const TERMINAL_NAME = "xterm-256color";

const FALLBACK_LANG = "en_US.UTF-8";

function failureCode(cause: unknown): string {
  return cause instanceof Error && "code" in cause ? String(cause.code) : "no code";
}

const OPENING_SIZE = { cols: 80, rows: 24 } as const;

let nodePty: typeof NodePty | null | undefined;

function loadedNodePty(): typeof NodePty | null {
  if (nodePty !== undefined) return nodePty;
  try {
    const loaded: typeof NodePty = createRequire(__filename)(nativeHelperPath("node-pty"));
    nodePty = loaded;
  } catch (cause) {
    console.error(`node-pty did not load (${failureCode(cause)}), so no shell opens on this Mac.`);
    nodePty = null;
  }
  return nodePty;
}

function isFolder(folder: string): boolean {
  try {
    return fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

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
  } catch (cause) {
    console.error(`A shell did not start on this Mac (${failureCode(cause)}).`);
    return undefined;
  }
  const encoder = new TextEncoder();
  return {
    onData: (listener) => void running.onData((text) => listener(encoder.encode(text))),
    onExit: (listener) => void running.onExit(({ exitCode }) => listener(exitCode)),
    write: (data) => running.write(data),
    resize: (cols, rows) => {
      try {
        running.resize(cols, rows);
      } catch {}
    },
    pause: () => running.pause(),
    resume: () => running.resume(),
    kill: () => running.kill(),
  };
}
