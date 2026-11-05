/**
 * processes.ts -- whether a process the agent started still runs beside the runner, so ending the launch, and stopping the sandbox under it, would end it.
 *
 * We start the runner under `setpriv` with its capability bounding set
 * emptied (the service's `runner-sessions.ts`), as we start every command
 * a person or a model drives in an agent's sandbox. The bounding set is
 * inherited across `fork` and kept across `execve`, and a process can only
 * drop from it (https://man7.org/linux/man-pages/man7/capabilities.7.html),
 * so the runner, the CLI it spawns, and everything the CLI's commands
 * started carry an empty one, a server that detached from its shell
 * included, while the sandbox's own processes keep theirs. A process with an
 * empty set that is neither the runner nor one it spawned itself, the
 * harness, is the agent's.
 *
 * Our own browser (`SANDBOX_BROWSER_PIN`) runs with an emptied set too, since
 * the pages it loads are no one's we vouch for, and stands for as long as
 * the sandbox once the agent opens it. It is told apart by its sessions:
 * Xvfb and Chromium each lead one of their own, Chromium's renderers and
 * helpers in it, so a process whose session's leader is Xvfb on the browser's
 * display, or a Chromium on the browser's DevTools port, is the browser's. Counted
 * as the agent's, it held every wait after the agent's first look at a page.
 * The bridge that carries a connection to it stands only while one is open,
 * a member's live view among them, so it still holds a wait, as it should.
 * A Chromium or an Xvfb of the agent's own leads a session on another port
 * or display, or none, so it still reads as the agent's.
 *
 * On a host, where the runner runs straight on the box beside the host's
 * own processes and every other agent's, nothing empties the bounding set,
 * and every process runs as one user, so the agent's are told apart by
 * descent and process group instead (`host-processes.ts`).
 *
 * Where `/proc` cannot be read, the answer is that one runs, so a wait is
 * never released on a guess; so is a process whose command line cannot be
 * read, which is never taken for the browser.
 */

import { readdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { Context, Effect, Layer } from "effect";
import { SANDBOX_BROWSER_PIN } from "./pins.js";

export interface ProcessTableShape {
  /** Whether a process of the agent's, beside the runner and the harness it spawned, still runs; yes where it cannot be told. */
  readonly agentProcessRuns: Effect.Effect<boolean>;
}

export class ProcessTable extends Context.Service<ProcessTable, ProcessTableShape>()(
  "@repo/agent-runner/ProcessTable",
) {}

/** The command-line arguments the leader of a session of our browser runs with: Xvfb's display, or Chromium's DevTools port. */
const SANDBOX_BROWSER_ARGUMENT = {
  DISPLAY: `:${SANDBOX_BROWSER_PIN.DISPLAY}`,
  DEVTOOLS: `--remote-debugging-port=${SANDBOX_BROWSER_PIN.DEVTOOLS_PORT}`,
} as const;

/** One process as its `status` names it: its parent, its session, where named, and whether its bounding set is empty. */
interface Status {
  readonly parent: number;
  readonly session: number | undefined;
  readonly emptied: boolean;
}

/** A process's `status` read, or none where it ended before its read. */
function statusOf(root: string, pid: string): Status | undefined {
  let text: string;
  try {
    text = readFileSync(`${root}/${pid}/status`, "utf8");
  } catch {
    return undefined;
  }
  const parent = /^PPid:\s+(\d+)$/m.exec(text)?.[1];
  // Note that the first of a session's ids is the one in the namespace this `/proc` was mounted from.
  const session = /^NSsid:\s+(\d+)/m.exec(text)?.[1];
  const bounding = /^CapBnd:\s+([0-9a-f]+)$/m.exec(text)?.[1];
  if (parent === undefined || bounding === undefined) return undefined;
  return {
    parent: Number(parent),
    session: session === undefined ? undefined : Number(session),
    emptied: /^0+$/.test(bounding),
  };
}

/** A process's command line as its `cmdline` holds it, or none where it cannot be read. */
function argvOf(root: string, pid: number): readonly string[] | undefined {
  try {
    return readFileSync(`${root}/${pid}/cmdline`, "utf8").split("\0");
  } catch {
    return undefined;
  }
}

/** Whether a session's leader, read from its `cmdline`, is our browser: Xvfb on its display, or Chromium on its port; no where it cannot be read. */
function leadsBrowser(root: string, leader: number): boolean {
  const argv = argvOf(root, leader);
  if (argv === undefined) return false;
  const [program, display] = argv;
  if (program !== undefined && basename(program) === SANDBOX_BROWSER_PIN.XVFB)
    return display === SANDBOX_BROWSER_ARGUMENT.DISPLAY;
  return argv.includes(SANDBOX_BROWSER_ARGUMENT.DEVTOOLS);
}

/**
 * Whether a process of the agent's runs under `root`, a `/proc`, beside the
 * runner (`self`), the processes it spawned, and our browser: one with an
 * emptied bounding set; yes where no process at all could be read.
 */
function agentProcessRunsUnder(root: string, self: number): boolean {
  let pids: string[];
  try {
    pids = readdirSync(root).filter((name) => /^\d+$/.test(name));
  } catch {
    return true;
  }
  const statuses = new Map<number, Status>();
  for (const pid of pids) {
    const status = statusOf(root, pid);
    if (status !== undefined) statuses.set(Number(pid), status);
  }
  if (statuses.size === 0) return true;
  for (const [pid, status] of statuses) {
    if (!status.emptied || pid === self || status.parent === self) continue;
    if (status.session !== undefined && leadsBrowser(root, status.session)) continue;
    return true;
  }
  return false;
}

/**
 * The processes under `root`, a `/proc`, as the runner `self` reads them:
 * the sandbox's own `/proc` and the runner's pid in production.
 */
export function processTable(root: string, self: number): Layer.Layer<ProcessTable> {
  return Layer.succeed(ProcessTable, {
    agentProcessRuns: Effect.sync(() => agentProcessRunsUnder(root, self)),
  });
}
